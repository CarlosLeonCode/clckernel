/**
 * Supabase / SQL migrations / data client / MCP
 * technology detection (REQ-4, REQ-14, REQ-15, REQ-16 triggers) and
 * `clckernel update` re-detecting technologies that appeared after install
 * (REQ-17).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, git } = require('./helpers');
const { TechnologyDetector } = require('../src/technologies/detector');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const REGISTRY = 'tools/.clckernel-managed.json';
const pkg = (deps = {}, extra = {}) => `${JSON.stringify({ name: 'x', private: true, dependencies: deps, ...extra }, null, 2)}\n`;
const NEXT = pkg({ next: '^15.0.0' });
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const quietly = (fn) => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};
const install = (dir) => quietly(() => generateHarness(dir, autoDetectStack(dir)));
const update = (dir, options = {}) => quietly(() => updateHarness(dir, options));
const techNames = (config) => config.techTools.map((t) => t.name);
const project = (files) => {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  return dir;
};

describe('REQ-4: TechnologyDetector finds Supabase, data clients and MCP servers', () => {
  const detect = (files, options) => {
    const dir = createTmpProject(files);
    try {
      return new TechnologyDetector().detect(dir, options);
    } finally {
      teardown(dir);
    }
  };

  it('supabase/config.toml => supabase', () => {
    assert.ok(detect({ 'supabase/config.toml': 'project_id = "x"\n' }).includes('supabase'));
    assert.ok(!detect({ 'supabase/seed.sql': '' }).includes('supabase'));
  });

  for (const client of ['@supabase/supabase-js', 'drizzle-orm', '@prisma/client', 'postgres', 'pg']) {
    it(`package.json depending on ${client} => data-client`, () => {
      assert.ok(detect({ 'package.json': pkg({ [client]: '1.0.0' }) }).includes('data-client'));
    });
  }

  it('a dev dependency counts; an unrelated package does not', () => {
    assert.ok(detect({ 'package.json': JSON.stringify({ devDependencies: { pg: '8' } }) }).includes('data-client'));
    assert.ok(!detect({ 'package.json': pkg({ 'pg-format': '1' }) }).includes('data-client'));
  });

  it('@modelcontextprotocol/sdk => mcp', () => {
    assert.ok(detect({ 'package.json': pkg({ '@modelcontextprotocol/sdk': '^1.0.0' }) }).includes('mcp'));
  });

  it('configured sql_migrations.paths whose folder exists => sql-migrations', () => {
    const files = { 'db/migrations/001.sql': '' };
    assert.ok(detect(files, { sqlMigrationPaths: ['db/migrations/*.sql'] }).includes('sql-migrations'));
    assert.ok(!detect(files, { sqlMigrationPaths: ['other/*.sql'] }).includes('sql-migrations'));
    assert.ok(!detect(files).includes('sql-migrations'));
  });

  it('each technology brings its guard, once', () => {
    const tools = new TechnologyDetector().getToolsForTech(['supabase', 'sql-migrations', 'data-client', 'mcp']);
    assert.deepStrictEqual(tools.map((t) => t.name), ['check_sql_migrations', 'check_query_efficiency', 'check_mcp_contracts']);
    for (const tool of tools) {
      assert.strictEqual(tool.language, 'js');
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools', tool.path)), tool.path);
      assert.ok(tool.technology, `${tool.name} names its technology`);
    }
  });
});

describe('REQ-4/14/15/16: install wires the detected technologies', () => {
  it('a monorepo with supabase/ at the root, a supabase-js package and an MCP package installs the three guards', () => {
    const dir = project({
      'package.json': pkg({}, { workspaces: ['apps/*', 'packages/*'] }),
      'apps/web/package.json': NEXT,
      'packages/org/package.json': pkg({ '@supabase/supabase-js': '^2.0.0' }),
      'packages/org/tsconfig.json': '{}\n',
      'packages/mcp/package.json': pkg({ '@modelcontextprotocol/sdk': '^1.0.0' }),
      'packages/mcp/tsconfig.json': '{}\n',
      'supabase/config.toml': 'project_id = "x"\n',
    });
    try {
      const config = autoDetectStack(dir);
      for (const name of ['check_sql_migrations', 'check_query_efficiency', 'check_mcp_contracts']) {
        assert.ok(techNames(config).includes(name), name);
      }
      install(dir);
      for (const file of ['check_sql_migrations.js', 'check_query_efficiency.js', 'check_mcp_contracts.js']) {
        assert.ok(exists(dir, `tools/${file}`), file);
      }
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.match(agents, /Supabase/);
      const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
      assert.deepStrictEqual(registry.technologies, ['data-client', 'mcp', 'supabase']);
    } finally {
      teardown(dir);
    }
  });

  it('a Supabase project inside a part is detected too', () => {
    const dir = project({
      'package.json': pkg({}, { workspaces: ['apps/*'] }),
      'apps/web/package.json': NEXT,
      'apps/web/supabase/config.toml': 'project_id = "x"\n',
    });
    try {
      assert.ok(techNames(autoDetectStack(dir)).includes('check_sql_migrations'));
    } finally {
      teardown(dir);
    }
  });

  it('a configured migrations folder (no Supabase) installs check_sql_migrations', () => {
    const dir = project({
      'package.json': NEXT,
      '.clckernel.yaml': 'sql_migrations:\n  paths:\n    - "db/migrations/**/*.sql"\n',
      'db/migrations/001_init.sql': 'select 1;\n',
    });
    try {
      assert.ok(techNames(autoDetectStack(dir)).includes('check_sql_migrations'));
    } finally {
      teardown(dir);
    }
  });

  it('the CLI summary lists the detected technologies', () => {
    const dir = project({ 'package.json': NEXT, 'supabase/config.toml': 'project_id = "x"\n' });
    try {
      const res = spawnSync(process.execPath, [CLI, dir, '--yes'], { encoding: 'utf-8', env: { ...process.env, CI: '1' } });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.match(res.stdout, /Supabase/);
    } finally {
      teardown(dir);
    }
  });
});

