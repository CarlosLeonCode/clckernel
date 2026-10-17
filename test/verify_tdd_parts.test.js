/**
 * sdds/fullstack-monorepo, decision 5 (TDD plan items 4 and 5): verify_tdd
 * (Python and JS) groups the changed files by their nearest project root and
 * runs red/green for each group with cwd = that root in the temporary tree.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;

const pytestAvailable = spawnSync('python3', ['-c', 'import pytest'], { encoding: 'utf-8' }).status === 0;
const skipPy = pytestAvailable ? false : 'pytest is not importable by python3';

function env() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) out[key] = value;
  }
  return { ...out, CLC_TDD_TIMEOUT: '60' };
}

function runVerifier(cmd, script, dir) {
  const res = spawnSync(cmd, [path.join(TOOLS, script), dir], { cwd: dir, encoding: 'utf-8', env: env() });
  let result = null;
  try {
    result = JSON.parse(res.stdout);
  } catch {
    assert.fail(`${script} printed no JSON (status ${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  return { status: res.status, data: result.data, raw: `${res.stdout}\n${res.stderr}` };
}

const runPy = (dir) => runVerifier('python3', 'verify_tdd.py', dir);
const runJs = (dir) => runVerifier(process.execPath, 'verify_tdd.js', dir);

// apps/api is a Python project whose package `app` is importable only from apps/api.
const PY_MONOREPO = {
  'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['apps/*'] }),
  'apps/api/requirements.txt': 'fastapi\n',
  'apps/api/app/__init__.py': '',
  'apps/api/app/calc.py': 'def add(a, b):\n    return a + b\n',
  'apps/web/package.json': PACKAGE({ name: 'web', private: true }),
  'apps/web/src/sum.js': 'module.exports = (a, b) => a + b;\n',
};

const CALC_WITH_MUL = 'def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n';
const MUL_TEST = 'from app.calc import mul\n\n\ndef test_mul():\n    assert mul(2, 3) == 6\n';

describe('verify_tdd.py — one project root per file', { skip: skipPy }, () => {
  it('a test in apps/api importing app.calc runs with cwd/PYTHONPATH = apps/api: red->green verified', () => {
    const dir = createGitRepo(PY_MONOREPO, {
      'apps/api/app/calc.py': CALC_WITH_MUL,
      'apps/api/tests/test_calc.py': MUL_TEST,
    });
    try {
      const res = runPy(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.match(res.data.message, /TDD red->green verified: 1 test file\(s\)/, res.raw);
      assert.strictEqual(res.data.root, 'apps/api', res.raw);
      assert.ok(!/No module named 'app'/.test(res.data.red.output), `red must fail on the missing mul, not on app:\n${res.raw}`);
      assert.match(res.data.red.output, /mul/, res.raw);
    } finally {
      teardown(dir);
    }
  });

  it('code in apps/api without a test there fails, even though apps/worker brings a test', () => {
    const dir = createGitRepo({
      ...PY_MONOREPO,
      'apps/worker/requirements.txt': 'celery\n',
      'apps/worker/jobs.py': 'def run():\n    return 1\n',
    }, {
      'apps/api/app/calc.py': CALC_WITH_MUL,
      'apps/worker/tests/test_jobs.py': 'from jobs import run\n\n\ndef test_run():\n    assert run() == 1\n',
    });
    try {
      const res = runPy(dir);
      assert.strictEqual(res.status, 1, res.raw);
      assert.match(res.data.message, /\[apps\/api\] No test evidence/, res.raw);
      const groups = Object.fromEntries(res.data.groups.map((g) => [g.root, g]));
      assert.deepStrictEqual(Object.keys(groups).sort(), ['apps/api', 'apps/worker']);
      assert.strictEqual(groups['apps/api'].exit_code, 1);
      assert.strictEqual(groups['apps/worker'].exit_code, 0, 'a tests-only group is allowed');
    } finally {
      teardown(dir);
    }
  });

  it('every group with code and tests is verified; all pass -> exit 0', () => {
    const dir = createGitRepo({
      ...PY_MONOREPO,
      'apps/worker/requirements.txt': 'celery\n',
      'apps/worker/jobs.py': 'def run():\n    return 1\n',
    }, {
      'apps/api/app/calc.py': CALC_WITH_MUL,
      'apps/api/tests/test_calc.py': MUL_TEST,
      'apps/worker/jobs.py': 'def run():\n    return 1\n\n\ndef stop():\n    return 0\n',
      'apps/worker/tests/test_jobs.py': 'from jobs import stop\n\n\ndef test_stop():\n    assert stop() == 0\n',
    });
    try {
      const res = runPy(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.ok(res.data.groups.every((g) => g.exit_code === 0), res.raw);
      assert.match(res.data.message, /\[apps\/api\] TDD red->green verified/, res.raw);
      assert.match(res.data.message, /\[apps\/worker\] TDD red->green verified/, res.raw);
    } finally {
      teardown(dir);
    }
  });
});

/**
 * Fake vitest: prints where it ran and which node_modules it came from, then
 * runs the given files with node:test (so red/green are real).
 */
