/**
 * Every diff-based guard evaluates the snapshot being verified — the index in
 * a pre-commit, or HEAD in a manual run with nothing staged — never the
 * working copy.
 *
 * For each guard the table holds a minimal violating and clean version of the
 * change. Four scenarios per guard:
 *   staged V, working copy C  => FAIL   (the staged-content bypass)
 *   staged C, working copy V  => PASS
 *   committed V, working copy C, nothing staged => FAIL
 *   committed C, working copy V, nothing staged => PASS
 *
 * verify_tdd.py is not in the table: it already materializes both trees from
 * git and only reuses the mode detection (covered by its own suite).
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const TOOLS = path.resolve(__dirname, '..', 'tools');

// Built at runtime so this fixture does not trip the repo's own secret scan.
// Lowercase so the case-sensitive Python pattern matches as well.
const FAKE_KEY = ['abcdefghijklmnop', 'qrstuvwxyz123456'].join('');

const CUSTOM_CONFIG = [
  'rules:',
  '  - name: no-marker',
  "    pattern: 'FORBIDDEN_MARKER'",
  "    message: 'No forbidden markers'",
  '    severity: error',
  '',
].join('\n');

const NEXT_PKG = JSON.stringify({ dependencies: { next: '14.0.0', react: '18.0.0' } });

/**
 * guard: tools/ file name. base: files committed before the change.
 * violating / clean: the change, as {path: content} maps.
 */
