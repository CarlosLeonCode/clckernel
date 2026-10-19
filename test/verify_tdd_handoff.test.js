/**
 * sdds/residual-fixes item 5: `tdd.code` hands a file to the other-language
 * verifier. A file native to one verifier (.py for verify_tdd.py, JS/TS for
 * verify_tdd.js) that matches `tdd.code` belongs to the other verifier when
 * that one is installed next to it, so each file has exactly one owner (e.g.
 * Python tools tested by JS tests no longer fail verify_tdd.py). Without the
 * other verifier nothing changes.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const PY_TOOLS = ['verify_tdd.py', '_changes.py', '_config.py', '_yaml.py'];
const JS_TOOLS = ['verify_tdd.js', '_changes.js', '_config.js', 'yaml.js'];

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env: ENV });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/**
 * A committed repo with the given verifiers in tools/ (registered as managed,
 * so they are not themselves changes), the config, and `staged` staged.
 */
function repo(tools, config, staged) {
  const files = {
    'package.json': JSON.stringify({ name: 'p', private: true, scripts: { test: 'node --test' } }),
    '.clckernel.yaml': config,
    'tools/.clckernel-managed.json': `${JSON.stringify([...tools.map((t) => `tools/${t}`), 'tools/.clckernel-managed.json'])}\n`,
  };
  for (const t of tools) files[`tools/${t}`] = fs.readFileSync(path.join(ROOT, 'tools', t), 'utf-8');
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  for (const [rel, content] of Object.entries(staged)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  git(dir, 'add', '-A');
  return dir;
}

function verify(dir, file) {
  const cmd = file.endsWith('.py') ? 'python3' : process.execPath;
  const res = spawnSync(cmd, [path.join('tools', file)], { cwd: dir, encoding: 'utf-8', env: ENV });
  return { status: res.status, data: JSON.parse(res.stdout).data, raw: `${res.stdout}${res.stderr}` };
}

const PY_CODE_CONFIG = 'tdd:\n  code:\n    - "scripts/**/*.py"\n';
const JS_CODE_CONFIG = 'tdd:\n  code:\n    - "scripts/**/*.js"\n';

describe('tdd.code hands a native file to the other verifier (sdds/residual-fixes item 5)', () => {
  it('both verifiers: a .py file in tdd.code is not verify_tdd.py code', () => {
    const dir = repo([...PY_TOOLS, ...JS_TOOLS], PY_CODE_CONFIG, { 'scripts/gen.py': 'print(1)\n' });
    try {
      const py = verify(dir, 'verify_tdd.py');
      assert.strictEqual(py.status, 0, py.raw);
      assert.deepStrictEqual(py.data.changed_code, []);
      const js = verify(dir, 'verify_tdd.js');
      assert.deepStrictEqual(js.data.changed_code, ['scripts/gen.py'], js.raw);
    } finally {
      teardown(dir);
    }
  });

  it('only verify_tdd.py: a .py file in tdd.code still needs a pytest test', () => {
    const dir = repo(PY_TOOLS, PY_CODE_CONFIG, { 'scripts/gen.py': 'print(1)\n' });
    try {
      const py = verify(dir, 'verify_tdd.py');
      assert.strictEqual(py.status, 1, py.raw);
      assert.deepStrictEqual(py.data.changed_code, ['scripts/gen.py']);
      assert.match(py.data.message, /No test evidence/);
    } finally {
      teardown(dir);
    }
  });

  it('both verifiers: a .js file in tdd.code is not verify_tdd.js code', () => {
    const dir = repo([...PY_TOOLS, ...JS_TOOLS], JS_CODE_CONFIG, { 'scripts/gen.js': 'module.exports = 1;\n' });
    try {
      const js = verify(dir, 'verify_tdd.js');
      assert.strictEqual(js.status, 0, js.raw);
      assert.deepStrictEqual(js.data.changed_code, []);
      const py = verify(dir, 'verify_tdd.py');
      assert.deepStrictEqual(py.data.changed_code, ['scripts/gen.js'], py.raw);
    } finally {
      teardown(dir);
    }
  });

  it('only verify_tdd.js: a .js file in tdd.code still needs a JS test', () => {
    const dir = repo(JS_TOOLS, JS_CODE_CONFIG, { 'scripts/gen.js': 'module.exports = 1;\n' });
    try {
      const js = verify(dir, 'verify_tdd.js');
      assert.strictEqual(js.status, 1, js.raw);
      assert.deepStrictEqual(js.data.changed_code, ['scripts/gen.js']);
      assert.match(js.data.message, /No test evidence/);
    } finally {
      teardown(dir);
    }
  });

  it('both verifiers: a .py file outside tdd.code stays verify_tdd.py code', () => {
    const dir = repo([...PY_TOOLS, ...JS_TOOLS], PY_CODE_CONFIG, { 'app/core.py': 'x = 1\n' });
    try {
      const py = verify(dir, 'verify_tdd.py');
      assert.strictEqual(py.status, 1, py.raw);
      assert.deepStrictEqual(py.data.changed_code, ['app/core.py']);
    } finally {
      teardown(dir);
    }
  });
});
