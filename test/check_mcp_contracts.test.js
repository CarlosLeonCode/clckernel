/**
 * check_mcp_contracts (sdds/laila-platform-fit, REQ-16): MCP tool
 * registrations (registerTool and the deprecated tool()) take their input
 * schema from a contracts module, never an inline zod schema, and the file
 * imports no data client. A compliant server and each violation.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');

const check = require('../tools/check_mcp_contracts');

const pkg = (deps) => `${JSON.stringify({ name: 'mcp', dependencies: deps }, null, 2)}\n`;
const BASE = {
  'package.json': pkg({ '@modelcontextprotocol/sdk': '^1.0.0', zod: '^3.0.0', '@acme/contracts': '*' }),
  '.clckernel.yaml': 'mcp_contracts:\n  contracts_modules:\n    - "@acme/contracts"\n',
};
const HEAD = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CreateItemInput, contracts } from "@acme/contracts";
import * as more from "@acme/contracts/items";
import { createItem } from "../use-cases/create-item";

export const server = new McpServer({ name: "acme", version: "1.0.0" });
`;

async function run(staged, committed = BASE) {
  const dir = createGitRepo(committed, staged);
  try {
    return await check(dir);
  } finally {
    teardown(dir);
  }
}
const rules = (res) => Object.values(res.data.violations).flat().map((v) => v.rule);

describe('check_mcp_contracts: compliant server', () => {
  it('registerTool and the legacy tool() with contracts schemas pass', async () => {
    const source = `${HEAD}
server.registerTool(
  "create_item",
  { title: "Create item", description: "Creates an item", inputSchema: CreateItemInput.shape },
  async (input) => ({ content: [{ type: "text", text: JSON.stringify(await createItem(input)) }] }),
);
server.registerTool("list_items", { description: "Lists", inputSchema: contracts.ListItemsInput }, async () => ({ content: [] }));
server.registerTool("ping", { description: "No input" }, async () => ({ content: [] }));
server.tool("archive_item", "Archives an item", more.ArchiveItemInput.shape, async (input) => ({ content: [] }));
server.tool("health", async () => ({ content: [] }));
// server.registerTool("x", { inputSchema: z.object({}) }, cb) in a comment is ignored
`;
    const res = await run({ 'src/server.ts': source });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res, null, 2));
  });
});

describe('check_mcp_contracts: inline schemas', () => {
  for (const [name, registration] of Object.entries({
    'registerTool + inputSchema: z.object(...)': 'server.registerTool("t", { inputSchema: z.object({ id: z.string() }) }, async () => ({ content: [] }));',
    'registerTool + raw shape { id: z.string() }': 'server.registerTool("t", { description: "d", inputSchema: { id: z.string() } }, async () => ({ content: [] }));',
    'legacy tool() + raw shape': 'server.tool("t", "desc", { id: z.string().uuid() }, async () => ({ content: [] }));',
    'legacy tool() + z.object(...).shape': 'server.tool("t", z.object({ id: z.string() }).shape, async () => ({ content: [] }));',
  })) {
    it(`${name} => inline_schema`, async () => {
      const res = await run({ 'src/server.ts': `${HEAD}\n${registration}\n` });
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(rules(res), ['inline_schema']);
      assert.match(res.data.violations['src/server.ts'][0].message, /"t"/);
    });
  }
});

describe('check_mcp_contracts: schema source', () => {
  it('a schema declared in the tool file => schema_source', async () => {
    const source = `${HEAD}\nconst LocalInput = CreateItemInput.extend({});\nserver.registerTool("t", { inputSchema: LocalInput }, async () => ({ content: [] }));\n`;
    const res = await run({ 'src/server.ts': source });
    assert.deepStrictEqual(rules(res), ['schema_source']);
  });

  it('a schema imported from another module => schema_source naming the module', async () => {
    const source = `${HEAD}\nimport { Other } from "./schemas";\nserver.registerTool("t", { inputSchema: Other }, async () => ({ content: [] }));\n`;
    const res = await run({ 'src/server.ts': source });
    assert.deepStrictEqual(rules(res), ['schema_source']);
    assert.match(res.data.violations['src/server.ts'][0].message, /\.\/schemas/);
  });

  it('without contracts_modules, any imported schema passes and a local one fails', async () => {
    const committed = { 'package.json': BASE['package.json'] };
    const ok = await run({ 'src/server.ts': `${HEAD}\nimport { Other } from "./schemas";\nserver.registerTool("t", { inputSchema: Other }, async () => ({ content: [] }));\n` }, committed);
    assert.strictEqual(ok.exitCode, 0, JSON.stringify(ok));
    const bad = await run({ 'src/server.ts': `${HEAD}\nconst Local = Other;\nserver.registerTool("t", { inputSchema: Local }, async () => ({ content: [] }));\n` }, committed);
    assert.deepStrictEqual(rules(bad), ['schema_source']);
  });
});

describe('check_mcp_contracts: data clients in tool files', () => {
  for (const mod of ['@supabase/supabase-js', 'drizzle-orm/pg-core', '@prisma/client', 'pg']) {
    it(`a tool file importing ${mod} => data_client`, async () => {
      const source = `${HEAD}\nimport { thing } from "${mod}";\nserver.registerTool("t", { inputSchema: CreateItemInput }, async () => ({ content: [] }));\n`;
      const res = await run({ 'src/server.ts': source });
      assert.deepStrictEqual(rules(res), ['data_client']);
      assert.match(res.data.violations['src/server.ts'][0].message, new RegExp(mod.replace(/[/.@-]/g, '.')));
    });
  }

  it('require() of a data client counts too; forbid_data_clients: false allows it', async () => {
    const source = `${HEAD}\nconst { createClient } = require("@supabase/supabase-js");\nserver.registerTool("t", { inputSchema: CreateItemInput }, async () => ({ content: [] }));\n`;
    assert.deepStrictEqual(rules(await run({ 'src/server.ts': source })), ['data_client']);
    const allowed = { ...BASE, '.clckernel.yaml': `${BASE['.clckernel.yaml']}  forbid_data_clients: false\n` };
    assert.strictEqual((await run({ 'src/server.ts': source }, allowed)).exitCode, 0);
  });

  it('a file that registers no tool may import a data client', async () => {
    const res = await run({ 'src/db.ts': 'import { createClient } from "@supabase/supabase-js";\nexport const db = createClient("u", "k");\n' });
    assert.strictEqual(res.exitCode, 0);
  });
});

describe('check_mcp_contracts: scope', () => {
  it('a package without @modelcontextprotocol/sdk is not checked', async () => {
    const res = await run({ 'src/server.ts': 'server.tool("t", { id: z.string() }, async () => ({}));\n' }, { 'package.json': pkg({ zod: '3' }) });
    assert.strictEqual(res.exitCode, 0);
  });

  it('test files are skipped', async () => {
    const res = await run({ 'src/server.test.ts': `${HEAD}\nserver.registerTool("t", { inputSchema: z.object({}) }, async () => ({ content: [] }));\n` });
    assert.strictEqual(res.exitCode, 0);
  });

  it('run as a script: JSON and exit 1 on a violation', () => {
    const dir = createGitRepo(BASE, { 'src/server.ts': `${HEAD}\nserver.registerTool("t", { inputSchema: z.object({}) }, async () => ({ content: [] }));\n` });
    try {
      const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'check_mcp_contracts.js')], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 1, res.stderr);
      assert.strictEqual(JSON.parse(res.stdout).name, 'check_mcp_contracts');
    } finally {
      teardown(dir);
    }
  });
});
