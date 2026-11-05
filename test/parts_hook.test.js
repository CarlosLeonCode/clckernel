/**
 * sdds/fullstack-monorepo, decision 4 (TDD plan item 3): each external tool
 * of a part runs in that part's directory. Uses a fake adapter whose only
 * external tool is `clc_fake_tool`, an executable put on PATH by the test that
 * prints its working directory and exits with $CLC_FAKE_EXIT. The hook is run
 * with bash and with sh, directly and through a real `git commit`.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const BaseAdapter = require('../src/adapters/base');
const { generateHarness } = require('../src/generator');
const { createTmpProject, teardown, git } = require('./helpers');

class FakeAdapter extends BaseAdapter {
  constructor(name, toolName) {
    super(name, 'backend', 'fake test');
    this.toolName = toolName;
  }

  getTools() {
    return [{
      name: this.toolName, language: 'external', path: '', command: this.toolName,
      description: 'Fake external tool', availableIf: `command -v ${this.toolName}`,
    }];
  }
}

/** A repo with two parts: svc/api (fake tool) and the root (second fake tool). */
function fakeRepo() {
  const dir = createTmpProject({ 'svc/api/main.txt': 'api\n', 'README.md': '# repo\n' });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  const api = new FakeAdapter('Fake API', 'clc_fake_tool');
  const root = new FakeAdapter('Fake Root', 'clc_fake_root');
  const parts = [
    { dir: 'svc/api', adapter: api, framework: api.name, projectType: 'backend', testRunner: 'fake test' },
    { dir: '.', adapter: root, framework: root.name, projectType: 'backend', testRunner: 'fake test' },
  ];
  const config = {
    projectType: 'fullstack', framework: 'Fake API + Fake Root', styling: 'N/A', uiLibrary: 'N/A',
    testRunner: 'fake test', gitHooks: 'githooks', orm: 'Framework Native', adapter: api, parts, techTools: [],
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    generateHarness(dir, config);
  } finally {
    console.warn = warn;
  }
  return dir;
}

/** Directory holding the fake tools, prepended to PATH. */
function fakeBin(tools = ['clc_fake_tool', 'clc_fake_root']) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-fake-bin-'));
  for (const tool of tools) {
    const file = path.join(bin, tool);
    fs.writeFileSync(file, `#!/bin/sh\necho "${tool} pwd=$(pwd -P)"\nexit "\${CLC_FAKE_EXIT:-0}"\n`);
    fs.chmodSync(file, 0o755);
  }
  return bin;
}

