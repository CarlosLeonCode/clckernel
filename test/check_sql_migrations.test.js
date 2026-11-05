/**
 * check_sql_migrations: SQL migration rules
 * on the changed files of the snapshot. Each rule has a pass and a fail case.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, stageFiles, teardown, git } = require('./helpers');

const check = require('../tools/check_sql_migrations');

const MIG = 'supabase/migrations';
const SAFE_TABLE = [
  'create table public.items (id uuid primary key, name text);',
  'alter table public.items enable row level security;',
].join('\n');

async function run(committed, staged) {
  const dir = createGitRepo(committed, staged);
  try {
    return await check(dir);
  } finally {
    teardown(dir);
  }
}

const rulesOf = (res) => Object.values(res.data.violations).flat().map((v) => v.rule);

describe('check_sql_migrations: snapshot and scope', () => {
  it('no git repository => skipped, exit 0', async () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sqlmig-'));
    try {
      const res = await check(dir);
      assert.strictEqual(res.exitCode, 0);
      assert.strictEqual(res.skipped, true);
      assert.strictEqual(res.name, 'check_sql_migrations');
    } finally {
      teardown(dir);
    }
  });

  it('a .sql file outside the migration paths is not evaluated', async () => {
    const res = await run({ 'README.md': '#\n' }, { 'db/queries/report.sql': 'create table public.x (id int);\n' });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('a Supabase project in a subdirectory is covered by the default paths', async () => {
    const res = await run({ 'README.md': '#\n' }, { 'apps/db/supabase/migrations/1_init.sql': 'create table public.x (id int);\n' });
    assert.strictEqual(res.exitCode, 1);
    assert.deepStrictEqual(rulesOf(res), ['rls']);
  });

  it('sql_migrations.paths replaces the default paths', async () => {
    const config = 'sql_migrations:\n  paths:\n    - "db/migrations/*.sql"\n';
    const res = await run({ '.clckernel.yaml': config }, {
      'db/migrations/001.sql': 'create table public.x (id int);\n',
      [`${MIG}/1_init.sql`]: 'create table public.y (id int);\n',
    });
    assert.deepStrictEqual(Object.keys(res.data.violations), ['db/migrations/001.sql']);
  });

  it('guard_exclude for check_sql_migrations keeps a path out', async () => {
    const config = 'guard_exclude:\n  check_sql_migrations:\n    - "supabase/migrations/legacy_*.sql"\n';
    // The audit orchestrators name the running guard through CLCKERNEL_GUARD.
    process.env.CLCKERNEL_GUARD = 'check_sql_migrations';
    try {
      const res = await run({ '.clckernel.yaml': config }, { [`${MIG}/legacy_1.sql`]: 'create table public.x (id int);\n' });
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      delete process.env.CLCKERNEL_GUARD;
    }
  });
});

describe('check_sql_migrations: immutable applied migrations', () => {
  it('a new migration next to committed ones passes', async () => {
    const res = await run({ [`${MIG}/1_init.sql`]: SAFE_TABLE }, { [`${MIG}/2_more.sql`]: SAFE_TABLE.replace(/items/g, 'more') });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('editing a migration that exists at BASE fails', async () => {
    const res = await run({ [`${MIG}/1_init.sql`]: SAFE_TABLE }, { [`${MIG}/1_init.sql`]: `${SAFE_TABLE}\n-- edited\n` });
    assert.strictEqual(res.exitCode, 1);
    assert.deepStrictEqual(rulesOf(res), ['immutable']);
    assert.match(res.data.violations[`${MIG}/1_init.sql`][0].message, /already applied|exists at BASE/);
  });

  it('deleting a migration that exists at BASE fails', async () => {
    const dir = createGitRepo({ [`${MIG}/1_init.sql`]: SAFE_TABLE, 'README.md': '#\n' });
    try {
      git(dir, 'rm', '-q', `${MIG}/1_init.sql`);
      const res = await check(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(rulesOf(res), ['immutable']);
    } finally {
      teardown(dir);
    }
  });

  it('last-commit mode: the commit that adds a migration passes, one that edits it fails', async () => {
    const dir = createGitRepo({ 'README.md': '#\n' });
    try {
      stageFiles(dir, { [`${MIG}/1_init.sql`]: SAFE_TABLE });
      git(dir, 'commit', '-q', '--no-verify', '-m', 'add');
      assert.strictEqual((await check(dir)).exitCode, 0);
      stageFiles(dir, { [`${MIG}/1_init.sql`]: `${SAFE_TABLE}\n-- edited\n` });
      git(dir, 'commit', '-q', '--no-verify', '-m', 'edit');
      const res = await check(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(rulesOf(res), ['immutable']);
    } finally {
      teardown(dir);
    }
  });
});

describe('check_sql_migrations: row level security', () => {
  it('create table + enable row level security in the same file passes (quoted, if not exists, unqualified)', async () => {
    const sql = [
      'CREATE TABLE IF NOT EXISTS "public"."Orders" (id int);',
      'ALTER TABLE ONLY "public"."Orders" ENABLE ROW LEVEL SECURITY;',
      'create table notes (id int);',
      'alter table if exists public.notes enable row level security;',
    ].join('\n');
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('a public table without enable row level security fails, naming the table and the line', async () => {
    const sql = `${SAFE_TABLE}\n\ncreate table public.leaky (id int);\n`;
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 1);
    const [v] = res.data.violations[`${MIG}/1.sql`];
    assert.strictEqual(v.rule, 'rls');
    assert.strictEqual(v.lineNo, 4);
    assert.match(v.message, /public\.leaky/);
  });

  it('tables outside the configured schemas, and temporary tables, are not checked', async () => {
    const sql = 'create table private.audit (id int);\ncreate temp table scratch (id int);\n';
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('sql_migrations.schemas adds schemas to check', async () => {
    const config = 'sql_migrations:\n  schemas:\n    - public\n    - api\n';
    const res = await run({ '.clckernel.yaml': config }, { [`${MIG}/1.sql`]: 'create table api.things (id int);\n' });
    assert.deepStrictEqual(rulesOf(res), ['rls']);
  });

  it('a create table inside a comment or a string literal is ignored', async () => {
    const sql = [
      '-- create table public.a (id int);',
      '/* create table public.b (id int); */',
      "comment on schema public is 'create table public.c (id int);';",
      'do $$ begin raise notice $q$create table public.d (id int)$q$; end $$;',
    ].join('\n');
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });
});

