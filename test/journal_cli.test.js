/**
 * sdds/decision-log: `clckernel journal <change> [targetDir]` creates the
 * journal entry of an SDD change from a template the guard accepts (TDD plan
 * item 2). The clock is injected through createEntry's `now` option.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, createGitRepo, stageFiles, teardown, git } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const NOW = new Date('2026-11-06T13:05:42.123Z');

const cli = (args, cwd = ROOT) => {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, out: `${res.stdout}${res.stderr}` };
};
const loadJournal = () => require('../src/journal');

describe('item 2: createEntry writes the entry of a change', () => {
  it('creates docs/Journal/<YYYY>/<YYYYMMDDTHHMMZ>-<change>.md from the injected clock (UTC)', () => {
    const dir = createTmpProject({});
    try {
      const created = loadJournal().createEntry(dir, 'add-cache', { now: NOW });
      assert.strictEqual(created.rel, 'docs/Journal/2026/20261106T1305Z-add-cache.md');
      assert.strictEqual(created.path, path.join(dir, 'docs', 'Journal', '2026', '20261106T1305Z-add-cache.md'));
      assert.ok(fs.existsSync(created.path));
    } finally {
      teardown(dir);
    }
  });

  it('the content has the frontmatter, the four sections, and passes the guard', async () => {
    const dir = createGitRepo({ 'README.md': '# x\n', 'sdds/.gitkeep': '' });
    try {
      const { rel } = loadJournal().createEntry(dir, 'add-cache', { now: NOW });
      const text = fs.readFileSync(path.join(dir, rel), 'utf-8');
      assert.match(text, /^---\nchange: add-cache\ndate: 2026-11-06T13:05:42Z\n---\n/);
      for (const section of ['Context', 'Decision', 'Alternatives', 'Consequences']) {
        assert.match(text, new RegExp(`^## ${section}$`, 'm'), section);
      }
      // The receipt of the change names HEAD: the guard requires and validates the entry.
      const hash = git(dir, 'rev-parse', 'HEAD').trim();
      fs.mkdirSync(path.join(dir, 'sdds', 'add-cache'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'sdds', 'add-cache', 'audit-receipt.json'), JSON.stringify({ commitHash: hash }));
      stageFiles(dir, { [rel]: text });
      const res = await require('../tools/check_journal')(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
      assert.strictEqual(res.skipped, false);
    } finally {
      teardown(dir);
    }
  });

  it('follows journal.dir from .clckernel.yaml', () => {
    const dir = createTmpProject({ '.clckernel.yaml': 'journal:\n  dir: notes/log\n' });
    try {
      const { rel } = loadJournal().createEntry(dir, 'x', { now: NOW });
      assert.strictEqual(rel, 'notes/log/2026/20261106T1305Z-x.md');
    } finally {
      teardown(dir);
    }
  });

  it('refuses a second entry for the same change, even at another time', () => {
    const dir = createTmpProject({});
    try {
      loadJournal().createEntry(dir, 'add-cache', { now: NOW });
      assert.throws(() => loadJournal().createEntry(dir, 'add-cache', { now: new Date('2027-01-02T03:04:05Z') }), /already has an entry/);
      assert.ok(!fs.existsSync(path.join(dir, 'docs', 'Journal', '2027')), 'nothing written');
    } finally {
      teardown(dir);
    }
  });

  it('rejects a name `audit --change` rejects', () => {
    const dir = createTmpProject({});
    try {
      for (const name of ['../x', 'a/b', '-x', '.hidden', '']) {
        assert.throws(() => loadJournal().createEntry(dir, name, { now: NOW }), /invalid change name/, name);
      }
      assert.ok(!fs.existsSync(path.join(dir, 'docs')), 'nothing written');
    } finally {
      teardown(dir);
    }
  });
});

describe('item 2: the journal command', () => {
  it('creates the entry and prints its path', () => {
    const dir = createTmpProject({});
    try {
      const res = cli(['journal', 'add-cache', dir]);
      assert.strictEqual(res.status, 0, res.out);
      const year = fs.readdirSync(path.join(dir, 'docs', 'Journal'));
      assert.strictEqual(year.length, 1);
      const [file] = fs.readdirSync(path.join(dir, 'docs', 'Journal', year[0]));
      assert.match(file, /^\d{8}T\d{4}Z-add-cache\.md$/);
      assert.ok(res.stdout.includes(`docs/Journal/${year[0]}/${file}`), res.out);
    } finally {
      teardown(dir);
    }
  });

  it('runs in the current directory without targetDir', () => {
    const dir = createTmpProject({});
    try {
      const res = cli(['journal', 'here'], dir);
      assert.strictEqual(res.status, 0, res.out);
      assert.ok(fs.existsSync(path.join(dir, 'docs', 'Journal')));
    } finally {
      teardown(dir);
    }
  });

  it('a duplicate exits 1 and keeps the first entry', () => {
    const dir = createTmpProject({});
    try {
      assert.strictEqual(cli(['journal', 'add-cache', dir]).status, 0);
      const res = cli(['journal', 'add-cache', dir]);
      assert.strictEqual(res.status, 1, res.out);
      assert.match(res.out, /already has an entry/);
    } finally {
      teardown(dir);
    }
  });

  it('rejects an invalid name, an unknown flag, a missing name and a missing directory without writing', () => {
    const dir = createTmpProject({});
    try {
      for (const args of [
        ['journal', '../x', dir],
        ['journal', 'ok', dir, '--force'],
        ['journal', '--dry-run', 'ok', dir],
        ['journal'],
        ['journal', 'ok', dir, 'extra'],
        ['journal', 'ok', path.join(dir, 'missing')],
      ]) {
        const res = cli(args);
        assert.strictEqual(res.status, 1, `${args.join(' ')}: ${res.out}`);
      }
      assert.match(cli(['journal', '../x', dir]).out, /invalid change name/);
      assert.match(cli(['journal', 'ok', dir, '--force']).out, /Unknown input/);
      assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing written');
    } finally {
      teardown(dir);
    }
  });

  it('the help documents it', () => {
    const res = cli(['--help']);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /journal <change> \[targetDir\]/);
    assert.match(res.stdout, /clckernel journal my-feature \./);
  });
});

// ── Item 6: the since rule and the playbooks ─────────────────────────────────

describe('item 6: the playbooks describe the journal flow', () => {
  const read = (name) => fs.readFileSync(path.join(ROOT, '.agents', 'skills', 'clckernel_cli', 'reference', name), 'utf-8');

  for (const name of ['feature.md', 'fix.md']) {
    it(`${name}: Research reads the journal; after the audit the entry is created`, () => {
      const text = read(name);
      assert.match(text, /docs\/Journal\//);
      assert.match(text, /npx clckernel journal <(name|issue|change)>/);
      assert.match(text, /tools\/check_journal\.js/);
    });
  }

  it('commit.md: the entry goes in the commit that closes the change', () => {
    assert.match(read('commit.md'), /journal entry/i);
  });
});
