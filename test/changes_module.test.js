/**
 * tools/_changes.js and tools/_changes.py are twins: the same cases run
 * against both. They pick the snapshot a guard evaluates (the index when
 * something is staged, else the last commit), list its changed files and read
 * file content from that snapshot instead of the working copy.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const JS_MODULE = path.join(TOOLS, '_changes.js');
const PY_MODULE = path.join(TOOLS, '_changes.py');

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function initRepo(files) {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commitAll(dir, message) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/**
 * Runs the same queries through both implementations.
 * @returns {{ js: object, py: object }} each { mode, files, reads, exists }
 */
function query(dir, { extensions, read = [], exists = [], list = false } = {}) {
  // JS: fresh process so module state never leaks between cases.
  const jsScript = `
    const c = require(${JSON.stringify(JS_MODULE)});
    const dir = process.argv[1];
    const q = JSON.parse(process.argv[2]);
    const { mode, files } = c.changedFiles(dir, { extensions: q.extensions });
    const reads = Object.fromEntries(q.read.map(f => [f, c.readFile(dir, f, mode)]));
    const exists = Object.fromEntries(q.exists.map(f => [f, c.exists(dir, f, mode)]));
    const all = q.list ? c.listFiles(dir, mode) : null;
    process.stdout.write(JSON.stringify({ mode, files, reads, exists, all }));
  `;
  const pyScript = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import _changes as c
d = sys.argv[1]
q = json.loads(sys.argv[2])
r = c.changed_files(d, extensions=q.get("extensions"))
mode = r["mode"]
print(json.dumps({
    "mode": mode,
    "files": r["files"],
    "reads": {f: c.read_file(d, f, mode) for f in q["read"]},
    "exists": {f: c.exists(d, f, mode) for f in q["exists"]},
    "all": c.list_files(d, mode) if q["list"] else None,
}))
`;
  const q = JSON.stringify({ extensions: extensions || null, read, exists, list });
  const js = spawnSync('node', ['-e', jsScript, dir, q], { encoding: 'utf-8' });
  assert.strictEqual(js.status, 0, `js failed: ${js.stderr}`);
  const py = spawnSync('python3', ['-c', pyScript, dir, q], { encoding: 'utf-8' });
  assert.strictEqual(py.status, 0, `py failed: ${py.stderr}`);
  return { js: JSON.parse(js.stdout), py: JSON.parse(py.stdout) };
}

/** Asserts both implementations returned `expected` (a partial shape). */
function assertBoth(result, expected) {
  for (const impl of ['js', 'py']) {
    for (const [key, value] of Object.entries(expected)) {
      assert.deepStrictEqual(result[impl][key], value, `${impl}.${key}`);
    }
  }
}

describe('_changes (JS and Python twins)', () => {
  it('both modules exist side by side in tools/', () => {
    assert.ok(fs.existsSync(JS_MODULE), 'tools/_changes.js');
    assert.ok(fs.existsSync(PY_MODULE), 'tools/_changes.py');
  });

  it('staged mode: lists the staged files and reads the index, not the working copy', () => {
    const dir = initRepo({ 'README.md': '# r\n' });
    try {
      commitAll(dir, 'base');
      write(dir, 'a.js', 'staged\n');
      git(dir, 'add', 'a.js');
      write(dir, 'a.js', 'working copy\n');
      write(dir, 'untracked.js', 'x\n');
      const r = query(dir, { read: ['a.js'], exists: ['a.js', 'untracked.js', 'README.md'] });
      assertBoth(r, {
        mode: 'staged',
        files: ['a.js'],
        reads: { 'a.js': 'staged\n' },
        exists: { 'a.js': true, 'untracked.js': false, 'README.md': true },
      });
    } finally {
      teardown(dir);
    }
  });

  it('last-commit mode: nothing staged evaluates HEAD~1..HEAD and reads HEAD', () => {
    const dir = initRepo({ 'README.md': '# r\n' });
    try {
      commitAll(dir, 'base');
      write(dir, 'b.py', 'committed\n');
      commitAll(dir, 'change');
      write(dir, 'b.py', 'dirty working copy\n');
      write(dir, 'README.md', 'dirty too\n');
      const r = query(dir, { read: ['b.py'], exists: ['b.py', 'nope.py'] });
      assertBoth(r, {
        mode: 'last-commit',
        files: ['b.py'],
        reads: { 'b.py': 'committed\n' },
        exists: { 'b.py': true, 'nope.py': false },
      });
    } finally {
      teardown(dir);
    }
  });

  it('root commit: nothing staged lists every file of HEAD', () => {
    const dir = initRepo({ 'README.md': '# r\n', 'src/c.js': 'c\n' });
    try {
      commitAll(dir, 'root');
      const r = query(dir, { read: ['src/c.js'] });
      assertBoth(r, { mode: 'last-commit', files: ['README.md', 'src/c.js'], reads: { 'src/c.js': 'c\n' } });
    } finally {
      teardown(dir);
    }
  });

  it('no git: mode is null and no files are listed', () => {
    const dir = createTmpProject({ 'a.js': 'x\n' });
    try {
      assertBoth(query(dir), { mode: null, files: [] });
    } finally {
      teardown(dir);
    }
  });

  it('paths with spaces and non-ASCII characters survive (-z)', () => {
    const dir = initRepo({ 'README.md': '# r\n' });
    try {
      commitAll(dir, 'base');
      write(dir, 'my dir/a b.js', 'spaced\n');
      write(dir, 'src/café.py', 'accent\n');
      git(dir, 'add', '-A');
      const r = query(dir, { read: ['my dir/a b.js', 'src/café.py'], exists: ['my dir/a b.js'] });
      assertBoth(r, {
        mode: 'staged',
        files: ['my dir/a b.js', 'src/café.py'],
        reads: { 'my dir/a b.js': 'spaced\n', 'src/café.py': 'accent\n' },
        exists: { 'my dir/a b.js': true },
      });
    } finally {
      teardown(dir);
    }
  });

  it('binary content reads as null', () => {
    const dir = initRepo({ 'README.md': '# r\n' });
    try {
      commitAll(dir, 'base');
      fs.writeFileSync(path.join(dir, 'blob.dat'), Buffer.from([0x41, 0x00, 0x42]));
      git(dir, 'add', 'blob.dat');
      assertBoth(query(dir, { read: ['blob.dat'] }), { mode: 'staged', reads: { 'blob.dat': null } });
    } finally {
      teardown(dir);
    }
  });

  it('a file missing from the snapshot reads as null', () => {
    const dir = initRepo({ 'README.md': '# r\n' });
    try {
      commitAll(dir, 'base');
      write(dir, 'a.js', 'x\n');
      git(dir, 'add', 'a.js');
      assertBoth(query(dir, { read: ['missing.js'] }), { reads: { 'missing.js': null } });
    } finally {
      teardown(dir);
    }
  });

  it('extensions filter the listed files', () => {
    const dir = initRepo({ 'README.md': '# r\n' });
    try {
      commitAll(dir, 'base');
      write(dir, 'a.py', 'x\n');
      write(dir, 'b.js', 'x\n');
      write(dir, 'c.tsx', 'x\n');
      git(dir, 'add', '-A');
      assertBoth(query(dir, { extensions: ['.js', '.tsx'] }), { files: ['b.js', 'c.tsx'] });
    } finally {
      teardown(dir);
    }
  });

  it('a staged deletion alone keeps staged mode with nothing to evaluate', () => {
    // Deletions are part of what is being committed: falling back to the last
    // commit would evaluate a snapshot other than the one being verified.
    const dir = initRepo({ 'README.md': '# r\n', 'gone.js': 'x\n' });
    try {
      commitAll(dir, 'base');
      git(dir, 'rm', '-q', 'gone.js');
      assertBoth(query(dir), { mode: 'staged', files: [] });
    } finally {
      teardown(dir);
    }
  });

  describe('listFiles / list_files: every file of the snapshot (sorted, registry included)', () => {
    it('staged mode lists the index, not the working copy, from the repository root', () => {
      const dir = initRepo({ 'README.md': '# r\n', 'skills/a/SKILL.md': 'a\n' });
      try {
        commitAll(dir, 'base');
        write(dir, 'playbooks/new.md', 'n\n');
        git(dir, 'add', 'playbooks/new.md');
        write(dir, 'untracked.md', 'u\n');
        const r = query(dir, { list: true });
        assertBoth(r, { mode: 'staged', all: ['README.md', 'playbooks/new.md', 'skills/a/SKILL.md'] });
      } finally {
        teardown(dir);
      }
    });

    it('last-commit mode lists HEAD', () => {
      const dir = initRepo({ 'README.md': '# r\n', 'my dir/café.md': 'c\n' });
      try {
        commitAll(dir, 'base');
        write(dir, 'dirty.md', 'd\n');
        assertBoth(query(dir, { list: true }), { mode: 'last-commit', all: ['README.md', 'my dir/café.md'] });
      } finally {
        teardown(dir);
      }
    });

    it('no git lists nothing', () => {
      const dir = createTmpProject({ 'a.md': 'x\n' });
      try {
        assertBoth(query(dir, { list: true }), { mode: null, all: [] });
      } finally {
        teardown(dir);
      }
    });
  });
});
