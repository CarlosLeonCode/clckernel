/**
 * sdds/residual-fixes item 1: the installer decides from the repository's own
 * (local) core.hooksPath. A global or system value (a user-wide hooks dir)
 * neither blocks configuring the project nor makes it look like Husky.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const NEXT_PKG = JSON.stringify({ name: 'web', private: true, dependencies: { next: '14.0.0', react: '18.0.0' } });

/** Env whose global git config is a temp file setting core.hooksPath (no system config). */
function globalHooksEnv(value) {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-gitcfg-'));
  const file = path.join(cfgDir, 'gitconfig');
  fs.writeFileSync(file, `[core]\n\thooksPath = ${value}\n`);
  return { env: { ...process.env, CI: '1', GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1' }, cfgDir };
}

function git(dir, args, env) {
  return spawnSync('git', args, { cwd: dir, env, encoding: 'utf-8' });
}

function install(dir, env) {
  const res = spawnSync('node', [CLI_PATH, dir, '--yes'], { cwd: dir, env, encoding: 'utf-8', timeout: 60000 });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('core.hooksPath: only the local scope decides (sdds/residual-fixes item 1)', () => {
  it('a global hooksPath does not block setting the local .githooks; a note is printed', () => {
    const { env, cfgDir } = globalHooksEnv('/tmp/user-wide-hooks');
    const dir = createTmpProject({ 'pom.xml': '<project/>\n' });
    try {
      assert.strictEqual(git(dir, ['init', '-q'], env).status, 0);
      const res = install(dir, env);
      assert.strictEqual(res.status, 0, res.output);
      assert.strictEqual(git(dir, ['config', '--local', '--get', 'core.hooksPath'], env).stdout.trim(), '.githooks', res.output);
      assert.match(res.output, /global .*core\.hooksPath|core\.hooksPath .*global/i, 'must note the global value');
      assert.doesNotMatch(res.output, /another hook manager/, res.output);
    } finally {
      teardown(dir);
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it('a global hooksPath of .husky does not make a frontend project look like Husky', () => {
    const { env, cfgDir } = globalHooksEnv('.husky');
    const dir = createTmpProject({ 'package.json': NEXT_PKG });
    try {
      assert.strictEqual(git(dir, ['init', '-q'], env).status, 0);
      const res = install(dir, env);
      assert.strictEqual(res.status, 0, res.output);
      assert.ok(fs.existsSync(path.join(dir, '.githooks', 'pre-commit')), `hook must go to .githooks:\n${res.output}`);
      assert.ok(!fs.existsSync(path.join(dir, '.husky', 'pre-commit')), 'no .husky hook without a local Husky');
      assert.strictEqual(git(dir, ['config', '--local', '--get', 'core.hooksPath'], env).stdout.trim(), '.githooks');
    } finally {
      teardown(dir);
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it('a local .husky/_ still means Husky is active (unchanged)', () => {
    const { env, cfgDir } = globalHooksEnv('/tmp/user-wide-hooks');
    const dir = createTmpProject({ 'package.json': NEXT_PKG });
    try {
      assert.strictEqual(git(dir, ['init', '-q'], env).status, 0);
      assert.strictEqual(git(dir, ['config', 'core.hooksPath', '.husky/_'], env).status, 0);
      const res = install(dir, env);
      assert.strictEqual(res.status, 0, res.output);
      assert.ok(fs.existsSync(path.join(dir, '.husky', 'pre-commit')), res.output);
      assert.strictEqual(git(dir, ['config', '--local', '--get', 'core.hooksPath'], env).stdout.trim(), '.husky/_');
    } finally {
      teardown(dir);
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