describe('check_sql_migrations: security definer functions', () => {
  it('security definer with set search_path passes (before or after the body)', async () => {
    const sql = [
      "create function public.a() returns int language sql security definer set search_path = '' as $$ select 1 $$;",
      'create or replace function public.b() returns int as $fn$ select 1 $fn$ language sql security definer set search_path = public, pg_temp;',
    ].join('\n');
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('security definer without search_path fails, naming the function', async () => {
    const sql = 'create function public.is_admin()\nreturns boolean language sql\nsecurity definer\nas $$ select true $$;\n';
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 1);
    const [v] = res.data.violations[`${MIG}/1.sql`];
    assert.strictEqual(v.rule, 'search_path');
    assert.match(v.message, /public\.is_admin/);
  });

  it('"set search_path" inside the function body does not count', async () => {
    const sql = "create function public.f() returns void language plpgsql security definer as $$ begin perform set_config('x', 'y', true); execute 'set search_path = public'; end $$;\n";
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.deepStrictEqual(rulesOf(res), ['search_path']);
  });

  it('security invoker functions are not checked', async () => {
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: 'create function public.f() returns int language sql as $$ select 1 $$;\n' });
    assert.strictEqual(res.exitCode, 0);
  });
});

describe('check_sql_migrations: write grants to anon', () => {
  it('grant select to anon and revoke all from anon pass', async () => {
    const sql = 'revoke all on public.items from anon, authenticated;\ngrant select on public.items to anon, authenticated;\ngrant insert, update on public.items to authenticated;\n';
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  for (const grant of ['grant insert on public.items to anon', 'GRANT SELECT, UPDATE (name) ON public.items TO authenticated, anon', 'grant all privileges on all tables in schema public to "anon"', 'alter default privileges in schema public grant delete on tables to anon']) {
    it(`${grant} => fails`, async () => {
      const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: `${grant};\n` });
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(rulesOf(res), ['anon_write']);
      assert.strictEqual(res.level, 'error');
    });
  }

  it('sql_migrations.anon_roles replaces the role list', async () => {
    const config = 'sql_migrations:\n  anon_roles:\n    - web_anon\n';
    const res = await run({ '.clckernel.yaml': config }, { [`${MIG}/1.sql`]: 'grant insert on public.items to anon;\ngrant update on public.items to web_anon;\n' });
    const [v, ...rest] = Object.values(res.data.violations).flat();
    assert.strictEqual(rest.length, 0);
    assert.match(v.message, /web_anon/);
  });
});

