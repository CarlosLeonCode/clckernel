/**
 * Review fixes of the SQL migration, query efficiency and MCP contract guards:
 * false positives of check_query_efficiency (pagination, functions defined in
 * a loop, statements without semicolons) and its warning default, the
 * check_mcp_contracts defaults, check_sql_migrations heuristics (later
 * `alter function ... set search_path`, `set search_path`, quoted names,
 * `drop` without COLUMN, the upstream base of `immutable`), guards that run
 * next to an older tools/_config.js, the Python `call_patterns` regex check,
 * and one list of generated files.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, stageFiles, teardown, git } = require('./helpers');

const TOOLS = path.join(__dirname, '..', 'tools');
const queryEfficiency = require('../tools/check_query_efficiency');
const mcpContracts = require('../tools/check_mcp_contracts');
const sqlMigrations = require('../tools/check_sql_migrations');

const pkg = (deps) => `${JSON.stringify({ name: 'p', dependencies: deps }, null, 2)}\n`;
const SUPABASE = { 'package.json': pkg({ '@supabase/supabase-js': '^2.0.0' }) };
const PRISMA = { 'package.json': pkg({ '@prisma/client': '^5.0.0' }) };
const MCP = { 'package.json': pkg({ '@modelcontextprotocol/sdk': '^1.0.0', zod: '^3.0.0', pg: '^8.0.0' }) };

async function run(check, committed, staged) {
  const dir = createGitRepo(committed, staged);
  try {
    return await check(dir);
  } finally {
    teardown(dir);
  }
}
const all = (res) => Object.values(res.data.violations).flat();
const rules = (res) => all(res).map((v) => v.rule);

describe('check_query_efficiency: no N+1 for pagination loops', () => {
  const cases = {
    'supabase .range(': `export async function all() {
  let from = 0;
  const out = [];
  while (true) {
    const { data } = await supabase.from('items').select('id').range(from, from + 999);
    if (!data.length) break;
    out.push(...data);
    from += 1000;
  }
  return out;
}
`,
    'prisma skip/take': `export async function all() {
  for (let skip = 0; ; skip += 100) {
    const rows = await prisma.item.findMany({ skip, take: 100 });
    if (rows.length === 0) break;
  }
}
`,
    'prisma cursor': `export async function all() {
  let cursor = undefined;
  do {
    const rows = await prisma.item.findMany({ take: 100, cursor });
    cursor = rows.at(-1)?.id;
  } while (cursor);
}
`,
  };
  for (const [name, source] of Object.entries(cases)) {
    it(name, async () => {
      const deps = name.startsWith('prisma') ? PRISMA : SUPABASE;
      const res = await run(queryEfficiency, deps, { 'src/page.ts': source });
      assert.deepStrictEqual(rules(res), [], JSON.stringify(res.data.violations));
    });
  }
});

describe('check_query_efficiency: a function defined inside a loop is not the loop body', () => {
  it('route handlers registered in a loop', async () => {
    const source = `export function register(app, routes) {
  for (const route of routes) {
    app.get(route.path, async (req, res) => {
      const { data } = await supabase.from('items').select('id').limit(10);
      res.json(data);
    });
    app.post(route.path, async function handler(req, res) {
      await supabase.from('items').insert(req.body);
    });
  }
}
`;
    const res = await run(queryEfficiency, SUPABASE, { 'src/routes.ts': source });
    assert.deepStrictEqual(rules(res), [], JSON.stringify(res.data.violations));
  });

  it('a query awaited in the loop itself is still reported', async () => {
    const source = `export async function load(ids) {
  for (const id of ids) {
    const handler = async () => 1;
    await supabase.from('items').select('id').eq('id', id).single();
  }
}
`;
    const res = await run(queryEfficiency, SUPABASE, { 'src/load.ts': source });
    assert.deepStrictEqual(rules(res), ['n_plus_one']);
  });

  it('a .map(async) callback is still reported', async () => {
    const source = `export const load = (ids) => Promise.all(ids.map(async (id) => {
  const { data } = await supabase.from('items').select('id').eq('id', id).single();
  return data;
}));
`;
    const res = await run(queryEfficiency, SUPABASE, { 'src/load.ts': source });
    assert.deepStrictEqual(rules(res), ['n_plus_one']);
  });
});

describe('check_query_efficiency: statements without semicolons', () => {
  it("a later .limit( does not hide an unbounded select('*')", async () => {
    const source = `export async function f() {
  const { data } = await supabase.from('a').select('*')
  const other = await supabase.from('b').select('id').limit(1)
  return [data, other]
}
`;
    const res = await run(queryEfficiency, SUPABASE, { 'src/f.ts': source });
    assert.deepStrictEqual(all(res).map((v) => [v.rule, v.lineNo]), [['unbounded_select', 2]]);
  });

  it('a chain continued on the next lines is one statement', async () => {
    const source = `export async function f() {
  const { data } = await supabase
    .from('a')
    .select('*')
    .limit(10)
  return data
}
`;
    const res = await run(queryEfficiency, SUPABASE, { 'src/f.ts': source });
    assert.deepStrictEqual(rules(res), []);
  });
});

describe('check_query_efficiency: n_plus_one defaults to warning', () => {
  it('reported at warning level; configurable to error', async () => {
    const source = `export async function load(ids) {
  for (const id of ids) {
    await supabase.from('items').select('id').eq('id', id).single();
  }
}
`;
    const res = await run(queryEfficiency, SUPABASE, { 'src/load.ts': source });
    assert.deepStrictEqual(all(res).map((v) => v.severity), ['warning']);
    assert.strictEqual(res.level, 'warning');
    const strict = await run(queryEfficiency, {
      ...SUPABASE,
      '.clckernel.yaml': 'query_efficiency:\n  severities:\n    n_plus_one: error\n',
    }, { 'src/load.ts': source });
    assert.strictEqual(strict.level, 'error');
  });
});

describe('check_mcp_contracts: defaults only require an input schema', () => {
  const HEAD = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Pool } from "pg";
const server = new McpServer({ name: "s", version: "1.0.0" });
const Local = z.object({ id: z.string() });
`;

  it('inline, local schemas and a data client import pass without configuration', async () => {
    const source = `${HEAD}
server.registerTool("a", { description: "A", inputSchema: { q: z.string() } }, async () => ({ content: [] }));
server.registerTool("b", { description: "B", inputSchema: Local.shape }, async () => ({ content: [] }));
server.tool("c", "C", { id: z.string() }, async () => ({ content: [] }));
`;
    const res = await run(mcpContracts, MCP, { 'src/server.ts': source });
    assert.deepStrictEqual(rules(res), [], JSON.stringify(res.data.violations));
  });

  it('a tool without an input schema fails (missing_schema)', async () => {
    const source = `${HEAD}
server.registerTool("ping", { description: "No input" }, async () => ({ content: [] }));
server.tool("health", async () => ({ content: [] }));
`;
    const res = await run(mcpContracts, MCP, { 'src/server.ts': source });
    assert.deepStrictEqual(rules(res), ['missing_schema', 'missing_schema']);
  });

  it('forbid_data_clients applies when configured', async () => {
    const source = `${HEAD}
server.registerTool("b", { description: "B", inputSchema: Local.shape }, async () => ({ content: [] }));
`;
    const res = await run(mcpContracts, { ...MCP, '.clckernel.yaml': 'mcp_contracts:\n  forbid_data_clients: true\n' }, { 'src/server.ts': source });
    assert.deepStrictEqual(rules(res), ['data_client']);
  });
});

describe('check_sql_migrations heuristics', () => {
  const analyze = (sql, options = {}) => sqlMigrations.analyzeSql(sql, { schemas: ['public'], anon_roles: ['anon'], ...options });
  const ruleList = (findings) => findings.map((f) => f.rule);

  it('a later alter function ... set search_path satisfies search_path', () => {
    const sql = [
      'create function public.f() returns void language sql security definer as $$ select 1 $$;',
      "alter function public.f() set search_path = '';",
    ].join('\n');
    assert.deepStrictEqual(ruleList(analyze(sql)), []);
    assert.deepStrictEqual(ruleList(analyze(sql.split('\n')[0])), ['search_path']);
  });

  it('set search_path resolves the schema of unqualified names', () => {
    const sql = 'set search_path = app;\ncreate table items (id int);\n';
    assert.deepStrictEqual(ruleList(analyze(sql)), []);
    const findings = analyze(sql, { schemas: ['app'] });
    assert.deepStrictEqual(ruleList(findings), ['rls']);
    assert.match(findings[0].message, /app\.items/);
  });

  it('quoted "Items" and items are different tables', () => {
    const sql = 'create table "Items" (id int);\nalter table items enable row level security;\n';
    assert.deepStrictEqual(ruleList(analyze(sql)), ['rls']);
    const ok = 'create table "Items" (id int);\nalter table "Items" enable row level security;\n';
    assert.deepStrictEqual(ruleList(analyze(ok)), []);
  });

  it('alter table t drop c (no COLUMN keyword) is destructive; drop constraint / drop default are not', () => {
    const findings = analyze('alter table t drop c;\n');
    assert.deepStrictEqual(ruleList(findings), ['destructive']);
    assert.match(findings[0].message, /public\.t\.c/);
    assert.deepStrictEqual(ruleList(analyze('alter table t drop constraint k;\nalter table t alter column c drop default;\n')), []);
  });

  it('immutable: a migration only committed locally (not in the upstream) may change', () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlmig-remote-'));
    const MIG = 'supabase/migrations';
    const SAFE = 'create table public.t (id int);\nalter table public.t enable row level security;\n';
    const dir = createGitRepo({ [`${MIG}/001.sql`]: SAFE });
    try {
      git(remote, 'init', '-q', '--bare');
      git(dir, 'remote', 'add', 'origin', remote);
      git(dir, 'push', '-q', '-u', 'origin', 'HEAD:main');
      git(dir, 'branch', '-q', '--set-upstream-to=origin/main');
      stageFiles(dir, { [`${MIG}/002.sql`]: SAFE.replace(/\bt\b/g, 'u') });
      git(dir, 'commit', '-q', '--no-verify', '-m', 'local');
      stageFiles(dir, { [`${MIG}/002.sql`]: `${SAFE.replace(/\bt\b/g, 'u')}-- edited\n` });
      return sqlMigrations(dir).then((res) => {
        assert.deepStrictEqual(rules(res), [], JSON.stringify(res.data.violations));
        stageFiles(dir, { [`${MIG}/001.sql`]: `${SAFE}-- edited\n` });
        return sqlMigrations(dir);
      }).then((res) => {
        assert.deepStrictEqual(rules(res), ['immutable']);
      }).finally(() => {
        teardown(dir);
        teardown(remote);
      });
    } catch (err) {
      teardown(dir);
      teardown(remote);
      throw err;
    }
  });
});

describe('guards next to an older tools/_config.js (no guard sections)', () => {
  const OLD_CONFIG = `const { globToRegex } = require('./yaml.js');
const CONFIG_NAMES = ['.clckernel.yaml'];
function defaultConfig() {
  return { rules: [], exclude_paths: [], mirrors: { list: null, required: false }, update: { exclude: [] }, severities: {} };
}
module.exports = {
  CONFIG_NAMES, defaultConfig,
  loadConfig: () => ({ file: '.clckernel.yaml', config: defaultConfig(), warnings: [] }),
  reportWarnings() {},
  globMatcher: (globs) => { const res = (globs || []).map(globToRegex); return (f) => res.some((r) => r.test(f)); },
};
`;
  const GUARDS = {
    check_sql_migrations: { [`supabase/migrations/1.sql`]: 'create table public.x (id int);\n' },
    check_query_efficiency: { 'src/a.ts': "export const f = () => supabase.from('a').select('*');\n" },
    check_mcp_contracts: { 'src/s.ts': 'server.registerTool("x", { description: "x" }, async () => ({}));\n' },
    check_ui_reuse: { 'components/Button.tsx': 'export const B = () => <button>x</button>;\n' },
  };
  const DEPS = pkg({ '@supabase/supabase-js': '^2.0.0', '@modelcontextprotocol/sdk': '^1.0.0' });

  for (const [guard, staged] of Object.entries(GUARDS)) {
    for (const withConfigFile of [false, true]) {
      it(`${guard} runs with the section defaults${withConfigFile ? ' (config file present)' : ''}`, () => {
        const committed = { 'package.json': DEPS, 'tools/_config.js': OLD_CONFIG };
        if (withConfigFile) committed['.clckernel.yaml'] = 'exclude_paths: []\n';
        for (const file of [`${guard}.js`, '_changes.js', '_jscode.js', 'yaml.js']) {
          committed[`tools/${file}`] = fs.readFileSync(path.join(TOOLS, file), 'utf-8');
        }
        const dir = createGitRepo(committed, staged);
        try {
          const res = spawnSync(process.execPath, [`tools/${guard}.js`], { cwd: dir, encoding: 'utf-8' });
          assert.doesNotMatch(res.stderr, /TypeError|Cannot read properties/, res.stderr);
          const out = JSON.parse(res.stdout);
          assert.strictEqual(out.name, guard);
        } finally {
          teardown(dir);
        }
      });
    }
  }
});

describe('query_efficiency.call_patterns: both config readers reject an invalid regex', () => {
  it('JS', () => {
    const { validateConfig } = require('../tools/_config.js');
    assert.throws(() => validateConfig({ query_efficiency: { call_patterns: ['(unclosed'] } }), /query_efficiency\.call_patterns\[0\].*invalid regular expression/);
    assert.doesNotThrow(() => validateConfig({ query_efficiency: { call_patterns: ['\\brepo\\.(?<op>find)\\('] } }));
  });

  it('Python', () => {
    const script = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
      'import _config',
      'out = []',
      'for p in ["(unclosed", "\\\\brepo\\\\.(?<op>find)\\\\("]:',
      '    try:',
      '        _config.validate_config({"query_efficiency": {"call_patterns": [p]}})',
      '        out.append("ok")',
      '    except _config.ConfigError as e:',
      '        out.append(str(e))',
      'print(json.dumps(out))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', script], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const [bad, good] = JSON.parse(res.stdout);
    assert.match(bad, /query_efficiency\.call_patterns\[0\].*invalid regular expression/);
    assert.strictEqual(good, 'ok');
  });
});

describe('generated files: one list for verify_tdd and the JS guards', () => {
  it('the JS guards skip every GENERATED_FILES pattern', () => {
    const { isTestOrGenerated } = require('../tools/_jscode.js');
    for (const file of ['src/api.gen.ts', 'src/__generated__/schema.ts', 'lib/database.types.ts', 'x/y.generated.ts', 'generated/client.js']) {
      assert.ok(isTestOrGenerated(file), file);
    }
    assert.ok(!isTestOrGenerated('src/general.ts'));
    const source = fs.readFileSync(path.join(TOOLS, '_jscode.js'), 'utf-8');
    assert.match(source, /GENERATED_FILES/, '_jscode.js reads the list from _config.js');
  });
});

describe('docs quote the off level', () => {
  for (const readme of ['README.md', 'README.es.md']) {
    it(readme, () => {
      const text = fs.readFileSync(path.join(__dirname, '..', readme), 'utf-8');
      const bare = text.split('\n').filter((line) => /`off`|^\s*[\w-]+:\s*off\s*$/.test(line));
      assert.deepStrictEqual(bare, []);
    });
  }
});
