/**
 * tools/verify_tdd.py must prove red→green with pytest, evaluated on the
 * staged content (or HEAD~1 → HEAD when nothing is staged), never on the
 * working copy. Each scenario builds a throwaway git repo with a tiny package.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, hookRunsGuard } = require('./helpers');

const verifyTdd = path.resolve(__dirname, '..', 'tools', 'verify_tdd.py');

const pytestProbe = spawnSync('python3', ['-c', 'import pytest'], { encoding: 'utf-8' });
const skipReason = pytestProbe.status === 0
  ? false
  : 'pytest is not importable by python3 (pip install pytest): red→green scenarios skipped';

const BASE_OPS = 'def add(a, b):\n    return a + b\n';
const BASE_TEST = 'from calc import ops\n\n\ndef test_add():\n    assert ops.add(2, 3) == 5\n';
const MUL_OPS = `${BASE_OPS}\n\ndef mul(a, b):\n    return a * b\n`;
const BROKEN_MUL_OPS = `${BASE_OPS}\n\ndef mul(a, b):\n    return a + b\n`;
const MUL_TEST = `${BASE_TEST}\n\ndef test_mul():\n    assert ops.mul(2, 3) == 6\n`;

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function write(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Repo with one base commit: calc/ops.py + tests/test_ops.py. */
function createRepo() {
  const dir = createTmpProject({
    'calc/__init__.py': '',
    'calc/ops.py': BASE_OPS,
    'tests/test_ops.py': BASE_TEST,
  });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** Write files and stage them. */
function stage(dir, files) {
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git(dir, 'add', ...Object.keys(files));
}

function run(dir, pythonArgs = []) {
  const res = spawnSync('python3', [...pythonArgs, verifyTdd, dir], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, CLC_TDD_TIMEOUT: '60' },
  });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    assert.fail(`verify_tdd printed no JSON (status ${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  return { status: res.status, result: parsed, raw: `${res.stdout}\n${res.stderr}` };
}

function assertOutcome(res, status, fragment) {
  assert.strictEqual(res.status, status, `expected exit ${status}, got ${res.status}:\n${res.raw}`);
  assert.strictEqual(res.result.exit_code, status);
  assert.strictEqual(res.result.name, 'verify_tdd');
  assert.match(res.result.data.message, fragment, res.raw);
}

function withRepo(fn) {
  const dir = createRepo();
  try {
    fn(dir);
  } finally {
    teardown(dir);
  }
}

describe('verify_tdd.py red→green', { skip: skipReason }, () => {
  it('passes a real TDD change: test fails on HEAD and passes on the staged code', () => {
    withRepo((dir) => {
      stage(dir, { 'calc/ops.py': MUL_OPS, 'tests/test_ops.py': MUL_TEST });
      assertOutcome(run(dir), 0, /red.*green verified/i);
    });
  });

  it('fails when the changed tests already pass without the change', () => {
    withRepo((dir) => {
      const alreadyGreen = `${BASE_TEST}\n\ndef test_add_zero():\n    assert ops.add(0, 0) == 0\n`;
      stage(dir, { 'calc/ops.py': MUL_OPS, 'tests/test_ops.py': alreadyGreen });
      assertOutcome(run(dir), 1, /pass without the change/i);
    });
  });

  it('fails when production code changes without any test change', () => {
    withRepo((dir) => {
      stage(dir, { 'calc/ops.py': MUL_OPS });
      assertOutcome(run(dir), 1, /no test evidence/i);
    });
  });

  it('fails when the changed tests do not pass with the change', () => {
    withRepo((dir) => {
      stage(dir, { 'calc/ops.py': BROKEN_MUL_OPS, 'tests/test_ops.py': MUL_TEST });
      assertOutcome(run(dir), 1, /do not pass with the change/i);
    });
  });

  it('passes with a warning when only tests change', () => {
    withRepo((dir) => {
      const extra = `${BASE_TEST}\n\ndef test_add_negative():\n    assert ops.add(-1, 1) == 0\n`;
      stage(dir, { 'tests/test_ops.py': extra });
      const res = run(dir);
      assertOutcome(res, 0, /only tests changed/i);
      assert.ok(res.result.data.warning, 'a characterization-only change must carry a warning');
    });
  });

  it('accepts a collection error on BASE as red (new module, ImportError)', () => {
    withRepo((dir) => {
      stage(dir, {
        'calc/strings.py': 'def shout(s):\n    return s.upper()\n',
        'tests/test_strings.py': 'from calc.strings import shout\n\n\ndef test_shout():\n    assert shout("a") == "A"\n',
      });
      assertOutcome(run(dir), 0, /red.*green verified/i);
    });
  });

  it('evaluates the staged code, not the working copy, and leaves the repo state untouched', () => {
    withRepo((dir) => {
      stage(dir, { 'calc/ops.py': BROKEN_MUL_OPS, 'tests/test_ops.py': MUL_TEST });
      // Working copy is fixed but not staged: the commit would still ship the bug.
      write(dir, 'calc/ops.py', MUL_OPS);

      const before = {
        cached: git(dir, 'diff', '--cached', '--name-only'),
        cachedPatch: git(dir, 'diff', '--cached'),
        status: git(dir, 'status', '--porcelain'),
        head: git(dir, 'rev-parse', 'HEAD'),
        stash: git(dir, 'stash', 'list'),
      };
      assertOutcome(run(dir), 1, /do not pass with the change/i);
      const after = {
        cached: git(dir, 'diff', '--cached', '--name-only'),
        cachedPatch: git(dir, 'diff', '--cached'),
        status: git(dir, 'status', '--porcelain'),
        head: git(dir, 'rev-parse', 'HEAD'),
        stash: git(dir, 'stash', 'list'),
      };
      assert.deepStrictEqual(after, before, 'the guard must not mutate index, HEAD, worktree or stash');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'calc/ops.py'), 'utf-8'), MUL_OPS);
    });
  });

  it('evaluates HEAD~1 → HEAD when nothing is staged', () => {
    withRepo((dir) => {
      stage(dir, { 'calc/ops.py': MUL_OPS, 'tests/test_ops.py': MUL_TEST });
      git(dir, 'commit', '-q', '-m', 'tdd change');
      assertOutcome(run(dir), 0, /red.*green verified/i);

      stage(dir, { 'calc/ops.py': `${MUL_OPS}\n\ndef sub(a, b):\n    return a - b\n` });
      git(dir, 'commit', '-q', '-m', 'untested change');
      assertOutcome(run(dir), 1, /no test evidence/i);
    });
  });

  it('fails closed with an install hint when pytest is not importable', () => {
    withRepo((dir) => {
      stage(dir, { 'calc/ops.py': MUL_OPS, 'tests/test_ops.py': MUL_TEST });
      // -S drops site-packages, so pytest cannot be imported by this interpreter.
      assertOutcome(run(dir, ['-S']), 1, /pip install pytest/);
    });
  });
});

describe('verify_tdd ships with Python backends', () => {
  const { autoDetectStack } = require('../src/detector');
  const { generateHarness } = require('../src/generator');
  const DjangoAdapter = require('../src/adapters/django');
  const FastApiAdapter = require('../src/adapters/fastapi');

  for (const Adapter of [FastApiAdapter, DjangoAdapter]) {
    it(`${Adapter.name} declares verify_tdd in getTools()`, () => {
      const tool = new Adapter().getTools().find((t) => t.name === 'verify_tdd');
      assert.ok(tool, 'verify_tdd must be in the manifest');
      assert.strictEqual(tool.path, 'verify_tdd.py');
      assert.strictEqual(tool.command, 'python3 tools/verify_tdd.py');
    });
  }

  for (const [label, files] of [
    ['FastAPI', { 'requirements.txt': 'fastapi\n' }],
    ['Django', { 'requirements.txt': 'django\n', 'manage.py': '' }],
  ]) {
    it(`the generated ${label} harness copies verify_tdd.py and runs it in the hook`, () => {
      const dir = createTmpProject(files);
      try {
        generateHarness(dir, autoDetectStack(dir));
        assert.ok(fs.existsSync(path.join(dir, 'tools', 'verify_tdd.py')), 'tools/verify_tdd.py must be copied');
        // sdds/unified-discovery: the hook's audit.py call runs it.
        assert.ok(hookRunsGuard(dir, 'verify_tdd.py'), 'hook must run verify_tdd');
      } finally {
        teardown(dir);
      }
    });
  }

  it('the catalog marks verify_tdd as installed', () => {
    const { SAFEGUARD_CATALOG: CATALOG } = require('../src/catalog');
    const entry = CATALOG.find((e) => e.name === 'verify_tdd');
    assert.strictEqual(entry.manifest, true);
  });
});