describe('check_sql_migrations: destructive changes', () => {
  it('drop table and alter table ... drop column are warnings that name the object', async () => {
    const sql = 'drop table if exists public.old_a, public.old_b cascade;\nalter table public.items drop column if exists legacy, add column x int;\n';
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.level, 'warning', 'only warnings => level warning (reported, not blocking)');
    const messages = res.data.violations[`${MIG}/1.sql`].map((v) => `${v.rule}:${v.severity}:${v.message}`).join('\n');
    assert.match(messages, /destructive:warning:.*public\.old_a/);
    assert.match(messages, /destructive:warning:.*public\.old_b/);
    assert.match(messages, /destructive:warning:.*public\.items\.legacy/);
  });

  it('drop policy / drop function are not destructive table changes', async () => {
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: 'drop policy if exists "p" on public.items;\ndrop function if exists public.f();\nalter table public.items drop constraint c;\n' });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });
});

describe('check_sql_migrations: severities', () => {
  it('sql_migrations.severities turns a rule into a warning or off', async () => {
    const config = 'sql_migrations:\n  severities:\n    rls: warning\n    search_path: "off"\n';
    const sql = 'create table public.x (id int);\ncreate function public.f() returns int language sql security definer as $$ select 1 $$;\n';
    const res = await run({ '.clckernel.yaml': config }, { [`${MIG}/1.sql`]: sql });
    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.level, 'warning');
    assert.deepStrictEqual(rulesOf(res), ['rls']);
  });

  it('an error and a warning together => level error', async () => {
    const res = await run({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: 'create table public.x (id int);\ndrop table public.y;\n' });
    assert.strictEqual(res.level, 'error');
    assert.deepStrictEqual(rulesOf(res).sort(), ['destructive', 'rls']);
  });

  it('an invalid severity is a config error naming the key', () => {
    const { validateConfig } = require('../tools/_config.js');
    assert.throws(() => validateConfig({ sql_migrations: { severities: { rls: 'fatal' } } }), /sql_migrations\.severities\.rls/);
    assert.throws(() => validateConfig({ sql_migrations: { severities: { nope: 'error' } } }), /sql_migrations\.severities\.nope/);
    assert.throws(() => validateConfig({ sql_migrations: { paths: 'x' } }), /sql_migrations\.paths/);
  });
});

describe('check_sql_migrations: run as a script', () => {
  it('prints JSON and exits 1 on an error finding', () => {
    const dir = createGitRepo({ 'README.md': '#\n' }, { [`${MIG}/1.sql`]: 'create table public.x (id int);\n' });
    try {
      const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'check_sql_migrations.js')], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 1, res.stderr);
      assert.strictEqual(JSON.parse(res.stdout).name, 'check_sql_migrations');
    } finally {
      teardown(dir);
    }
  });
});
