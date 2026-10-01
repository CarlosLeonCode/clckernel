const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');
const { generateHookFromManifest } = require('../src/generator');

/**
 * Builds an adapter stub whose manifest mirrors the real Next.js adapter,
 * including the external CLI entries that have no bundled file.
 */
function makeAdapter(overrides = {}) {
  return {
    name: 'Next.js (App Router)',
    projectType: 'frontend',
    provision() {},
    getSafeguards: () => [],
    getTools: () => [
      { name: 'scan_secrets', language: 'js', path: 'scan_secrets.js', command: 'node tools/scan_secrets.js' },
      { name: 'lint', language: 'external', path: '', command: 'npx lint-staged', extCLI: 'lint-staged' },
    ],
    ...overrides,
  };
}

describe('generateHookFromManifest() produces a working hook', () => {
  it('never sources a husky bootstrap file that the generator does not create', () => {
    const dir = createTmpProject({});
    try {
      generateHookFromManifest(makeAdapter(), dir);
      const hook = fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf-8');

      assert.ok(
        !hook.includes('_/husky.sh'),
        'hook must not source _/husky.sh unless that file exists'
      );
      assert.ok(
        !fs.existsSync(path.join(dir, '.husky', '_', 'husky.sh')),
        'generator does not create _/husky.sh, so it must not be referenced'
      );
    } finally {
      teardown(dir);
    }
  });

  it('runs the emitted hook end-to-end in a project with the bundled guards', () => {
    const dir = createTmpProject({
      'tools/scan_secrets.js': 'process.exit(0);\n',
    });
    try {
      generateHookFromManifest(makeAdapter(), dir);
      const hookFile = path.join(dir, '.husky', 'pre-commit');
      const { execSync } = require('child_process');
      try { fs.chmodSync(hookFile, '755'); } catch {}
      const res = execSync(`sh "${hookFile}"`, { cwd: dir, stdio: 'pipe' });
      assert.ok(res !== undefined, 'hook must run to completion');
    } finally {
      teardown(dir);
    }
  });

  it('does not invoke an external CLI that is not installed in the target', () => {
    const dir = createTmpProject({});
    try {
      generateHookFromManifest(makeAdapter(), dir);
      const hook = fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf-8');

      // No node_modules in this project, so lint-staged cannot resolve.
      assert.ok(
        !hook.includes('npx lint-staged'),
        'hook must not call lint-staged when it is not a dependency of the project'
      );
    } finally {
      teardown(dir);
    }
  });

  it('keeps the bundled guards that ship with the harness', () => {
    const dir = createTmpProject({});
    try {
      generateHookFromManifest(makeAdapter(), dir);
      const hook = fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf-8');
      assert.ok(
        hook.includes('node tools/scan_secrets.js'),
        'bundled guard commands must still run on commit'
      );
    } finally {
      teardown(dir);
    }
  });

  it('runs every emitted command successfully in a bare project', () => {
    const dir = createTmpProject({
      'tools/scan_secrets.js': 'module.exports = function() {};\n',
    });
    try {
      generateHookFromManifest(makeAdapter(), dir);
      const hookFile = path.join(dir, '.husky', 'pre-commit');
      const hook = fs.readFileSync(hookFile, 'utf-8');

      // Extract only the real command lines (skip shebang, source, echo, blanks).
      const commands = hook
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('. ') && !l.startsWith('echo '));

      const { spawnSync } = require('child_process');
      for (const cmd of commands) {
        const res = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf-8' });
        assert.strictEqual(
          res.status,
          0,
          `hook command must not fail: ${cmd}\nstderr: ${res.stderr}`
        );
      }
    } finally {
      teardown(dir);
    }
  });

  it('sources the husky bootstrap when the project actually has one', () => {
    const dir = createTmpProject({
      '.husky/_/husky.sh': '#!/usr/bin/env sh\n# real husky bootstrap\n',
    });
    try {
      generateHookFromManifest(makeAdapter(), dir);
      const hook = fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf-8');
      assert.ok(
        hook.includes('_/husky.sh'),
        'an existing husky bootstrap must still be sourced'
      );
    } finally {
      teardown(dir);
    }
  });

  it('enables an external CLI hook line once the project installs it', () => {
    const dir = createTmpProject({
      'node_modules/.bin/lint-staged': '#!/usr/bin/env node\n',
    });
    try {
      generateHookFromManifest(makeAdapter(), dir);
      const hook = fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf-8');
      assert.ok(
        hook.includes('npx lint-staged'),
        'installed CLIs must be wired into the hook'
      );
    } finally {
      teardown(dir);
    }
  });

  it('leaves backend .githooks hooks executable and self-contained', () => {
    const adapter = makeAdapter({ projectType: 'backend', name: 'FastAPI' });
    const dir = createTmpProject({});
    try {
      generateHookFromManifest(adapter, dir);
      const hookFile = path.join(dir, '.githooks', 'pre-commit');
      assert.ok(fs.existsSync(hookFile), 'backend hook should be written to .githooks/');

      const { statSync } = fs;
      const mode = statSync(hookFile).mode & 0o777;
      assert.ok(mode & 0o111, 'backend hook must be executable');

      const hook = fs.readFileSync(hookFile, 'utf-8');
      assert.ok(!hook.includes('_/husky.sh'), 'backend hook must not source the husky bootstrap');
    } finally {
      teardown(dir);
    }
  });
});