function env(bin, extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) out[key] = value;
  }
  const PATH = bin ? `${bin}${path.delimiter}${out.PATH}` : out.PATH;
  return { ...out, PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

function runHook(shell, dir, bin, extra) {
  const res = spawnSync(shell, ['.githooks/pre-commit'], { cwd: dir, encoding: 'utf-8', env: env(bin, extra) });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('external tools run in their part dir', () => {
  for (const shell of ['bash', 'sh']) {
    it(`${shell}: the tool runs inside svc/api, the root tool at the root`, () => {
      const dir = fakeRepo();
      const bin = fakeBin();
      try {
        const res = runHook(shell, dir, bin);
        assert.strictEqual(res.status, 0, res.output);
        const real = fs.realpathSync(dir);
        assert.ok(res.output.includes(`clc_fake_tool pwd=${path.join(real, 'svc', 'api')}\n`), res.output);
        assert.ok(res.output.includes(`clc_fake_root pwd=${real}\n`), res.output);
      } finally {
        teardown(dir);
        teardown(bin);
      }
    });

    it(`${shell}: a failing tool fails the hook (set -e survives the subshell)`, () => {
      const dir = fakeRepo();
      const bin = fakeBin(['clc_fake_tool']);
      try {
        const res = runHook(shell, dir, bin, { CLC_FAKE_EXIT: '3' });
        assert.notStrictEqual(res.status, 0, res.output);
        assert.ok(!res.output.includes('clc_fake_root'), `the hook must stop at the failure:\n${res.output}`);
      } finally {
        teardown(dir);
        teardown(bin);
      }
    });

    it(`${shell}: a missing tool is skipped with its dir named, and the hook passes`, () => {
      const dir = fakeRepo();
      try {
        const res = runHook(shell, dir, null);
        assert.strictEqual(res.status, 0, res.output);
        assert.ok(res.output.includes('clckernel: clc_fake_tool (svc/api) not available, skipped'), res.output);
        assert.ok(res.output.includes('clckernel: clc_fake_root (.) not available, skipped'), res.output);
      } finally {
        teardown(dir);
      }
    });
  }

  it('git commit: the hook runs the tool in svc/api; a failure blocks the commit', () => {
    const dir = fakeRepo();
    const bin = fakeBin();
    try {
      git(dir, 'config', 'core.hooksPath', '.githooks');
      spawnSync('git', ['add', '-A'], { cwd: dir, env: env(bin) });
      const blocked = spawnSync('git', ['commit', '-m', 'blocked'], { cwd: dir, encoding: 'utf-8', env: env(bin, { CLC_FAKE_EXIT: '1' }) });
      assert.notStrictEqual(blocked.status, 0, `${blocked.stdout}${blocked.stderr}`);

      const ok = spawnSync('git', ['commit', '-m', 'ok'], { cwd: dir, encoding: 'utf-8', env: env(bin) });
      const output = `${ok.stdout}${ok.stderr}`;
      assert.strictEqual(ok.status, 0, output);
      assert.ok(output.includes(`clc_fake_tool pwd=${path.join(fs.realpathSync(dir), 'svc', 'api')}`), output);
    } finally {
      teardown(dir);
      teardown(bin);
    }
  });
});

/**
 * sdds/monorepo-ts-library-parts: with real detection, a TypeScript library
 * in packages/* is a part whose `tsc --noEmit` runs inside the package, with
 * the binary hoisted to the root node_modules/.bin, and a type error (tsc
 * exiting non-zero) fails the hook. AGENTS.md lists the library part.
 */
describe('TypeScript library parts: tsc runs inside packages/<lib>', () => {
  const { autoDetectStack } = require('../src/detector');
  const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;
  const TSCONFIG = '{ "compilerOptions": { "strict": true } }\n';

  function libraryMonorepo() {
    const dir = createTmpProject({
      'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['apps/*', 'packages/*'] }),
      'apps/web/package.json': PACKAGE({ name: 'web', private: true, dependencies: { next: '^16.0.0' } }),
      'packages/core/package.json': PACKAGE({ name: 'core', private: true, devDependencies: { vitest: '^2.0.0' } }),
      'packages/core/tsconfig.json': TSCONFIG,
      'packages/core/src/index.ts': 'export const total = 1;\n',
    });
    // The hoisted binary (npm workspaces): prints where it ran and its args.
    const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
    fs.mkdirSync(path.dirname(tsc), { recursive: true });
    // It exits 2 (a type error) only in the dir named by $CLC_FAKE_FAIL_IN.
    fs.writeFileSync(tsc, '#!/bin/sh\necho "fake-tsc pwd=$(pwd -P) args=$*"\ncase "$(pwd -P)" in */"${CLC_FAKE_FAIL_IN:-none}") exit 2 ;; esac\n');
    fs.chmodSync(tsc, 0o755);
    git(dir, 'init', '-q');
    const warn = console.warn;
    console.warn = () => {};
    try {
      generateHarness(dir, autoDetectStack(dir));
    } finally {
      console.warn = warn;
    }
    return dir;
  }

  it('the hook runs the hoisted tsc --noEmit inside packages/core', () => {
    const dir = libraryMonorepo();
    try {
      const hook = fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf-8');
      assert.ok(hook.includes("( cd 'packages/core' && if [ -x node_modules/.bin/tsc ]; then node_modules/.bin/tsc --noEmit;"), hook);
      assert.ok(hook.includes('elif [ -x ../../node_modules/.bin/tsc ]; then ../../node_modules/.bin/tsc --noEmit;'), hook);
      assert.ok(hook.includes('clckernel: tsc (packages/core) not available, skipped'), hook);
      const res = runHook('bash', dir, null);
      assert.strictEqual(res.status, 0, res.output);
      const real = fs.realpathSync(dir);
      assert.ok(res.output.includes(`fake-tsc pwd=${path.join(real, 'packages', 'core')} args=--noEmit\n`), res.output);
    } finally {
      teardown(dir);
    }
  });

  it('a type error in the library (tsc exits non-zero there only) fails the hook', () => {
    const dir = libraryMonorepo();
    try {
      const res = runHook('bash', dir, null, { CLC_FAKE_FAIL_IN: 'packages/core' });
      assert.notStrictEqual(res.status, 0, res.output);
      assert.ok(res.output.includes(`fake-tsc pwd=${path.join(fs.realpathSync(dir), 'packages', 'core')}`), res.output);
    } finally {
      teardown(dir);
    }
  });

  it('AGENTS.md lists the library part with its stack and test runner', () => {
    const dir = libraryMonorepo();
    try {
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.ok(agents.includes('| `packages/core` | TypeScript Library | Vitest |'), agents);
      assert.ok(agents.includes('| `apps/web` | Next.js (App Router) | Vitest / Jest |'), agents);
    } finally {
      teardown(dir);
    }
  });
});

/**
 * sdds/monorepo-library-parts: with real detection, a pure Python library
 * monorepo (packages/core, packages/util with pyproject.toml, no framework)
 * is a monorepo of Python Library parts. pytest runs inside each part, a
 * failing pytest fails the hook, and exit 5 (no tests collected) does not.
 * A fake `python3` on PATH answers `-m pytest` (printing where it ran) and
 * `-m ruff` (unavailable), and hands everything else to the real python3.
 */
describe('Python library parts: pytest runs inside packages/<lib>', () => {
  const { autoDetectStack } = require('../src/detector');
  const PYPROJECT = (name) => `[project]\nname = "${name}"\nversion = "0.1.0"\n`;

  function pythonLibraryMonorepo() {
    const dir = createTmpProject({
      'packages/core/pyproject.toml': PYPROJECT('core'),
      'packages/core/src/core/__init__.py': '',
      'packages/util/pyproject.toml': PYPROJECT('util'),
      'packages/util/src/util/__init__.py': '',
    });
    git(dir, 'init', '-q');
    const warn = console.warn;
    console.warn = () => {};
    try {
      generateHarness(dir, autoDetectStack(dir));
    } finally {
      console.warn = warn;
    }
    return dir;
  }

  /** PATH dir with the fake python3; pytest exits $CLC_FAKE_EXIT only in the dir named by $CLC_FAKE_FAIL_IN. */
  function fakePython() {
    const real = spawnSync('sh', ['-c', 'command -v python3'], { encoding: 'utf-8' }).stdout.trim();
    assert.ok(real, 'python3 is required by the suite');
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-fake-py-'));
    fs.writeFileSync(path.join(bin, 'python3'), [
      '#!/bin/sh',
      'if [ "$1" = "-m" ] && [ "$2" = "ruff" ]; then exit 127; fi',
      'if [ "$1" = "-m" ] && [ "$2" = "pytest" ]; then',
      '  [ "$3" = "--version" ] && exit 0',
      '  echo "fake-pytest pwd=$(pwd -P)"',
      '  case "$(pwd -P)" in */"${CLC_FAKE_FAIL_IN:-none}") exit "${CLC_FAKE_EXIT:-1}" ;; esac',
      '  exit 0',
      'fi',
      `exec '${real}' "$@"`,
      '',
    ].join('\n'));
    fs.chmodSync(path.join(bin, 'python3'), 0o755);
    return bin;
  }

  it('detects a monorepo of Python Library parts and AGENTS.md lists them', () => {
    const dir = pythonLibraryMonorepo();
    try {
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.ok(agents.includes('| `packages/core` | Python Library | Pytest |'), agents);
      assert.ok(agents.includes('| `packages/util` | Python Library | Pytest |'), agents);
      const hook = fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf-8');
      assert.ok(hook.includes("( cd 'packages/core' && if python3 -m pytest --version >/dev/null 2>&1; then python3 -m pytest || [ $? -eq 5 ];"), hook);
    } finally {
      teardown(dir);
    }
  });

  it('pytest runs inside each part and the hook passes', () => {
    const dir = pythonLibraryMonorepo();
    const bin = fakePython();
    try {
      const res = runHook('bash', dir, bin);
      assert.strictEqual(res.status, 0, res.output);
      const real = fs.realpathSync(dir);
      assert.ok(res.output.includes(`fake-pytest pwd=${path.join(real, 'packages', 'core')}\n`), res.output);
      assert.ok(res.output.includes(`fake-pytest pwd=${path.join(real, 'packages', 'util')}\n`), res.output);
      assert.ok(res.output.includes('clckernel: ruff (packages/core) not available, skipped'), res.output);
    } finally {
      teardown(dir);
      teardown(bin);
    }
  });

  it('a failing pytest in one library fails the hook', () => {
    const dir = pythonLibraryMonorepo();
    const bin = fakePython();
    try {
      const res = runHook('bash', dir, bin, { CLC_FAKE_FAIL_IN: 'packages/util', CLC_FAKE_EXIT: '1' });
      assert.notStrictEqual(res.status, 0, res.output);
      assert.ok(res.output.includes(`fake-pytest pwd=${path.join(fs.realpathSync(dir), 'packages', 'util')}`), res.output);
    } finally {
      teardown(dir);
      teardown(bin);
    }
  });

  it('pytest exit 5 (no tests collected) does not fail the hook', () => {
    const dir = pythonLibraryMonorepo();
    const bin = fakePython();
    try {
      const res = runHook('bash', dir, bin, { CLC_FAKE_FAIL_IN: 'packages/util', CLC_FAKE_EXIT: '5' });
      assert.strictEqual(res.status, 0, res.output);
    } finally {
      teardown(dir);
      teardown(bin);
    }
  });
});
