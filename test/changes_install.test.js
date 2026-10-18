/**
 * The snapshot helpers (tools/_changes.js, tools/_changes.py) ship with the
 * guards that import them, on every install path: _changes.js whenever a JS
 * guard is installed, _changes.py whenever a Python one is. The audit
 * orchestrators never mistake them for guards.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, withRegistry } = require('./helpers');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');
const { autoDetectStack } = require('../src/detector');

const TOOLS = path.resolve(__dirname, '..', 'tools');
function assertHelpersInstalled(dir, helpers = ['_changes.js', '_changes.py']) {
  for (const file of helpers) {
    const installed = path.join(dir, 'tools', file);
    assert.ok(fs.existsSync(installed), `tools/${file} must be installed`);
    assert.strictEqual(
      fs.readFileSync(installed, 'utf-8'),
      fs.readFileSync(path.join(TOOLS, file), 'utf-8'),
      `tools/${file} must match the bundled copy`
    );
  }
}

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

function initRepo(dir) {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

describe('_changes helpers are installed with the guards', () => {
  it('adapter install (Next.js) ships _changes.js and the installed guards load it', () => {
    const dir = createTmpProject({ 'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }) });
    try {
      generateHarness(dir, autoDetectStack(dir));
      assertHelpersInstalled(dir, ['_changes.js']);

      initRepo(dir);
      fs.writeFileSync(path.join(dir, 'clean.js'), 'module.exports = 1;\n');
      git(dir, 'add', 'clean.js');
      const res = spawnSync('node', [path.join(dir, 'tools', 'scan_secrets.js'), dir], { encoding: 'utf-8' });
      assert.strictEqual(res.status, 0, `installed guard must run: ${res.stderr}`);
    } finally {
      teardown(dir);
    }
  });

  it('generic fallback (unknown stack) ships _changes.js and stays free of Python files', () => {
    const dir = createTmpProject({});
    try {
      generateHarness(dir, { projectType: 'unknown' });
      assertHelpersInstalled(dir, ['_changes.js']);
      assert.ok(!fs.existsSync(path.join(dir, 'tools', '_changes.py')), 'no Python helper without Python guards');
    } finally {
      teardown(dir);
    }
  });

  it('a Python guard on a Node stack (technology guard) brings _changes.py', () => {
    const adapter = {
      name: 'NodeStack',
      projectType: 'frontend',
      getSafeguards: () => [],
      provision() {},
      getTools: () => [
        { name: 'scan_secrets', language: 'js', path: 'scan_secrets.js', command: 'node tools/scan_secrets.js' },
        { name: 'redis_guard', language: 'py', path: 'redis_guard.py', command: 'python3 tools/redis_guard.py' },
      ],
    };
    const dir = createTmpProject({});
    try {
      generateHarness(dir, { projectType: 'frontend', adapter });
      assertHelpersInstalled(dir, ['_changes.js', '_changes.py']);
    } finally {
      teardown(dir);
    }
  });

  it('legacy fallback (backend) ships both helpers and the installed Python guard loads them', () => {
    const dir = createTmpProject({});
    try {
      generateHarness(dir, { projectType: 'backend' });
      assertHelpersInstalled(dir);

      initRepo(dir);
      fs.writeFileSync(path.join(dir, 'clean.py'), 'x = 1\n');
      git(dir, 'add', 'clean.py');
      const res = spawnSync('python3', [path.join(dir, 'tools', 'scan_secrets.py'), dir], { encoding: 'utf-8' });
      assert.strictEqual(res.status, 0, `installed guard must run: ${res.stderr}`);
    } finally {
      teardown(dir);
    }
  });

  it('update restores missing helpers and refreshes stale ones', () => {
    // Stale but intact: the registry vouches for it (sdds/safe-update).
    const dir = createTmpProject(withRegistry({ 'tools/_changes.js': '// stale\n' }));
    try {
      updateHarness(dir);
      assertHelpersInstalled(dir, ['_changes.js']);
    } finally {
      teardown(dir);
    }
  });
});

describe('audit orchestrators do not treat the helpers as guards', () => {
  it('audit.js discovery skips _changes.js', () => {
    const { discoverGuards } = require('../tools/audit.js');
    const names = discoverGuards(TOOLS).map((p) => path.basename(p));
    assert.ok(names.length > 0, 'sanity: guards are discovered');
    assert.ok(!names.some((n) => n.startsWith('_')), `unexpected helper in ${names.join(', ')}`);
  });

  it('audit.py discovery skips _changes.py', () => {
    const script = [
      'import importlib.util, json, pathlib, sys',
      `p = pathlib.Path(${JSON.stringify(path.join(TOOLS, 'audit.py'))})`,
      'spec = importlib.util.spec_from_file_location("audit_under_test", str(p))',
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'print(json.dumps([g.name for g in m.discover_guards(p.parent)]))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', script], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const names = JSON.parse(res.stdout);
    assert.ok(names.length > 0, 'sanity: guards are discovered');
    assert.ok(!names.some((n) => n.startsWith('_')), `unexpected helper in ${names.join(', ')}`);
  });
});
