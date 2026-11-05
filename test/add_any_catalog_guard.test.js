/**
 * `--add-guards` accepts any bundled catalog
 * guard. A guard foreign to the stack is installed with a warning, recorded
 * in the registry, and refreshed by later updates (never reported as retired).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, git, plannedGuards } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const REGISTRY = 'tools/.clckernel-managed.json';
const NEXT = `${JSON.stringify({ name: 'web', dependencies: { next: '^15.0.0' } })}\n`;
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const registry = (dir) => JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
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
const installed = (files) => {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  quietly(() => generateHarness(dir, autoDetectStack(dir)));
  return dir;
};

describe('REQ-7: --add-guards accepts any catalog guard', () => {
  it('a guard foreign to the stack is installed, reported as foreign and recorded', () => {
    const dir = installed({ 'package.json': NEXT });
    try {
      assert.ok(!exists(dir, 'tools/check_api_contracts.js'));
      const result = quietly(() => updateHarness(dir, { addGuards: ['check_api_contracts', 'check_sql_migrations'] }));
      assert.deepStrictEqual(result.foreignGuards, ['check_api_contracts', 'check_sql_migrations']);
      assert.ok(exists(dir, 'tools/check_api_contracts.js'));
      assert.ok(exists(dir, 'tools/check_sql_migrations.js'));
      assert.deepStrictEqual(registry(dir).extraGuards, ['check_api_contracts', 'check_sql_migrations']);
      assert.ok(plannedGuards(dir).includes('check_sql_migrations.js'), 'the hook (audit orchestrator) runs it');
    } finally {
      teardown(dir);
    }
  });

  it('a later plain update refreshes the foreign guard instead of retiring it', () => {
    const dir = installed({ 'package.json': NEXT });
    try {
      quietly(() => updateHarness(dir, { addGuards: ['check_api_contracts'] }));
      // An older byte-identical kernel version would be overwritten: simulate a stale copy the registry vouches for.
      const file = path.join(dir, 'tools/check_api_contracts.js');
      const reg = registry(dir);
      const stale = '// stale kernel copy\n';
      fs.writeFileSync(file, stale);
      reg.files.find((f) => f.path === 'tools/check_api_contracts.js').sha256 = require('crypto').createHash('sha256').update(stale).digest('hex');
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(reg));

      const result = quietly(() => updateHarness(dir));
      assert.deepStrictEqual(result.retiredGuards, []);
      assert.ok(!result.plan.available.includes('check_api_contracts'));
      assert.notStrictEqual(fs.readFileSync(file, 'utf-8'), stale, 'refreshed to the bundled version');
      assert.deepStrictEqual(registry(dir).extraGuards, ['check_api_contracts']);
    } finally {
      teardown(dir);
    }
  });

  it('a Python stack can add a JS guard: the JS orchestrator and helpers come with it', () => {
    const dir = installed({ 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' });
    try {
      quietly(() => updateHarness(dir, { addGuards: ['check_sql_migrations'] }));
      for (const file of ['check_sql_migrations.js', 'audit.js', '_changes.js', '_config.js', 'yaml.js', 'package.json']) {
        assert.ok(exists(dir, `tools/${file}`), file);
      }
    } finally {
      teardown(dir);
    }
  });

  it('check_scope (Python only) can be added to a Node stack', () => {
    const dir = installed({ 'package.json': NEXT });
    try {
      quietly(() => updateHarness(dir, { addGuards: ['check_scope'] }));
      assert.ok(exists(dir, 'tools/check_scope.py'));
      assert.ok(exists(dir, 'tools/audit.py'), 'the Python orchestrator runs it');
    } finally {
      teardown(dir);
    }
  });

  it('names outside the catalog, external CLIs and planned guards are still rejected', () => {
    const dir = installed({ 'package.json': NEXT });
    try {
      for (const name of ['check_nonexistent', 'ruff', 'check_openapi_drift']) {
        assert.throws(() => quietly(() => updateHarness(dir, { addGuards: [name] })), /Unknown guard/, name);
      }
    } finally {
      teardown(dir);
    }
  });

  it('the CLI prints a warning naming the foreign guard', () => {
    const dir = installed({ 'package.json': NEXT });
    try {
      const res = spawnSync(process.execPath, [CLI, 'update', dir, '--add-guards', 'check_storybook'], { encoding: 'utf-8' });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.match(`${res.stdout}${res.stderr}`, /check_storybook.*not part of the detected stack/);
    } finally {
      teardown(dir);
    }
  });
});
