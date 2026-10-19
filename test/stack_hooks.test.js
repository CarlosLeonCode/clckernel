/**
 * sdds/stack-hooks: every tool a stack's AGENTS.md promises runs in its hook
 * when the tool is available, and the hook says so when it is not.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');
const { generateHookFromManifest, generateHarness } = require('../src/generator');
const { autoDetectStack } = require('../src/detector');

const ADAPTERS_DIR = path.join(__dirname, '..', 'src', 'adapters');
const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function loadAdapter(file) {
  const Adapter = require(path.join(ADAPTERS_DIR, file));
  return new Adapter();
}

// No Husky in these projects: every stack's hook goes to .githooks (sdds/first-commit).
function hookPath(dir) {
  return path.join(dir, '.githooks', 'pre-commit');
}

/** Generates the hook for an adapter's own manifest in an empty project. */
function hookFor(adapter) {
  const dir = createTmpProject({});
  try {
    generateHookFromManifest(adapter, dir);
    return fs.readFileSync(hookPath(dir, adapter), 'utf-8');
  } finally {
    teardown(dir);
  }
}

/**
 * sdds/unified-discovery: every hook starts by calling the installed audit
 * orchestrators and fails without one. Hook tests that exercise only the
 * external tool lines get a passing stub tools/audit.js, and a PATH entry
 * holding just `node` so a restricted PATH still finds it.
 * @returns {string} The directory to put on PATH
 */
function stubOrchestrator(dir) {
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 'audit.js'), 'process.exit(0);\n');
  const nodeBin = path.join(dir, 'nodebin');
  fs.mkdirSync(nodeBin, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(nodeBin, 'node'));
  return nodeBin;
}

function guardedLine(name, availableIf, command) {
  return `if ${availableIf} >/dev/null 2>&1; then ${command}; else echo "clckernel: ${name} not available, skipped"; fi`;
}

// Spec table: tool -> availableIf, per adapter (decision 1).
const EXTERNAL_TOOLS = {
  'astro.js': [
    ['astro_check', '[ -x node_modules/.bin/astro ]', 'npx astro check'],
    ['vitest', '[ -x node_modules/.bin/vitest ]', 'npx vitest run --passWithNoTests'],
  ],
  'nextjs.js': [
    ['tsc', '[ -x node_modules/.bin/tsc ]', 'npx tsc --noEmit'],
    ['lint', '[ -x node_modules/.bin/lint-staged ]', 'npx lint-staged'],
  ],
  'fastapi.js': [
    ['ruff', 'python3 -m ruff --version', 'python3 -m ruff check .'],
    // Exit 5 = no tests collected (a fresh project), not a failure.
    ['pytest', 'python3 -m pytest --version', 'python3 -m pytest || [ $? -eq 5 ]'],
  ],
  'django.js': [
    ['ruff', 'python3 -m ruff --version', 'python3 -m ruff check .'],
    ['manage', '[ -f manage.py ]', 'python3 manage.py test'],
  ],
  'rails.js': [
    ['rubocop', "grep -q '^    rubocop ' Gemfile.lock", 'bundle exec rubocop --parallel'],
    ['brakeman', "grep -q '^    brakeman ' Gemfile.lock", 'bundle exec brakeman -q'],
    ['rspec', "grep -q '^    rspec-core ' Gemfile.lock", 'bundle exec rspec'],
  ],
  'laravel.js': [
    ['phpstan', '[ -x vendor/bin/phpstan ]', './vendor/bin/phpstan analyse'],
    // A compound condition is grouped so the redirect covers all of it.
    ['artisan', '{ [ -f artisan ] && command -v php; }', 'php artisan test'],
  ],
  'go.js': [
    ['golangci-lint', 'command -v golangci-lint', 'golangci-lint run'],
    ['go_test', 'command -v go', 'go test ./...'],
  ],
  'rust.js': [
    ['cargo_clippy', 'cargo clippy --version', 'cargo clippy -- -D warnings'],
    ['cargo_audit', 'command -v cargo-audit', 'cargo audit'],
    ['cargo_test', 'command -v cargo', 'cargo test'],
  ],
};