describe('REQ-17: update re-detects technologies', () => {
  it('Supabase added after install: --dry-run lists check_sql_migrations and writes nothing; update installs it', () => {
    const dir = project({ 'package.json': NEXT });
    try {
      install(dir);
      assert.ok(!exists(dir, 'tools/check_sql_migrations.js'));
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');

      const dry = update(dir, { dryRun: true });
      assert.ok(dry.plan.detected.some((entry) => entry.startsWith('check_sql_migrations')), JSON.stringify(dry.plan.detected));
      assert.ok(!exists(dir, 'tools/check_sql_migrations.js'), 'dry run writes nothing');

      const real = update(dir);
      assert.ok(real.plan.detected.some((entry) => entry.startsWith('check_sql_migrations')));
      assert.ok(exists(dir, 'tools/check_sql_migrations.js'));
      const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
      assert.ok(registry.technologies.includes('supabase'));
      assert.ok(registry.files.some((f) => f.path === 'tools/check_sql_migrations.js'));
    } finally {
      teardown(dir);
    }
  });

  it('a Dockerfile added after install brings docker_guard on update', () => {
    const dir = project({ 'package.json': NEXT });
    try {
      install(dir);
      write(dir, 'Dockerfile', 'FROM node:22\n');
      const result = update(dir);
      assert.ok(result.plan.detected.some((entry) => entry.startsWith('docker_guard')));
      assert.ok(exists(dir, 'tools/docker_guard.py'));
    } finally {
      teardown(dir);
    }
  });

  it('a technology already recorded is not re-added after its guard was removed', () => {
    const dir = project({ 'package.json': NEXT, 'supabase/config.toml': 'project_id = "x"\n' });
    try {
      install(dir);
      fs.rmSync(path.join(dir, 'tools/check_sql_migrations.js'));
      // The registry still lists the file: drop it as a user removing the guard would leave it after an update.
      const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
      registry.files = registry.files.filter((f) => f.path !== 'tools/check_sql_migrations.js');
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(registry));
      const result = update(dir);
      assert.deepStrictEqual(result.plan.detected, []);
      assert.ok(!exists(dir, 'tools/check_sql_migrations.js'));
      assert.ok(result.plan.available.includes('check_sql_migrations'));
    } finally {
      teardown(dir);
    }
  });

  it('an older registry without technologies is a baseline: nothing is added, the next new technology is', () => {
    const dir = project({ 'package.json': NEXT });
    try {
      install(dir);
      const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
      delete registry.technologies;
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(registry));
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');
      const first = update(dir);
      assert.ok(!exists(dir, 'tools/check_sql_migrations.js'));
      assert.ok(first.plan.available.includes('check_sql_migrations'));
      write(dir, 'Dockerfile', 'FROM node:22\n');
      update(dir);
      assert.ok(exists(dir, 'tools/docker_guard.py'));
      assert.ok(!exists(dir, 'tools/check_sql_migrations.js'));
    } finally {
      teardown(dir);
    }
  });

  it('without a new technology, update adds nothing (update-no-additions kept)', () => {
    const dir = project({ 'package.json': NEXT });
    try {
      install(dir);
      const result = update(dir);
      assert.deepStrictEqual(result.plan.detected, []);
      assert.deepStrictEqual(result.plan.written, []);
    } finally {
      teardown(dir);
    }
  });
});
