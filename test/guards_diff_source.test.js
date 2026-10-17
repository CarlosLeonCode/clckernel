const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const scanJs = path.resolve(__dirname, '..', 'tools', 'scan_secrets.js');
const scanPy = path.resolve(__dirname, '..', 'tools', 'scan_secrets.py');

// Lowercase key so the case-sensitive Python pattern matches as well.
// Built at runtime so this fixture does not trip the repo's own secret scan.
const FAKE_KEY = ['abcdefghijklmnop', 'qrstuvwxyz123456'].join('');
const SECRET_LINE = `const api_key = "${FAKE_KEY}";\n`;

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** Repo with two clean commits, so HEAD~1 resolves to a clean diff. */
function createRepo() {
  const dir = createTmpProject({ 'README.md': '# clean\n' });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'initial');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'nothing secret here\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'second clean commit');
  return dir;
}

function runJs(dir) {
  return spawnSync('node', [scanJs, dir], { cwd: dir, encoding: 'utf-8' });
}

function runPy(dir) {
  return spawnSync('python3', [scanPy, dir], { cwd: dir, encoding: 'utf-8' });
}

describe('guards scan the staged diff first', () => {
  it('scan_secrets.js detects a secret that is staged but not committed', () => {
    const dir = createRepo();
    try {
      fs.writeFileSync(path.join(dir, 'config.js'), SECRET_LINE);
      git(dir, 'add', 'config.js');
      const res = runJs(dir);
      assert.strictEqual(res.status, 1, `expected failure, got: ${res.stdout}`);
      assert.ok(JSON.parse(res.stdout).data.findings['config.js'], 'staged file must be reported');
    } finally {
      teardown(dir);
    }
  });

  it('scan_secrets.py detects a secret that is staged but not committed', () => {
    const dir = createRepo();
    try {
      fs.writeFileSync(path.join(dir, 'config.js'), SECRET_LINE);
      git(dir, 'add', 'config.js');
      const res = runPy(dir);
      assert.strictEqual(res.status, 1, `expected failure, got: ${res.stdout}`);
      assert.ok(JSON.parse(res.stdout).data.findings['config.js'], 'staged file must be reported');
    } finally {
      teardown(dir);
    }
  });

  it('both scanners scan only the staged files when something is staged', () => {
    // A secret already in the last commit is outside this commit's scope:
    // the gate must review exactly what is being committed.
    const dir = createRepo();
    try {
      fs.writeFileSync(path.join(dir, 'config.js'), SECRET_LINE);
      git(dir, 'add', 'config.js');
      git(dir, 'commit', '-q', '-m', 'old leak');
      fs.writeFileSync(path.join(dir, 'clean.js'), 'module.exports = 1;\n');
      git(dir, 'add', 'clean.js');
      const js = runJs(dir);
      const py = runPy(dir);
      assert.strictEqual(js.status, 0, `js must only scan staged files, got: ${js.stdout}`);
      assert.strictEqual(py.status, 0, `py must only scan staged files, got: ${py.stdout}`);
    } finally {
      teardown(dir);
    }
  });

  it('both scanners fall back to HEAD~1 when nothing is staged', () => {
    const dir = createRepo();
    try {
      fs.writeFileSync(path.join(dir, 'config.js'), SECRET_LINE);
      git(dir, 'add', 'config.js');
      git(dir, 'commit', '-q', '-m', 'leak');
      const js = runJs(dir);
      const py = runPy(dir);
      assert.strictEqual(js.status, 1, `js expected failure, got: ${js.stdout}`);
      assert.strictEqual(py.status, 1, `py expected failure, got: ${py.stdout}`);
      assert.ok(JSON.parse(js.stdout).data.findings['config.js']);
      assert.ok(JSON.parse(py.stdout).data.findings['config.js']);
    } finally {
      teardown(dir);
    }
  });
});
