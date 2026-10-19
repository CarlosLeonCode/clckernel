/**
 * CLI UX invariants (sdds/cli-ux-fixes): no user input causes writes the user
 * did not explicitly ask for, and everything the CLI says about itself or the
 * project is true.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const { version } = require('../package.json');

// Isolate git from the developer's global/system config so hooksPath
// assertions only see what the test (and the CLI) wrote.
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function runCli(args, { cwd, env } = {}) {
  return spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf-8',
    cwd,
    timeout: 30000,
    env: { ...process.env, CI: '1', ...GIT_ENV, ...env },
  });
}

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } });
}

function initRepo(dir) {
  const res = git(dir, ['init', '-q']);
  assert.strictEqual(res.status, 0, `git init failed: ${res.stderr}`);
}

function hooksPath(dir) {
  return git(dir, ['config', '--get', 'core.hooksPath']).stdout.trim();
}

function listAll(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      out.push(path.relative(dir, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

describe('clckernel audit [dir]', () => {
  it('exits 1 without an installed orchestrator and does not create ./audit', () => {
    const dir = createTmpProject({ 'README.md': '# x\n' });
    try {
      const before = listAll(dir);
      const res = runCli(['audit'], { cwd: dir });
      assert.strictEqual(res.status, 1, res.stdout + res.stderr);
      assert.match(res.stderr, /no audit orchestrator/i, 'must explain what is missing');
      assert.match(res.stderr, /clckernel .* --yes/, 'must suggest how to install the harness');
      assert.ok(!fs.existsSync(path.join(dir, 'audit')), 'must not install into ./audit');
      assert.deepStrictEqual(listAll(dir), before, 'must not write anything');
    } finally {
      teardown(dir);
    }
  });

  it('exits 1 for an explicit dir without an orchestrator', () => {
    const dir = createTmpProject({});
    try {
      const res = runCli(['audit', dir], { cwd: dir });
      assert.strictEqual(res.status, 1, res.stdout + res.stderr);
      assert.match(res.stderr, /no audit orchestrator/i);
      assert.deepStrictEqual(listAll(dir), []);
    } finally {
      teardown(dir);
    }
  });

  it('runs tools/audit.js in the target dir and exits with its status', () => {
    const dir = createTmpProject({
      'tools/audit.js': "require('fs').writeFileSync('ran-here', process.cwd());\nprocess.exit(3);\n",
    });
    try {
      const res = runCli(['audit', dir], { cwd: path.dirname(dir) });
      assert.strictEqual(res.status, 3, res.stdout + res.stderr);
      assert.ok(fs.existsSync(path.join(dir, 'ran-here')), 'orchestrator must run with cwd = target dir');
    } finally {
      teardown(dir);
    }
  });

  it('exits 1 when the target dir does not exist', () => {
    const dir = createTmpProject({});
    try {
      const res = runCli(['audit', path.join(dir, 'missing')], { cwd: dir });
      assert.strictEqual(res.status, 1);
      assert.match(res.stderr, /does not exist/);
      assert.ok(!fs.existsSync(path.join(dir, 'missing')));
    } finally {
      teardown(dir);
    }
  });
});

describe('agent-only commands are rejected', () => {
  for (const word of ['test', 'start', 'feature', 'fix', 'commit', 'guard']) {
    it(`\`clckernel ${word}\` exits 1 with an agent-command message and writes nothing`, () => {
      const dir = createTmpProject({ 'package.json': '{}\n' });
      try {
        const before = listAll(dir);
        const res = runCli([word], { cwd: dir });
        assert.strictEqual(res.status, 1, res.stdout + res.stderr);
        assert.ok(
          res.stderr.includes(`\`${word}\` is an agent command defined in AGENTS.md, not a CLI command`),
          `unexpected stderr: ${res.stderr}`
        );
        assert.deepStrictEqual(listAll(dir), before);
      } finally {
        teardown(dir);
      }
    });
  }
});

describe('install target must exist', () => {
  it('`clckernel ./no-existe --yes` exits 1 and does not create the dir', () => {
    const dir = createTmpProject({});
    try {
      const res = runCli(['./no-existe', '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 1, res.stdout + res.stderr);
      assert.ok(!fs.existsSync(path.join(dir, 'no-existe')), 'must not create a mistyped dir');
      assert.match(res.stderr, /no-existe/);
    } finally {
      teardown(dir);
    }
  });

  it('rejects a target that is a file', () => {
    const dir = createTmpProject({ 'afile': 'x' });
    try {
      const res = runCli(['afile', '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 1, res.stdout + res.stderr);
      assert.match(res.stderr, /Target is not a directory/);
      assert.deepStrictEqual(listAll(dir), ['afile']);
    } finally {
      teardown(dir);
    }
  });

  it('shows the absolute target path in the confirmation box', () => {
    const dir = createTmpProject({ 'pom.xml': '<project/>\n' });
    try {
      const res = runCli(['.', '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      assert.ok(res.stdout.includes(path.resolve(dir)), 'box must show the absolute target path');
    } finally {
      teardown(dir);
    }
  });
});

describe('--help is honest', () => {
  function section(text, headerRe) {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => headerRe.test(l) && !/^\s/.test(l));
    assert.ok(start >= 0, `no section matching ${headerRe}`);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => l.trim() && !/^\s/.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).join('\n');
  }

  it('does not list update as read-only, and lists audit as read-only', () => {
    const res = runCli(['--help']);
    assert.strictEqual(res.status, 0);
    const readOnly = section(res.stdout, /read-only/i);
    assert.ok(!/^\s+update\b/m.test(readOnly), `update listed as read-only:\n${readOnly}`);
    assert.ok(/^\s+audit\b/m.test(readOnly), 'audit must be listed as read-only');
    const writes = section(res.stdout, /writes to the target project/i);
    assert.ok(/^\s+update\b/m.test(writes), 'update must be listed under writes');
  });
});

describe('core.hooksPath is only set when safe', () => {
  it('leaves an existing hook manager (core.hooksPath=.husky/_) untouched', () => {
    const dir = createTmpProject({ 'pom.xml': '<project/>\n' });
    try {
      initRepo(dir);
      git(dir, ['config', 'core.hooksPath', '.husky/_']);
      const res = runCli([dir, '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      assert.strictEqual(hooksPath(dir), '.husky/_');
      assert.match(res.stdout + res.stderr, /git .*config core\.hooksPath/, 'must print the manual command');
    } finally {
      teardown(dir);
    }
  });

  it('does not set hooksPath when the target is a subdirectory of a repo', () => {
    const dir = createTmpProject({ 'pkg/pom.xml': '<project/>\n' });
    try {
      initRepo(dir);
      const res = runCli([path.join(dir, 'pkg'), '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      assert.strictEqual(hooksPath(dir), '', 'parent repo hooksPath must stay unset');
      assert.match(res.stdout + res.stderr, /git .*config core\.hooksPath/);
    } finally {
      teardown(dir);
    }
  });

  it('sets hooksPath to .githooks in a clean repo root', () => {
    const dir = createTmpProject({ 'pom.xml': '<project/>\n' });
    try {
      initRepo(dir);
      const res = runCli([dir, '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      assert.strictEqual(hooksPath(dir), '.githooks');
    } finally {
      teardown(dir);
    }
  });
});

describe('doctor', () => {
  it("parses Python guards in a path containing a single quote", () => {
    const base = createTmpProject({});
    const dir = path.join(base, "it's $(here)");
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tools', 'check_ok.py'), 'def check():\n    return True\n');
    try {
      const res = runCli(['doctor', dir], { cwd: base });
      const line = res.stdout.split('\n').find((l) => l.includes('tool/check_ok.py parses'));
      assert.ok(line, res.stdout);
      assert.ok(line.includes('[PASS]'), `expected PASS: ${line}`);
    } finally {
      teardown(base);
    }
  });

  it('exits 1 when a Python guard is broken', () => {
    const dir = createTmpProject({
      'AGENTS.md': '# AGENTS\n',
      'sdds/.gitkeep': '',
      'docs/Journal/001.md': '# ADR\n',
      'tools/check_broken.py': 'def check(:\n',
      '.githooks/pre-commit': '#!/usr/bin/env bash\n',
    });
    try {
      const res = runCli(['doctor', dir], { cwd: dir });
      assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    } finally {
      teardown(dir);
    }
  });
});

describe('project without stack signals (pom.xml only)', () => {
  it('installs a generic harness: JS secret scan in .githooks, no FastAPI', () => {
    const dir = createTmpProject({ 'pom.xml': '<project/>\n' });
    try {
      const res = runCli([dir, '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      const out = res.stdout;
      assert.match(out, /UNKNOWN/, 'detected type must be unknown');

      const hook = fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf-8');
      // sdds/unified-discovery: audit.js runs scan_secrets.js; the audit.py
      // line only runs when tools/audit.py exists, which a generic install lacks.
      assert.ok(hook.split('\n').includes('if [ -f tools/audit.js ]; then node tools/audit.js --hook; fi'), hook);
      const kernelLines = hook.split('\n').filter((l) => !l.startsWith('if [ -f tools/audit.py ]') && !l.startsWith('[ -f tools/audit.js ] ||'));
      assert.ok(!kernelLines.join('\n').includes('python'), 'generic hook must not require Python');
      assert.ok(hook.split('\n').includes('set -e'));
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'scan_secrets.js')));
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'audit.js')));
      assert.ok(!fs.readdirSync(path.join(dir, 'tools')).some((f) => f.endsWith('.py')), 'no Python tools');

      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.ok(!agents.includes('FastAPI'), 'AGENTS.md must not mention FastAPI');
      assert.ok(!agents.includes('Python AST'), 'AGENTS.md must not claim Python guards');
      assert.ok(agents.includes('Generic'), 'AGENTS.md must be the Generic template');

      assert.ok(!out.includes('7 Guardias Backend'), 'success card must not use a fixed text');
      assert.ok(out.includes('scan_secrets'), 'success card must list the installed guards');
    } finally {
      teardown(dir);
    }
  });
});

describe('banner', () => {
  it('shows the version from package.json', () => {
    const dir = createTmpProject({ 'pom.xml': '<project/>\n' });
    try {
      const res = runCli([dir, '--yes'], { cwd: dir });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      assert.ok(res.stdout.includes(`v${version}`), `banner must show v${version}`);
    } finally {
      teardown(dir);
    }
  });
});