describe('stack hooks: external tools are guarded at runtime (plan 1)', () => {
  for (const [file, rows] of Object.entries(EXTERNAL_TOOLS)) {
    describe(file, () => {
      const adapter = loadAdapter(file);
      const hook = hookFor(adapter);
      const lines = hook.split('\n');

      it('declares exactly the external tools in the spec table', () => {
        const external = adapter.getTools().filter((t) => t.language === 'external').map((t) => t.name);
        assert.deepStrictEqual(external.sort(), rows.map((r) => r[0]).sort());
      });

      for (const [name, availableIf, command] of rows) {
        it(`${name}: runs "${command}" only when ${availableIf}`, () => {
          const expected = guardedLine(name, availableIf, command);
          assert.ok(lines.includes(expected), `missing line:\n${expected}\nin hook:\n${hook}`);
        });
      }
    });
  }
});

describe('stack hooks: real hook behavior with a fake tool on PATH (plan 2)', () => {
  const adapter = {
    name: 'Fake Stack',
    projectType: 'backend',
    provision() {},
    getSafeguards: () => [],
    getTools: () => [
      {
        name: 'clc_fake_tool',
        language: 'external',
        path: '',
        command: 'clc_fake_tool',
        availableIf: 'command -v clc_fake_tool',
        description: 'fake external tool',
      },
    ],
  };

  function setup(exitCode) {
    const dir = createTmpProject({});
    const res = spawnSync('git', ['init', '-q'], { cwd: dir, env: { ...process.env, ...GIT_ENV } });
    assert.strictEqual(res.status, 0, res.stderr && res.stderr.toString());
    generateHookFromManifest(adapter, dir);
    const bin = path.join(dir, 'fakebin');
    fs.mkdirSync(bin);
    const tool = path.join(bin, 'clc_fake_tool');
    fs.writeFileSync(tool, `#!/bin/sh\necho fake-ran\nexit ${exitCode}\n`);
    fs.chmodSync(tool, 0o755);
    return { dir, bin, hook: hookPath(dir, adapter) };
  }

  function run(shell, hook, dir, PATH) {
    const nodeBin = fs.existsSync(path.join(dir, 'nodebin')) ? path.join(dir, 'nodebin') : stubOrchestrator(dir);
    return spawnSync(shell, [hook], { cwd: dir, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV, PATH: `${nodeBin}:${PATH}` } });
  }

  for (const shell of ['sh', 'bash']) {
    describe(shell, () => {
      it('available and failing: the hook exits non-zero', () => {
        const { dir, bin, hook } = setup(1);
        try {
          const res = run(shell, hook, dir, `${bin}:/usr/bin:/bin`);
          assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
          assert.match(res.stdout, /fake-ran/);
        } finally {
          teardown(dir);
        }
      });

      it('available and passing: the hook exits 0', () => {
        const { dir, bin, hook } = setup(0);
        try {
          const res = run(shell, hook, dir, `${bin}:/usr/bin:/bin`);
          assert.strictEqual(res.status, 0, res.stdout + res.stderr);
          assert.match(res.stdout, /fake-ran/);
        } finally {
          teardown(dir);
        }
      });

      it('not available: the hook exits 0 and says the tool was skipped', () => {
        const { dir, hook } = setup(1);
        try {
          const res = run(shell, hook, dir, '/usr/bin:/bin');
          assert.strictEqual(res.status, 0, res.stdout + res.stderr);
          assert.match(res.stdout, /clckernel: clc_fake_tool not available, skipped/);
          assert.doesNotMatch(res.stdout + res.stderr, /fake-ran/);
        } finally {
          teardown(dir);
        }
      });
    });
  }

  it('a compound availableIf is redirected as a whole in sh and bash', () => {
    const compound = {
      ...adapter,
      getTools: () => [{ ...adapter.getTools()[0], availableIf: '[ -d . ] && command -v clc_fake_tool' }],
    };
    const dir = createTmpProject({});
    try {
      generateHookFromManifest(compound, dir);
      for (const shell of ['sh', 'bash']) {
        const res = run(shell, hookPath(dir, compound), dir, '/usr/bin:/bin');
        assert.strictEqual(res.status, 0, `${shell}: ${res.stdout}${res.stderr}`);
        assert.match(res.stdout, /not available, skipped/);
        assert.strictEqual(res.stderr, '', `${shell}: condition output must be silenced`);
      }
    } finally {
      teardown(dir);
    }
  });
});

