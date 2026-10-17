/**
 * sdds/monorepo-gaps, gap 1: with npm/yarn/pnpm workspaces the Node binaries
 * of a part are usually hoisted to the repository root's node_modules/.bin.
 * A part's Node-based external tool (availableIf `[ -x node_modules/.bin/<bin> ]`,
 * command `npx <bin> ...`) must accept the part's own binary or the hoisted
 * one, and run the binary it found, with cwd = the part dir.
 *
 * The fake binary prints a tag, its working directory and its arguments, and
 * exits with $CLC_FAKE_EXIT. The hook runs with bash and with sh.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const BaseAdapter = require('../src/adapters/base');
const { generateHarness } = require('../src/generator');
const { createTmpProject, teardown, git } = require('./helpers');

const BIN = 'clc_fake_node';

class NodeToolAdapter extends BaseAdapter {
  constructor() {
    super('Fake Web', 'frontend', 'fake test');
  }

  getTools() {
    return [{
      name: BIN, language: 'external', path: '', command: `npx ${BIN} --check`,
      description: 'Fake Node tool', extCLI: BIN, availableIf: `[ -x node_modules/.bin/${BIN} ]`,
    }];
  }
}

class SilentAdapter extends BaseAdapter {
  constructor() {
    super('Fake API', 'backend', 'fake test');
  }

  getTools() {
    return [{
      name: 'clc_fake_absent', language: 'external', path: '', command: 'clc_fake_absent',
      description: 'Absent tool', availableIf: 'command -v clc_fake_absent',
    }];
  }
}

/** Monorepo with apps/web (Node tool) and apps/api; `bins` maps a node_modules dir to a tag. */
function monorepo(bins = {}) {
  const dir = createTmpProject({
    'package.json': JSON.stringify({ name: 'mono', private: true, workspaces: ['apps/*'] }),
    'apps/web/index.js': 'module.exports = 1;\n',
    'apps/api/main.txt': 'api\n',
  });
  git(dir, 'init', '-q');
  const web = new NodeToolAdapter();
  const api = new SilentAdapter();
  const parts = [
    { dir: 'apps/web', adapter: web, framework: web.name, projectType: 'frontend', testRunner: 'fake test' },
    { dir: 'apps/api', adapter: api, framework: api.name, projectType: 'backend', testRunner: 'fake test' },
  ];
  const config = {
    projectType: 'monorepo', framework: 'Fake Web + Fake API', styling: 'N/A', uiLibrary: 'N/A',
    testRunner: 'fake test', gitHooks: 'githooks', orm: 'Framework Native', adapter: web, parts, techTools: [],
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    generateHarness(dir, config);
  } finally {
    console.warn = warn;
  }
  for (const [modulesDir, tag] of Object.entries(bins)) {
    const binDir = path.join(dir, modulesDir, '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const file = path.join(binDir, BIN);
    fs.writeFileSync(file, `#!/bin/sh\necho "${BIN} ${tag} pwd=$(pwd -P) args=$*"\nexit "\${CLC_FAKE_EXIT:-0}"\n`);
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

function env(extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) out[key] = value;
  }
  return { ...out, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

function runHook(shell, dir, extra) {
  const res = spawnSync(shell, ['.githooks/pre-commit'], { cwd: dir, encoding: 'utf-8', env: env(extra) });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

const webDir = (dir) => path.join(fs.realpathSync(dir), 'apps', 'web');

describe('hoisted Node binaries of a part', () => {
  for (const shell of ['bash', 'sh']) {
    it(`${shell}: a binary only in the root node_modules runs with cwd = the part dir`, () => {
      const dir = monorepo({ node_modules: 'hoisted' });
      try {
        const res = runHook(shell, dir);
        assert.strictEqual(res.status, 0, res.output);
        assert.ok(res.output.includes(`${BIN} hoisted pwd=${webDir(dir)} args=--check\n`), res.output);
        assert.ok(!res.output.includes(`${BIN} (apps/web) not available`), res.output);
      } finally {
        teardown(dir);
      }
    });

    it(`${shell}: a failing hoisted binary fails the hook`, () => {
      const dir = monorepo({ node_modules: 'hoisted' });
      try {
        const res = runHook(shell, dir, { CLC_FAKE_EXIT: '4' });
        assert.notStrictEqual(res.status, 0, res.output);
        assert.ok(res.output.includes(`${BIN} hoisted pwd=${webDir(dir)}`), res.output);
        assert.ok(!res.output.includes('clc_fake_absent'), `the hook must stop at the failure:\n${res.output}`);
      } finally {
        teardown(dir);
      }
    });

    it(`${shell}: the part's own binary wins over the hoisted one`, () => {
      const dir = monorepo({ node_modules: 'hoisted', 'apps/web/node_modules': 'local' });
      try {
        const res = runHook(shell, dir);
        assert.strictEqual(res.status, 0, res.output);
        assert.ok(res.output.includes(`${BIN} local pwd=${webDir(dir)} args=--check\n`), res.output);
        assert.ok(!res.output.includes(`${BIN} hoisted`), res.output);
      } finally {
        teardown(dir);
      }
    });

    it(`${shell}: neither binary present -> skipped with the part dir named`, () => {
      const dir = monorepo();
      try {
        const res = runHook(shell, dir);
        assert.strictEqual(res.status, 0, res.output);
        assert.ok(res.output.includes(`clckernel: ${BIN} (apps/web) not available, skipped`), res.output);
      } finally {
        teardown(dir);
      }
    });
  }
});
