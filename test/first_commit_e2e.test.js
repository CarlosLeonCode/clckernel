/**
 * sdds/first-commit: in a freshly installed project the install commit goes
 * through the real hook, without --no-verify, and the hook written is the one
 * git runs. Every scenario uses real `git commit` calls in a throwaway repo.
 *
 * Scenarios run concurrently (async child processes) to keep the runtime low.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { registryPaths } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const HOOK_MARKER = 'Running CLC Kernel';
const REGISTRY = 'tools/.clckernel-managed.json';

/**
 * Environment for every child: no git variables inherited from a hook that
 * may be running this suite, no user/system git config, never interactive.
 */
function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', CI: '1' };
}

/** Async process runner: resolves with status and combined output, never rejects. */
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (err) => resolve({ status: null, output: `${output}${err.message}` }));
    child.on('close', (status) => resolve({ status, output }));
  });
}

async function git(dir, ...args) {
  const res = await run('git', args, dir);
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed:\n${res.output}`);
  return res.output.trim();
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }
}

/** Throwaway repository with the fixture files committed (the project before install). */
async function createRepo(files, { hooksPath } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-first-commit-'));
  write(dir, files);
  await git(dir, 'init', '-q');
  await git(dir, 'config', 'user.name', 'First Commit');
  await git(dir, 'config', 'user.email', 'first-commit@example.com');
  if (hooksPath) await git(dir, 'config', 'core.hooksPath', hooksPath);
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '--no-verify', '-m', 'project');
  return dir;
}

async function install(dir) {
  const res = await run(process.execPath, [CLI, dir, '--yes'], dir);
  assert.strictEqual(res.status, 0, `install failed:\n${res.output}`);
  return res.output;
}

async function update(dir) {
  const res = await run(process.execPath, [CLI, 'update', dir], dir);
  assert.strictEqual(res.status, 0, `update failed:\n${res.output}`);
  return res.output;
}

/** `git add -A` + `git commit` through the hook (never --no-verify). */
async function commitAll(dir, message) {
  await git(dir, 'add', '-A');
  return run('git', ['commit', '-m', message], dir);
}

function teardown(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function commandAvailable(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'ignore' });
  return !res.error && res.status === 0;
}

const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;

// Minimal detection fixtures, one per stack (same signals the adapter tests use).
const STACKS = {
  FastAPI: { 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' },
  Django: { 'requirements.txt': 'django\n', 'app/__init__.py': '' },
  Astro: {
    'package.json': PACKAGE({ name: 'site', private: true, dependencies: { astro: '^4.0.0' } }),
    'astro.config.mjs': 'export default {};\n',
  },
  'Next.js': { 'package.json': PACKAGE({ name: 'web', private: true, dependencies: { next: '^14.0.0' } }) },
  Rails: { Gemfile: "source 'https://rubygems.org'\n", 'config/routes.rb': 'Rails.application.routes.draw do\nend\n' },
  Go: { 'go.mod': 'module example.com/app\n\ngo 1.21\n', 'main.go': 'package main\n\nfunc main() {}\n' },
  Laravel: { 'composer.json': PACKAGE({ name: 'acme/app' }), artisan: '#!/usr/bin/env php\n<?php\n' },
  Rust: {
    'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/main.rs': 'fn main() {}\n',
    '.gitignore': 'target/\n',
  },
  'agent-os': { 'package.json': PACKAGE({ name: 'acme-agent-os', private: true, keywords: ['agent-os'] }) },
  generic: { 'README.md': '# A project of an unknown stack\n' },
};

describe('the install commit passes through the real hook', { concurrency: true }, () => {
  for (const [stack, files] of Object.entries(STACKS)) {
    it(`${stack}: clckernel --yes, git add -A, git commit -> exit 0 and the hook ran`, async () => {
      const dir = await createRepo(files);
      try {
        await install(dir);
        const res = await commitAll(dir, 'install');
        assert.strictEqual(res.status, 0, `install commit failed:\n${res.output}`);
        assert.ok(res.output.includes(HOOK_MARKER), `the hook did not run:\n${res.output}`);
      } finally {
        teardown(dir);
      }
    });
  }

  it('FastAPI: ruff runs on the install commit and passes (skipped without ruff)', async (t) => {
    if (!commandAvailable('python3', ['-m', 'ruff', '--version'])) {
      t.skip('ruff is not installed');
      return;
    }
    const dir = await createRepo(STACKS.FastAPI);
    try {
      await install(dir);
      const res = await commitAll(dir, 'install');
      assert.strictEqual(res.status, 0, `install commit failed:\n${res.output}`);
      assert.ok(!res.output.includes('ruff not available'), `ruff did not run:\n${res.output}`);
    } finally {
      teardown(dir);
    }
  });

  it('FastAPI: the commit after `clckernel update` refreshes tools/ passes', async () => {
    const dir = await createRepo(STACKS.FastAPI);
    try {
      await install(dir);
      await git(dir, 'add', '-A');
      await git(dir, 'commit', '-q', '--no-verify', '-m', 'install');
      // Pretend tools/ holds an older release: update has to rewrite them.
      for (const file of fs.readdirSync(path.join(dir, 'tools'))) {
        if (file.endsWith('.py')) fs.appendFileSync(path.join(dir, 'tools', file), '# older release\n');
      }
      await git(dir, 'add', '-A');
      await git(dir, 'commit', '-q', '--no-verify', '-m', 'older harness');

      await update(dir);
      const changed = await git(dir, 'status', '--porcelain', 'tools');
      assert.ok(changed.length > 0, 'update must have changed tools/');
      const res = await commitAll(dir, 'update harness');
      assert.strictEqual(res.status, 0, `update commit failed:\n${res.output}`);
      assert.ok(res.output.includes(HOOK_MARKER), `the hook did not run:\n${res.output}`);
    } finally {
      teardown(dir);
    }
  });

  it('FastAPI: user code without a test is still blocked by verify_tdd', async () => {
    const dir = await createRepo(STACKS.FastAPI);
    try {
      await install(dir);
      await git(dir, 'add', '-A');
      await git(dir, 'commit', '-q', '--no-verify', '-m', 'install');
      write(dir, { 'app/x.py': 'def double(n):\n    return n * 2\n' });
      const res = await commitAll(dir, 'feature without test');
      assert.notStrictEqual(res.status, 0, `commit must be blocked:\n${res.output}`);
      assert.match(res.output, /No test evidence/, `blocked for the wrong reason:\n${res.output}`);
    } finally {
      teardown(dir);
    }
  });

  it('FastAPI: a user file in tools/ that is not in the registry is still evaluated', async () => {
    const dir = await createRepo(STACKS.FastAPI);
    try {
      await install(dir);
      await git(dir, 'add', '-A');
      await git(dir, 'commit', '-q', '--no-verify', '-m', 'install');
      write(dir, { 'tools/sync_users.py': 'def sync(session, ids):\n    for i in ids:\n        session.get(i)\n' });
      const res = await commitAll(dir, 'user tool');
      assert.notStrictEqual(res.status, 0, `commit must be blocked:\n${res.output}`);
      assert.match(res.output, /tools\/sync_users\.py/, `the user tool was not evaluated:\n${res.output}`);
    } finally {
      teardown(dir);
    }
  });

  it('install writes a sorted, hashed registry of the files it put in tools/', async () => {
    const dir = await createRepo(STACKS.FastAPI);
    try {
      await install(dir);
      const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
      const paths = registryPaths(registry);
      const onDisk = fs.readdirSync(path.join(dir, 'tools')).map((f) => `tools/${f}`).filter((p) => p !== REGISTRY).sort();
      assert.deepStrictEqual(paths.filter((p) => p.startsWith('tools/')), onDisk);
      assert.ok(registry.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
      assert.deepStrictEqual(paths, [...paths].sort());
    } finally {
      teardown(dir);
    }
  });
});

describe('frontend hook location follows the active hook manager', { concurrency: true }, () => {
  it('Astro without Husky: hook in .githooks/pre-commit and core.hooksPath=.githooks', async () => {
    const dir = await createRepo(STACKS.Astro);
    try {
      const output = await install(dir);
      assert.strictEqual(await git(dir, 'config', '--get', 'core.hooksPath'), '.githooks');
      assert.ok(fs.existsSync(path.join(dir, '.githooks', 'pre-commit')), '.githooks/pre-commit missing');
      assert.ok(!fs.existsSync(path.join(dir, '.husky', 'pre-commit')), 'no .husky hook without Husky');
      assert.match(output, /\.githooks\/pre-commit/, 'the summary must name the active hook');
      const hook = fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf-8');
      const syntax = spawnSync('sh', ['-n', path.join(dir, '.githooks', 'pre-commit')]);
      assert.strictEqual(syntax.status, 0, `hook is not valid sh:\n${hook}`);
    } finally {
      teardown(dir);
    }
  });

  it('Astro with core.hooksPath=.husky/_: hook in .husky/pre-commit, hooksPath untouched', async () => {
    const dir = await createRepo(STACKS.Astro, { hooksPath: '.husky/_' });
    try {
      const output = await install(dir);
      assert.strictEqual(await git(dir, 'config', '--get', 'core.hooksPath'), '.husky/_');
      assert.ok(fs.existsSync(path.join(dir, '.husky', 'pre-commit')), '.husky/pre-commit missing');
      assert.ok(!fs.existsSync(path.join(dir, '.githooks', 'pre-commit')), 'no .githooks hook under Husky');
      assert.match(output, /\.husky\/pre-commit/, 'the summary must name the active hook');
    } finally {
      teardown(dir);
    }
  });
});

describe('harness sources without a registry stay verified (this repository)', { concurrency: true }, () => {
  /** A repo shaped like this one: tools/ is source code, there is no registry. */
  async function toolsRepo() {
    const dir = await createRepo({
      'package.json': PACKAGE({ name: 'harness', private: true, scripts: { test: 'node --test' } }),
      'tools/verify_tdd.js': fs.readFileSync(path.join(ROOT, 'tools', 'verify_tdd.js'), 'utf-8'),
      'tools/_changes.js': fs.readFileSync(path.join(ROOT, 'tools', '_changes.js'), 'utf-8'),
      'tools/verify_tdd.py': fs.readFileSync(path.join(ROOT, 'tools', 'verify_tdd.py'), 'utf-8'),
      'tools/_changes.py': fs.readFileSync(path.join(ROOT, 'tools', '_changes.py'), 'utf-8'),
    });
    write(dir, {
      'tools/x.js': 'module.exports = (n) => n + 1;\n',
      'tools/x.py': 'def inc(n):\n    return n + 1\n',
    });
    await git(dir, 'add', '-A');
    return dir;
  }

  it('a tools/*.js change without a test is blocked by verify_tdd.js', async () => {
    const dir = await toolsRepo();
    try {
      const res = await run(process.execPath, ['tools/verify_tdd.js'], dir);
      assert.notStrictEqual(res.status, 0, res.output);
      assert.match(res.output, /No test evidence/);
      assert.match(res.output, /tools\/x\.js/);
    } finally {
      teardown(dir);
    }
  });

  it('a tools/*.py change without a test is blocked by verify_tdd.py', async () => {
    const dir = await toolsRepo();
    try {
      const res = await run('python3', ['tools/verify_tdd.py'], dir);
      assert.notStrictEqual(res.status, 0, res.output);
      assert.match(res.output, /No test evidence/);
      assert.match(res.output, /tools\/x\.py/);
    } finally {
      teardown(dir);
    }
  });

  it('the same change listed in a staged registry is excluded (JS and Python)', async () => {
    const dir = await toolsRepo();
    try {
      write(dir, { [REGISTRY]: `${JSON.stringify(['tools/x.js', 'tools/x.py', REGISTRY])}\n` });
      await git(dir, 'add', '-A');
      const js = await run(process.execPath, ['tools/verify_tdd.js'], dir);
      assert.strictEqual(js.status, 0, js.output);
      const py = await run('python3', ['tools/verify_tdd.py'], dir);
      assert.strictEqual(py.status, 0, py.output);
    } finally {
      teardown(dir);
    }
  });
});