describe('stack hooks: a fresh project without tests or with harness files (sdds/first-commit)', () => {
  const FastApiAdapter = require('../src/adapters/fastapi');
  const fastapiTool = (name) => new FastApiAdapter().getTools().find((t) => t.name === name);

  /** Hook running only the real FastAPI pytest line, with a fake python3 exiting `code`. */
  function pytestHook(code) {
    const dir = createTmpProject({});
    const adapter = { name: 'FastAPI', projectType: 'backend', getTools: () => [fastapiTool('pytest')] };
    generateHookFromManifest(adapter, dir, adapter.getTools(), []);
    const bin = path.join(dir, 'fakebin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'python3'),
      `#!/bin/sh\n[ "$3" = "--version" ] && exit 0\necho pytest-ran\nexit ${code}\n`);
    fs.chmodSync(path.join(bin, 'python3'), 0o755);
    return { dir, bin, hook: hookPath(dir) };
  }

  for (const shell of ['sh', 'bash']) {
    for (const [code, passes] of [[0, true], [5, true], [1, false], [2, false]]) {
      it(`${shell}: pytest exit ${code} ${passes ? 'passes' : 'fails'} the hook`, () => {
        const { dir, bin, hook } = pytestHook(code);
        try {
          const nodeBin = stubOrchestrator(dir);
          const res = spawnSync(shell, [hook], {
            cwd: dir, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV, PATH: `${bin}:${nodeBin}:/usr/bin:/bin` },
          });
          assert.match(res.stdout, /pytest-ran/);
          if (passes) assert.strictEqual(res.status, 0, res.stdout + res.stderr);
          else assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
        } finally {
          teardown(dir);
        }
      });
    }
  }

  it('ruff excludes the registered .py harness files, and only those', () => {
    const dir = createTmpProject({});
    try {
      const adapter = { name: 'FastAPI', projectType: 'backend', getTools: () => [fastapiTool('ruff')] };
      const managed = ['tools/.clckernel-managed.json', 'tools/_changes.py', 'tools/audit.py', 'tools/scan_secrets.js'];
      generateHookFromManifest(adapter, dir, adapter.getTools(), managed);
      const hook = fs.readFileSync(hookPath(dir), 'utf-8');
      assert.ok(
        hook.includes('then python3 -m ruff check . --extend-exclude tools/_changes.py,tools/audit.py;'),
        hook
      );
    } finally {
      teardown(dir);
    }
  });

  it('ruff reads the registry on disk when no list is passed', () => {
    const dir = createTmpProject({ 'tools/.clckernel-managed.json': '["tools/verify_tdd.py"]\n' });
    try {
      const adapter = { name: 'Django', projectType: 'backend', getTools: () => [fastapiTool('ruff')] };
      generateHookFromManifest(adapter, dir);
      assert.ok(fs.readFileSync(hookPath(dir), 'utf-8').includes('--extend-exclude tools/verify_tdd.py;'));
    } finally {
      teardown(dir);
    }
  });
});

/** Fixture projects that autoDetectStack resolves to each adapter. */
const FIXTURES = {
  rails: { Gemfile: "source 'https://rubygems.org'\ngem 'rails'\n", 'config/routes.rb': 'Rails.application.routes.draw do\nend\n' },
  go: { 'go.mod': 'module example.com/app\n\ngo 1.22\n' },
  laravel: { 'composer.json': '{"require":{"laravel/framework":"^11.0"}}\n', artisan: '#!/usr/bin/env php\n' },
  rust: { 'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\n' },
  fastapi: { 'requirements.txt': 'fastapi\n' },
  nextjsDocker: {
    'package.json': '{"dependencies":{"next":"14.0.0"}}\n',
    Dockerfile: 'FROM node:20\n',
  },
};

function withHarness(fixture, fn) {
  const dir = createTmpProject(fixture);
  try {
    const config = autoDetectStack(dir);
    generateHarness(dir, config);
    const adapter = config.adapter;
    const hook = fs.readFileSync(hookPath(dir, adapter), 'utf-8');
    const tools = fs.readdirSync(path.join(dir, 'tools'));
    return fn({ dir, hook, tools, adapter });
  } finally {
    teardown(dir);
  }
}