const GUARDS = [
  // ── JavaScript ────────────────────────────────────────────────────────
  {
    guard: 'scan_secrets.js',
    violating: { 'config.js': `const api_key = "${FAKE_KEY}";\n` },
    clean: { 'config.js': 'module.exports = 1;\n' },
  },
  {
    guard: 'check_a11y.js',
    violating: { 'src/Avatar.jsx': 'export const A = () => <img src="a.png" />;\n' },
    clean: { 'src/Avatar.jsx': 'export const A = () => <div>ok</div>;\n' },
  },
  {
    guard: 'check_api_contracts.js',
    base: { 'package.json': JSON.stringify({ dependencies: {} }) },
    violating: { 'app/api/items/route.ts': 'export async function POST(req) {\n  const body = await req.json();\n  return body;\n}\n' },
    clean: { 'app/api/items/route.ts': 'export const dynamic = "force-static";\n' },
  },
  {
    guard: 'check_architecture.js',
    base: { 'package.json': NEXT_PKG },
    violating: { 'app/layout.tsx': "'use client';\nexport default function Layout() { return null; }\n" },
    clean: { 'app/layout.tsx': 'export default function Layout() { return null; }\n' },
  },
  {
    guard: 'check_custom.js',
    base: { '.clckernel.yaml': CUSTOM_CONFIG },
    violating: { 'src/a.js': '// FORBIDDEN_MARKER\n' },
    clean: { 'src/a.js': 'module.exports = 1;\n' },
  },
  {
    guard: 'check_performance.js',
    base: { 'package.json': NEXT_PKG },
    violating: { 'src/Pic.tsx': 'export const P = () => <img src="a.png" alt="a" />;\n' },
    clean: { 'src/Pic.tsx': 'export const P = () => null;\n' },
  },
  {
    guard: 'check_responsive.js',
    violating: { 'src/Wide.tsx': 'export const W = () => <div className="w-[1200px]">x</div>;\n' },
    clean: { 'src/Wide.tsx': 'export const W = () => <div className="max-w-full">x</div>;\n' },
  },
  {
    guard: 'check_seo.js',
    violating: { 'src/Link.tsx': 'export const L = () => <a href="https://x.example" target="_blank">x</a>;\n' },
    clean: { 'src/Link.tsx': 'export const L = () => <a href="/x">x</a>;\n' },
  },
  {
    // The story file is part of the change: a story that exists only in the
    // working copy must not satisfy the guard.
    guard: 'check_storybook.js',
    base: { '.storybook/main.js': 'module.exports = {};\n' },
    violating: { 'src/components/Button.tsx': 'export const Button = () => null;\n' },
    clean: {
      'src/components/Button.tsx': 'export const Button = () => null;\n',
      'src/components/Button.stories.tsx': 'export default { title: "Button" };\n',
    },
  },
  {
    guard: 'check_ui_reuse.js',
    violating: { 'src/Form.tsx': 'export const F = () => <select></select>;\n' },
    clean: { 'src/Form.tsx': 'export const F = 1;\n' },
  },
  // ── Python ────────────────────────────────────────────────────────────
  {
    guard: 'scan_secrets.py',
    violating: { 'config.py': `api_key = "${FAKE_KEY}"\n` },
    clean: { 'config.py': 'x = 1\n' },
  },
  {
    guard: 'check_architecture.py',
    violating: { 'app/domain/model.py': 'from app.infrastructure import db\n' },
    clean: { 'app/domain/model.py': 'x = 1\n' },
  },
  {
    guard: 'check_custom.py',
    base: { '.clckernel.yaml': CUSTOM_CONFIG },
    violating: { 'src/a.py': '# FORBIDDEN_MARKER\n' },
    clean: { 'src/a.py': 'x = 1\n' },
  },
  {
    guard: 'check_db_efficiency.py',
    violating: { 'svc.py': 'def f(ids):\n    for i in ids:\n        db.query(i)\n' },
    clean: { 'svc.py': 'x = 1\n' },
  },
  {
    guard: 'check_migrations.py',
    base: { 'app/migrations/__init__.py': '' },
    violating: {
      'app/migrations/0002_data.py':
        'from django.db import migrations\n\n\nclass Migration(migrations.Migration):\n'
        + '    operations = [migrations.RunSQL("SELECT 1")]\n',
    },
    clean: {
      'app/migrations/0002_data.py':
        'from django.db import migrations\n\n\nclass Migration(migrations.Migration):\n'
        + '    operations = [migrations.RunSQL("SELECT 1", reverse_sql="SELECT 1")]\n',
    },
  },
  {
    // check_scope reads no file content: its snapshot is the list of paths.
    // The declared file has a non-ASCII name, which only survives -z output.
    guard: 'check_scope.py',
    untracked: { 'sdds/feature/01-spec.md': '# Scope\n\n- src/café.py\n' },
    violating: { 'other/x.py': 'x = 1\n' },
    clean: { 'src/café.py': 'x = 1\n' },
  },
  {
    guard: 'celery_guard.py',
    violating: { 'tasks.py': 'from celery import Celery\napp = Celery("x", broker_url="redis://localhost:6379/0")\n' },
    clean: { 'tasks.py': 'x = 1\n' },
  },
  {
    guard: 'docker_guard.py',
    violating: { Dockerfile: 'FROM python:3.11\n' },
    clean: { Dockerfile: 'FROM python:3.11\nUSER app\nHEALTHCHECK CMD true\n' },
  },
  {
    guard: 'postgres_guard.py',
    // The only rule this guard can trigger today (its execute() check never
    // matches): psycopg2 sql.SQL composed through format/compose keywords.
    violating: { 'q.py': 'from psycopg2 import sql\nq = sql.SQL("SELECT 1", format=True)\n' },
    clean: { 'q.py': 'x = 1\n' },
  },
  {
    guard: 'redis_guard.py',
    violating: { 'r.py': 'import redis\nr = redis.Redis(host="h")\n' },
    clean: { 'r.py': 'x = 1\n' },
  },
];

/** Async spawn: { status, stdout, stderr }, so scenarios can run concurrently. */
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function gitAsync(dir, ...args) {
  const res = await run('git', args, dir);
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files || {})) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

const templates = new Map();

/** Committed base repo for an entry, built once and copied per scenario. */
function templateFor(entry) {
  if (!templates.has(entry.guard)) {
    const dir = createTmpProject({ 'README.md': '# fixture\n', ...(entry.base || {}) });
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    writeFiles(dir, entry.untracked);
    templates.set(entry.guard, dir);
  }
  return templates.get(entry.guard);
}

