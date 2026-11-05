/**
 * check_query_efficiency (sdds/laila-platform-fit, REQ-15): database calls
 * awaited inside loops (N+1) and unbounded select('*') in JS/TS files whose
 * package depends on a known data client. Pass and fail case per rule.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');

const check = require('../tools/check_query_efficiency');

const pkg = (deps) => `${JSON.stringify({ name: 'p', dependencies: deps }, null, 2)}\n`;
const SUPABASE = { 'package.json': pkg({ '@supabase/supabase-js': '^2.0.0' }) };

async function run(committed, staged) {
  const dir = createGitRepo(committed, staged);
  try {
    return await check(dir);
  } finally {
    teardown(dir);
  }
}
const rules = (res) => Object.values(res.data.violations).flat().map((v) => v.rule);

describe('check_query_efficiency: N+1 (awaited query inside a loop)', () => {
  const failing = {
    'for...of + await supabase.from().select()': `export async function load(ids: string[]) {
  const out = [];
  for (const id of ids) {
    const { data } = await supabase.from('items').select('id').eq('id', id).single();
    out.push(data);
  }
  return out;
}
`,
    'classic for + multi-line this.client chain': `async function f(ids) {
  for (let i = 0; i < ids.length; i++) {
    const { data, error } = await this.client
      .from("items")
      .update({ seen: true })
      .eq("id", ids[i]);
  }
}
`,
    'while + await rpc': 'async function f() {\n  while (more) {\n    more = (await client.rpc("next_page")).data;\n  }\n}\n',
    '.map(async ...)': 'const rows = await Promise.all(ids.map(async (id) => supabase.from("t").select("id").eq("id", id)));\n',
    '.forEach(async ...)': 'ids.forEach(async (id) => {\n  await supabase.from("t").delete().eq("id", id);\n});\n',
    'for await + single-statement body': 'async function f(stream) {\n  for await (const id of stream) await supabase.from("t").insert({ id });\n}\n',
  };
  for (const [name, source] of Object.entries(failing)) {
    it(`${name} => n_plus_one error`, async () => {
      const res = await run(SUPABASE, { 'src/repo.ts': source });
      assert.strictEqual(res.exitCode, 1, JSON.stringify(res));
      assert.deepStrictEqual(rules(res), ['n_plus_one']);
      assert.strictEqual(res.level, 'error');
      assert.ok(res.data.violations['src/repo.ts'][0].lineNo > 0);
    });
  }

  it('drizzle, prisma, postgres and pg calls are recognised by their dependency', async () => {
    const cases = [
      [{ 'drizzle-orm': '1' }, 'for (const id of ids) {\n  await db.select().from(users).where(eq(users.id, id));\n}\n'],
      [{ '@prisma/client': '5' }, 'for (const id of ids) {\n  await prisma.user.findUnique({ where: { id } });\n}\n'],
      [{ postgres: '3' }, 'for (const id of ids) {\n  await sql`select * from users where id = ${id}`;\n}\n'],
      [{ pg: '8' }, 'for (const id of ids) {\n  await pool.query("select 1", [id]);\n}\n'],
    ];
    for (const [deps, source] of cases) {
      const res = await run({ 'package.json': pkg(deps) }, { 'src/a.ts': source });
      assert.deepStrictEqual(rules(res), ['n_plus_one'], JSON.stringify(deps));
    }
  });

  it('queries outside loops, loops without queries, and Array.from in a loop pass', async () => {
    const source = `export async function list() {
  const { data } = await supabase.from('items').select('id, name').order('name');
  for (const row of data ?? []) {
    console.log(Array.from(row.tags));
    await sleep(1);
  }
  return data;
}
`;
    const res = await run(SUPABASE, { 'src/repo.ts': source });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('a query call in a comment or a string inside a loop is ignored', async () => {
    const source = 'for (const id of ids) {\n  // await supabase.from("t").select("id")\n  log("await supabase.from(t).select(id)");\n}\n';
    const res = await run(SUPABASE, { 'src/a.ts': source });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('without a data client dependency the file is not checked', async () => {
    const res = await run({ 'package.json': pkg({ react: '18' }) }, { 'src/a.ts': 'for (const id of ids) {\n  await supabase.from("t").select("id");\n}\n' });
    assert.strictEqual(res.exitCode, 0);
  });

  it('a package without the client uses the root package.json (hoisted dependency)', async () => {
    const res = await run({ ...SUPABASE, 'packages/a/package.json': pkg({}) }, { 'packages/a/src/x.ts': 'for (const id of ids) {\n  await supabase.from("t").select("id");\n}\n' });
    assert.deepStrictEqual(rules(res), ['n_plus_one']);
  });

  it('test files and generated types are ignored', async () => {
    const loop = 'for (const id of ids) {\n  await supabase.from("t").select("id");\n}\n';
    const res = await run(SUPABASE, {
      'src/repo.test.ts': loop,
      'src/__tests__/x.ts': loop,
      'src/adapters/database.types.ts': loop,
      'src/schema.generated.ts': loop,
    });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('query_efficiency.call_patterns adds patterns for any file', async () => {
    const config = 'query_efficiency:\n  call_patterns:\n    - "\\\\brepo\\\\.load\\\\("\n';
    const res = await run({ '.clckernel.yaml': config, 'package.json': pkg({}) }, { 'src/a.ts': 'for (const id of ids) {\n  await repo.load(id);\n}\n' });
    assert.deepStrictEqual(rules(res), ['n_plus_one']);
  });
});

describe('check_query_efficiency: unbounded select', () => {
  it("select('*') without limit/range => warning (level warning)", async () => {
    const res = await run(SUPABASE, { 'src/a.ts': "export const all = () => supabase.from('items').select('*');\n" });
    assert.strictEqual(res.exitCode, 1);
    assert.deepStrictEqual(rules(res), ['unbounded_select']);
    assert.strictEqual(res.level, 'warning');
  });

  it("select('*') with .range(), .limit() or .single() passes", async () => {
    const source = [
      "export const a = () => supabase.from('items').select('*').range(0, 49);",
      "export const b = () => supabase.from('items').select('*').order('name').limit(20);",
      "export const c = (id) => supabase.from('items').select('*').eq('id', id).single();",
    ].join('\n');
    const res = await run(SUPABASE, { 'src/a.ts': `${source}\n` });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('query_efficiency.severities can turn a rule off', async () => {
    const config = 'query_efficiency:\n  severities:\n    unbounded_select: "off"\n';
    const res = await run({ ...SUPABASE, '.clckernel.yaml': config }, { 'src/a.ts': "export const all = () => supabase.from('items').select('*');\n" });
    assert.strictEqual(res.exitCode, 0);
  });
});

describe('check_query_efficiency: run as a script', () => {
  it('prints JSON and exits 1 on an N+1', () => {
    const dir = createGitRepo(SUPABASE, { 'src/a.ts': 'for (const id of ids) {\n  await supabase.from("t").select("id");\n}\n' });
    try {
      const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'check_query_efficiency.js')], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 1, res.stderr);
      assert.strictEqual(JSON.parse(res.stdout).name, 'check_query_efficiency');
    } finally {
      teardown(dir);
    }
  });
});
