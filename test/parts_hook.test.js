/**
 * sdds/fullstack-monorepo, decision 4 (TDD plan item 3): each external tool
 * of a part runs in that part's directory. Uses a fake adapter whose only
 * external tool is `clc_fake_tool`, an executable put on PATH by the test that
 * prints its working directory and exits with $CLC_FAKE_EXIT. The hook is run
 * with bash and with sh, directly and through a real `git commit`.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const BaseAdapter = require('../src/adapters/base');
const { generateHarness } = require('../src/generator');
const { createTmpProject, teardown, git } = require('./helpers');

class FakeAdapter extends BaseAdapter {
  constructor(name, toolName) {
    super(name, 'backend', 'fake test');
    this.toolName = toolName;
  }

  getTools() {
    return [{
      name: this.toolName, language: 'external', path: '', command: this.toolName,
      description: 'Fake external tool', availableIf: `command -v ${this.toolName}`,
    }];
  }
}

/** A repo with two parts: svc/api (fake tool) and the root (second fake tool). */
function fakeRepo() {
  const dir = createTmpProject({ 'svc/api/main.txt': 'api\n', 'README.md': '# repo\n' });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  const api = new FakeAdapter('Fake API', 'clc_fake_tool');
  const root = new FakeAdapter('Fake Root', 'clc_fake_root');
  const parts = [
    { dir: 'svc/api', adapter: api, framework: api.name, projectType: 'backend', testRunner: 'fake test' },
    { dir: '.', adapter: root, framework: root.name, projectType: 'backend', testRunner: 'fake test' },
  ];
  const config = {
    projectType: 'fullstack', framework: 'Fake API + Fake Root', styling: 'N/A', uiLibrary: 'N/A',
    testRunner: 'fake test', gitHooks: 'githooks', orm: 'Framework Native', adapter: api, parts, techTools: [],
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    generateHarness(dir, config);
  } finally {
    console.warn = warn;
  }
  return dir;
}

/** Directory holding the fake tools, prepended to PATH. */
function fakeBin(tools = ['clc_fake_tool', 'clc_fake_root']) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-fake-bin-'));
  for (const tool of tools) {
    const file = path.join(bin, tool);
    fs.writeFileSync(file, `#!/bin/sh\necho "${tool} pwd=$(pwd -P)"\nexit "\${CLC_FAKE_EXIT:-0}"\n`);
    fs.chmodSync(file, 0o755);
  }
  return bin;
}

function env(bin, extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) out[key] = value;
  }
  const PATH = bin ? `${bin}${path.delimiter}${out.PATH}` : out.PATH;
  return { ...out, PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

function runHook(shell, dir, bin, extra) {
  const res = spawnSync(shell, ['.githooks/pre-commit'], { cwd: dir, encoding: 'utf-8', env: env(bin, extra) });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('external tools run in their part dir', () => {
  for (const shell of ['bash', 'sh']) {
    it(`${shell}: the tool runs inside svc/api, the root tool at the root`, () => {
      const dir = fakeRepo();
      const bin = fakeBin();
      try {
        const res = runHook(shell, dir, bin);
        assert.strictEqual(res.status, 0, res.output);
        const real = fs.realpathSync(dir);
        assert.ok(res.output.includes(`clc_fake_tool pwd=${path.join(real, 'svc', 'api')}\n`), res.output);
        assert.ok(res.output.includes(`clc_fake_root pwd=${real}\n`), res.output);
      } finally {
        teardown(dir);
        teardown(bin);
      }
    });

    it(`${shell}: a failing tool fails the hook (set -e survives the subshell)`, () => {
      const dir = fakeRepo();
      const bin = fakeBin(['clc_fake_tool']);
      try {
        const res = runHook(shell, dir, bin, { CLC_FAKE_EXIT: '3' });
        assert.notStrictEqual(res.status, 0, res.output);
        assert.ok(!res.output.includes('clc_fake_root'), `the hook must stop at the failure:\n${res.output}`);
      } finally {
        teardown(dir);
        teardown(bin);
      }
    });

    it(`${shell}: a missing tool is skipped with its dir named, and the hook passes`, () => {
      const dir = fakeRepo();
      try {
        const res = runHook(shell, dir, null);
        assert.strictEqual(res.status, 0, res.output);
        assert.ok(res.output.includes('clckernel: clc_fake_tool (svc/api) not available, skipped'), res.output);
        assert.ok(res.output.includes('clckernel: clc_fake_root (.) not available, skipped'), res.output);
      } finally {
        teardown(dir);
      }
    });
  }

  it('git commit: the hook runs the tool in svc/api; a failure blocks the commit', () => {
    const dir = fakeRepo();
    const bin = fakeBin();
    try {
      git(dir, 'config', 'core.hooksPath', '.githooks');
      spawnSync('git', ['add', '-A'], { cwd: dir, env: env(bin) });
      const blocked = spawnSync('git', ['commit', '-m', 'blocked'], { cwd: dir, encoding: 'utf-8', env: env(bin, { CLC_FAKE_EXIT: '1' }) });
      assert.notStrictEqual(blocked.status, 0, `${blocked.stdout}${blocked.stderr}`);

      const ok = spawnSync('git', ['commit', '-m', 'ok'], { cwd: dir, encoding: 'utf-8', env: env(bin) });
      const output = `${ok.stdout}${ok.stderr}`;
      assert.strictEqual(ok.status, 0, output);
      assert.ok(output.includes(`clc_fake_tool pwd=${path.join(fs.realpathSync(dir), 'svc', 'api')}`), output);
    } finally {
      teardown(dir);
      teardown(bin);
    }
  });
});