/** Fresh copy of the entry's base repo (HEAD exists, nothing staged). */
function createRepo(entry) {
  const dir = createTmpProject({});
  fs.cpSync(templateFor(entry), dir, { recursive: true });
  return dir;
}

/** Make the working copy hold `next` instead of `previous` (unstaged). */
function overwriteWorkingCopy(dir, previous, next) {
  for (const rel of Object.keys(previous)) {
    if (!(rel in next)) fs.rmSync(path.join(dir, rel), { force: true });
  }
  writeFiles(dir, next);
}

function stage(dir, files) {
  writeFiles(dir, files);
  git(dir, 'add', '--', ...Object.keys(files));
}

function runGuard(guard, dir) {
  const bin = guard.endsWith('.py') ? 'python3' : 'node';
  return run(bin, [path.join(TOOLS, guard), dir], dir);
}

async function scenario(entry, { committed, snapshot, workingCopy, expectFail }) {
  const dir = createRepo(entry);
  try {
    writeFiles(dir, snapshot);
    await gitAsync(dir, 'add', '--', ...Object.keys(snapshot));
    if (committed) await gitAsync(dir, 'commit', '-q', '-m', 'change');
    overwriteWorkingCopy(dir, snapshot, workingCopy);
    const res = await runGuard(entry.guard, dir);
    const detail = `${entry.guard} -> status ${res.status}\n${res.stdout}\n${res.stderr}`;
    if (expectFail) {
      assert.notStrictEqual(res.status, 0, `expected failure: ${detail}`);
    } else {
      assert.strictEqual(res.status, 0, `expected pass: ${detail}`);
    }
    // Same-JSON sanity: the guard ran instead of skipping.
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.skipped, false, `guard must not skip: ${detail}`);
  } finally {
    teardown(dir);
  }
}

after(() => {
  for (const dir of templates.values()) teardown(dir);
});

describe('diff-based guards evaluate the snapshot, not the working copy', { concurrency: true }, () => {
  for (const entry of GUARDS) {
    describe(entry.guard, { concurrency: true }, () => {
      it('fails when the violation is staged and the working copy is clean', () =>
        scenario(entry, { snapshot: entry.violating, workingCopy: entry.clean, expectFail: true }));

      it('passes when clean content is staged and the working copy violates', () =>
        scenario(entry, { snapshot: entry.clean, workingCopy: entry.violating, expectFail: false }));

      it('nothing staged: fails on a violating last commit despite a clean working copy', () =>
        scenario(entry, { committed: true, snapshot: entry.violating, workingCopy: entry.clean, expectFail: true }));

      it('nothing staged: passes on a clean last commit despite a violating working copy', () =>
        scenario(entry, { committed: true, snapshot: entry.clean, workingCopy: entry.violating, expectFail: false }));
    });
  }
});

describe('extra files a guard reads come from the snapshot', () => {
  it('check_architecture.js reads package.json from the index', async () => {
    // Next.js is declared only in the staged package.json; deleting it from
    // the working copy must not turn the guard into a skip.
    const entry = { guard: 'check_architecture.js#package' };
    const dir = createRepo(entry);
    try {
      stage(dir, {
        'package.json': NEXT_PKG,
        'app/layout.tsx': "'use client';\nexport default function Layout() { return null; }\n",
      });
      fs.rmSync(path.join(dir, 'package.json'));
      const res = await runGuard('check_architecture.js', dir);
      assert.strictEqual(res.status, 1, `expected failure, got: ${res.stdout}`);
    } finally {
      teardown(dir);
    }
  });

  it('check_architecture.py detects Django from the snapshot, not the working copy', async () => {
    // models.py importing views is a Django-only violation. manage.py exists
    // only in the working copy, so the committed project is generic.
    const entry = { guard: 'check_architecture.py#django' };
    const dir = createRepo(entry);
    try {
      stage(dir, { 'shop/models.py': 'from shop.views import home\n' });
      writeFiles(dir, { 'manage.py': '# django\n' });
      const res = await runGuard('check_architecture.py', dir);
      assert.strictEqual(res.status, 0, `generic project must pass, got: ${res.stdout}`);
    } finally {
      teardown(dir);
    }
  });
});
