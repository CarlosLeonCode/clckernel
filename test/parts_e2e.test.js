/**
 * sdds/fullstack-monorepo (TDD plan item 6): in the three multi-part fixtures
 * of the spec, `clckernel --yes` + `git add -A` + a real `git commit` (never
 * --no-verify) passes and the hook really ran. Scenarios run concurrently.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const HOOK_MARKER = 'Running CLC Kernel';
const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;
const NEXT_PKG = PACKAGE({ name: 'web', private: true, dependencies: { next: '^14.0.0' } });

function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', CI: '1' };
}

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

async function createRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-parts-e2e-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  await git(dir, 'init', '-q');
  await git(dir, 'config', 'user.name', 'Parts E2E');
  await git(dir, 'config', 'user.email', 'parts-e2e@example.com');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '--no-verify', '-m', 'project');
  return dir;
}

const FIXTURES = {
  'Next.js root + backend/ FastAPI': {
    files: { 'package.json': NEXT_PKG, 'backend/requirements.txt': 'fastapi\n', 'backend/app/__init__.py': '' },
    parts: ['.', 'backend'],
  },
  'Next.js + FastAPI in the same root': {
    files: { 'package.json': NEXT_PKG, 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' },
    parts: ['.'],
  },
  'workspaces monorepo apps/web + apps/api': {
    files: {
      'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['apps/*'] }),
      'apps/web/package.json': NEXT_PKG,
      'apps/api/requirements.txt': 'fastapi\n',
      'apps/api/app/__init__.py': '',
    },
    parts: ['apps/api', 'apps/web'],
  },
};

describe('multi-part install commit passes through the real hook', { concurrency: true }, () => {
  for (const [name, { files, parts }] of Object.entries(FIXTURES)) {
    it(`${name}: clckernel --yes, git add -A, git commit -> exit 0 and the hook ran`, async () => {
      const dir = await createRepo(files);
      try {
        const install = await run(process.execPath, [CLI, dir, '--yes'], dir);
        assert.strictEqual(install.status, 0, `install failed:\n${install.output}`);
        assert.match(install.output, /FastAPI Framework/, 'the confirmation box lists the parts');
        for (const part of parts) assert.ok(install.output.includes(part), `part ${part} not listed:\n${install.output}`);

        await git(dir, 'add', '-A');
        const res = await run('git', ['commit', '-m', 'install'], dir);
        assert.strictEqual(res.status, 0, `install commit failed:\n${res.output}`);
        assert.ok(res.output.includes(HOOK_MARKER), `the hook did not run:\n${res.output}`);
        // sdds/unified-discovery: the hook calls both orchestrators, which
        // run verify_tdd.js and verify_tdd.py once each.
        const hook = fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf-8');
        assert.ok(hook.includes('node tools/audit.js --hook') && hook.includes('python3 tools/audit.py --hook'), hook);
        assert.ok(fs.existsSync(path.join(dir, 'tools', 'verify_tdd.js')) && fs.existsSync(path.join(dir, 'tools', 'verify_tdd.py')));
        assert.strictEqual((res.output.match(/^clckernel: \S+\s+verify_tdd:/gm) || []).length, 2, res.output);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
