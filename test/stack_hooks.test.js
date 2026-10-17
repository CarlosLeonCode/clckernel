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

function hookPath(dir, adapter) {
  return path.join(dir, adapter.projectType === 'frontend' ? '.husky' : '.githooks', 'pre-commit');
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

function guardedLine(name, availableIf, command) {
  return `if ${availableIf} >/dev/null 2>&1; then ${command}; else echo "clckernel: ${name} not available, skipped"; fi`;
}

// Spec table: tool -> availableIf, per adapter (decision 1).
const EXTERNAL_TOOLS = {
  'astro.js': [
    ['astro_check', '[ -x node_modules/.bin/astro ]', 'npx astro check'],
    ['vitest', '[ -x node_modules/.bin/vitest ]', 'npx vitest run'],
  ],
  'nextjs.js': [
    ['tsc', '[ -x node_modules/.bin/tsc ]', 'npx tsc --noEmit'],
    ['lint', '[ -x node_modules/.bin/lint-staged ]', 'npx lint-staged'],
  ],
  'fastapi.js': [
    ['ruff', 'python3 -m ruff --version', 'python3 -m ruff check .'],
    ['pytest', 'python3 -m pytest --version', 'python3 -m pytest'],
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
    return spawnSync(shell, [hook], { cwd: dir, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV, PATH } });
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
  for (const stack of ['rails', 'go', 'laravel', 'rust']) {
    it(`${stack}: hook scans secrets with Node and installs no .py files`, () => {
      withHarness(FIXTURES[stack], ({ hook, tools }) => {
        assert.ok(hook.split('\n').includes('node tools/scan_secrets.js'), hook);
        assert.ok(tools.includes('scan_secrets.js'), tools.join(', '));
        assert.deepStrictEqual(tools.filter((f) => f.endsWith('.py')), []);
      });
    });
  }

  it('laravel: runs check_custom.js with its YAML parser', () => {
    withHarness(FIXTURES.laravel, ({ hook, tools }) => {
      assert.ok(hook.split('\n').includes('node tools/check_custom.js'), hook);
      assert.ok(!hook.includes('check_custom.py'), hook);
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