describe('stack hooks: secrets on every stack, no Python where unused (plan 3)', () => {
  // sdds/unified-discovery: the hook runs the guards through the orchestrators.
  const RUNS_AUDIT_JS = 'if [ -f tools/audit.js ]; then node tools/audit.js --hook; fi';
  for (const stack of ['rails', 'go', 'laravel', 'rust']) {
    it(`${stack}: hook scans secrets with Node and installs no .py files`, () => {
      withHarness(FIXTURES[stack], ({ hook, tools }) => {
        assert.ok(hook.split('\n').includes(RUNS_AUDIT_JS), hook);
        assert.ok(tools.includes('audit.js'), tools.join(', '));
        assert.ok(tools.includes('scan_secrets.js'), tools.join(', '));
        assert.deepStrictEqual(tools.filter((f) => f.endsWith('.py')), []);
      });
    });
  }

  it('laravel: runs check_custom.js with its YAML parser', () => {
    withHarness(FIXTURES.laravel, ({ hook, tools }) => {
      assert.ok(hook.split('\n').includes(RUNS_AUDIT_JS), hook);
      assert.ok(!tools.includes('check_custom.py'), tools.join(', '));
      assert.ok(tools.includes('check_custom.js'));
      assert.ok(tools.includes('yaml.js'), 'check_custom.js needs tools/yaml.js');
    });
  });
});

describe('stack hooks: orchestrator follows the installed guards (plan 4)', () => {
  it('rails: only audit.js', () => {
    withHarness(FIXTURES.rails, ({ tools }) => {
      assert.ok(tools.includes('audit.js'));
      assert.ok(!tools.includes('audit.py'));
    });
  });

  it('fastapi: audit.py', () => {
    withHarness(FIXTURES.fastapi, ({ tools }) => {
      assert.ok(tools.includes('audit.py'));
      assert.ok(!tools.includes('audit.js'), 'no JS guards, no JS orchestrator');
    });
  });

  it('next.js with Docker: both orchestrators', () => {
    withHarness(FIXTURES.nextjsDocker, ({ tools }) => {
      assert.ok(tools.includes('docker_guard.py'), tools.join(', '));
      assert.ok(tools.includes('audit.js'));
      assert.ok(tools.includes('audit.py'));
    });
  });

  function runCli(args, cwd) {
    return spawnSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      cwd,
      timeout: 30000,
      env: { ...process.env, CI: '1', ...GIT_ENV },
    });
  }

  const marker = (name, code) => `require('fs').writeFileSync('${name}', 'x');\nprocess.exit(${code});\n`;
  const pyMarker = (name, code) => `import sys\nopen('${name}', 'w').write('x')\nsys.exit(${code})\n`;

  const cases = [
    { js: 0, py: 0, ok: true },
    { js: 0, py: 1, ok: false },
    { js: 1, py: 0, ok: false },
  ];
  for (const c of cases) {
    it(`\`clckernel audit\` runs both orchestrators (js=${c.js}, py=${c.py})`, () => {
      const dir = createTmpProject({
        'tools/audit.js': marker('ran-js', c.js),
        'tools/audit.py': pyMarker('ran-py', c.py),
      });
      try {
        const res = runCli(['audit', dir], path.dirname(dir));
        assert.ok(fs.existsSync(path.join(dir, 'ran-js')), 'audit.js must run');
        assert.ok(fs.existsSync(path.join(dir, 'ran-py')), 'audit.py must run');
        if (c.ok) assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        else assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
      } finally {
        teardown(dir);
      }
    });
  }
});

describe('stack hooks: no silent omissions (plan 5)', () => {
  const files = fs.readdirSync(ADAPTERS_DIR).filter((f) => f.endsWith('.js') && f !== 'base.js');
  for (const file of files) {
    it(`${file}: hook never says "Not run here"`, () => {
      assert.ok(!hookFor(loadAdapter(file)).includes('Not run here'));
    });
  }
});

describe('rails rspec availability matches real lockfiles', () => {
  const { spawnSync } = require('child_process');
  const fsx = require('fs');
  const os = require('os');
  const pathx = require('path');
  const RailsAdapter = require('../src/adapters/rails');

  it('detects RSpec when the lockfile only lists rspec-rails and its rspec-core dependency', () => {
    const tool = new RailsAdapter().getTools().find((t) => t.name === 'rspec');
    const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'clc-rspec-'));
    try {
      fsx.writeFileSync(pathx.join(dir, 'Gemfile.lock'), [
        'GEM', '  remote: https://rubygems.org/', '  specs:',
        '    rspec-core (3.13.0)', '      rspec-support (~> 3.13.0)',
        '    rspec-rails (6.1.0)', '      rspec-core (~> 3.13)',
        '    rspec-support (3.13.1)', '',
      ].join('\n'));
      const res = spawnSync('sh', ['-c', tool.availableIf], { cwd: dir });
      assert.strictEqual(res.status, 0, `availableIf did not match: ${tool.availableIf}`);
    } finally {
      fsx.rmSync(dir, { recursive: true, force: true });
    }
  });
});