function fakeVitest(origin) {
  return [
    '#!/usr/bin/env node',
    "const { spawnSync } = require('child_process');",
    `console.log('FAKE_VITEST origin=${origin} cwd=' + process.cwd());`,
    "const files = process.argv.slice(2).filter((a) => a !== 'run');",
    "const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });",
    'process.exit(res.status === null ? 1 : res.status);',
    '',
  ].join('\n');
}

function installBin(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
}

const JS_MONOREPO = {
  '.gitignore': 'node_modules/\n',
  'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['apps/*'] }),
  'apps/web/package.json': PACKAGE({ name: 'web', private: true, devDependencies: { vitest: '^1.0.0' } }),
  'apps/web/src/sum.js': 'module.exports = (a, b) => a + b;\n',
  'apps/api/package.json': PACKAGE({ name: 'api', private: true }),
  'apps/api/src/id.js': 'module.exports = (x) => x;\n',
};
const WEB_CHANGE = {
  'apps/web/src/mul.js': 'module.exports = (a, b) => a * b;\n',
  'apps/web/src/mul.test.js': [
    "const { test } = require('node:test');",
    "const assert = require('node:assert');",
    "const mul = require('./mul');",
    "test('mul', () => assert.strictEqual(mul(2, 3), 6));",
    '',
  ].join('\n'),
};

describe('verify_tdd.js — one project root per file', () => {
  it('a test in apps/web runs with the runner of apps/web/package.json and the hoisted node_modules', () => {
    const dir = createGitRepo(JS_MONOREPO, WEB_CHANGE);
    installBin(dir, 'node_modules/.bin/vitest', fakeVitest('root'));
    try {
      const res = runJs(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.strictEqual(res.data.runner, 'vitest', res.raw);
      assert.strictEqual(res.data.root, 'apps/web', res.raw);
      assert.match(res.data.green.output, /FAKE_VITEST origin=root cwd=\S+\/candidate\/apps\/web/, res.raw);
      assert.match(res.data.message, /TDD red->green verified: 1 test file\(s\)/, res.raw);
      assert.ok(fs.existsSync(path.join(dir, 'node_modules', '.bin', 'vitest')), 'the linked target must survive');
    } finally {
      teardown(dir);
    }
  });

  it("the group's own node_modules wins over the hoisted one", () => {
    const dir = createGitRepo(JS_MONOREPO, WEB_CHANGE);
    installBin(dir, 'node_modules/.bin/vitest', fakeVitest('root'));
    installBin(dir, 'apps/web/node_modules/.bin/vitest', fakeVitest('web'));
    try {
      const res = runJs(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.match(res.data.green.output, /FAKE_VITEST origin=web /, res.raw);
      assert.ok(fs.existsSync(path.join(dir, 'apps', 'web', 'node_modules', '.bin', 'vitest')));
    } finally {
      teardown(dir);
    }
  });

  it('code in apps/api without a test there fails, even though apps/web brings a test', () => {
    const dir = createGitRepo(JS_MONOREPO, {
      ...WEB_CHANGE,
      'apps/api/src/id.js': 'module.exports = (x) => x;\nmodule.exports.twice = (x) => [x, x];\n',
    });
    installBin(dir, 'node_modules/.bin/vitest', fakeVitest('root'));
    try {
      const res = runJs(dir);
      assert.strictEqual(res.status, 1, res.raw);
      assert.match(res.data.message, /\[apps\/api\] No test evidence/, res.raw);
      const groups = Object.fromEntries(res.data.groups.map((g) => [g.root, g]));
      assert.strictEqual(groups['apps/api'].exit_code, 1);
      assert.strictEqual(groups['apps/web'].exit_code, 0, res.raw);
    } finally {
      teardown(dir);
    }
  });
});
