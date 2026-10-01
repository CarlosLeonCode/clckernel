const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

/**
 * Snapshot every tracked-looking file in a directory, so a test can assert that
 * a CLI invocation left the project byte-identical.
 */
function snapshot(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out[path.relative(dir, full)] = fs.readFileSync(full, 'utf-8');
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Invokes the CLI against an empty temp project. Never throws: a non-zero exit is
 * an expected outcome for most of these cases.
 */
function runCli(args, { cwd, env } = {}) {
  return spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf-8',
    cwd,
    timeout: 20000,
    env: { ...process.env, ...env },
  });
}

describe('runCli() read-only commands', () => {
  for (const flag of ['--help', '-h', 'help']) {
    it(`\`${flag}\` prints help, exits 0 and writes nothing`, () => {
      const dir = createTmpProject({ 'package.json': '{}\n' });
      try {
        const before = snapshot(dir);
        const res = runCli([flag], { cwd: dir });

        assert.strictEqual(res.status, 0, `${flag} must exit 0`);
        assert.ok(res.stdout.includes('clckernel'), `${flag} must mention the CLI`);
        assert.deepStrictEqual(snapshot(dir), before, `${flag} must not write to the project`);
      } finally {
        teardown(dir);
      }
    });
  }

  for (const flag of ['--version', '-v']) {
    it(`\`${flag}\` prints the version, exits 0 and writes nothing`, () => {
      const dir = createTmpProject({ 'package.json': '{}\n' });
      try {
        const before = snapshot(dir);
        const res = runCli([flag], { cwd: dir });

        assert.strictEqual(res.status, 0, `${flag} must exit 0`);
        assert.match(res.stdout, /\d+\.\d+\.\d+/, `${flag} must print a semver version`);
        assert.deepStrictEqual(snapshot(dir), before, `${flag} must not write to the project`);
      } finally {
        teardown(dir);
      }
    });
  }

  it('help output is not a banner-only install banner', () => {
    const dir = createTmpProject({ 'package.json': '{}\n' });
    try {
      const res = runCli(['--help'], { cwd: dir });
      assert.ok(
        !res.stdout.includes('Salvaguardas y motor de gobernanza configurados'),
        'help must not report a completed installation'
      );
      assert.ok(
        !res.stdout.includes('CONFIGURACIÓN DETECTADA AUTOMÁTICAMENTE'),
        'help must not run stack auto-detection'
      );
    } finally {
      teardown(dir);
    }
  });
});

describe('runCli() rejects unknown input without side effects', () => {
  const unknownInputs = [
    ['--unknown-flag'],
    ['--dry-run'],
    ['--list-guards'],
    ['--force'],
    ['start'],
    ['feature'],
  ];

  for (const args of unknownInputs) {
    it(`\`${args.join(' ')}\` exits non-zero and writes nothing`, () => {
      const dir = createTmpProject({ 'package.json': '{}\n' });
      try {
        const before = snapshot(dir);
        const res = runCli(args, { cwd: dir });

        assert.notStrictEqual(res.status, 0, `${args.join(' ')} must not exit 0`);
        assert.deepStrictEqual(
          snapshot(dir),
          before,
          `${args.join(' ')} must not write to the project`
        );
      } finally {
        teardown(dir);
      }
    });
  }

  it('no arguments in a non-TTY context does not install silently', () => {
    const dir = createTmpProject({ 'package.json': '{}\n' });
    try {
      const before = snapshot(dir);
      const res = runCli([], { cwd: dir, env: { CI: '1' } });

      assert.notStrictEqual(res.status, 0, 'bare invocation must not exit 0 in CI');
      assert.deepStrictEqual(
        snapshot(dir),
        before,
        'bare invocation must not install without an explicit command'
      );
    } finally {
      teardown(dir);
    }
  });

  it('reports the unknown input on stderr so the user knows what to do', () => {
    const dir = createTmpProject({ 'package.json': '{}\n' });
    try {
      const res = runCli(['--unknown-flag'], { cwd: dir });
      const output = res.stdout + res.stderr;
      assert.ok(output.includes('--unknown-flag'), 'must echo the rejected input');
      assert.ok(/help/i.test(output), 'must point the user at help');
    } finally {
      teardown(dir);
    }
  });
});

describe('runCli() preserves existing explicit commands', () => {
  it('doctor still runs and exits 0', () => {
    const dir = createTmpProject({
      'package.json': '{}\n',
      'AGENTS.md': '# AGENTS\n',
      'sdds/.gitkeep': '',
      'docs/Journal/001-adr.md': '# ADR\n',
      'tools/audit.js': 'module.exports = {};\n',
      'tools/check_scan.js': 'module.exports = function() {}\n',
      '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
    });
    try {
      const res = runCli(['doctor', dir], { cwd: dir });
      assert.strictEqual(res.status, 0, 'doctor must still exit 0');
      assert.ok(res.stdout.includes('HEALTHY'), 'doctor must still report health');
    } finally {
      teardown(dir);
    }
  });

  it('update still refreshes the harness', () => {
    const dir = createTmpProject({
      'package.json': '{}\n',
      'AGENTS.md': '# AGENTS\n',
      'tools/audit.js': '// outdated audit\n',
    });
    try {
      const res = runCli(['update', dir], { cwd: dir });
      assert.strictEqual(res.status, 0, 'update must still exit 0');
      const audit = fs.readFileSync(path.join(dir, 'tools', 'audit.js'), 'utf-8');
      assert.ok(!audit.includes('outdated audit'), 'update must still refresh tools');
    } finally {
      teardown(dir);
    }
  });

  it('update still preserves a customized AGENTS.md', () => {
    const custom = '# Mi Ley\n- Regla propia\n';
    const dir = createTmpProject({ 'package.json': '{}\n', 'AGENTS.md': custom });
    try {
      runCli(['update', dir], { cwd: dir });
      assert.strictEqual(
        fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8'),
        custom,
        'update must remain non-destructive for AGENTS.md'
      );
    } finally {
      teardown(dir);
    }
  });
});

describe('runCli() install path still requires an explicit opt-in', () => {
  it('installs when the user explicitly confirms on a TTY-less run with --yes', () => {
    const dir = createTmpProject({ 'package.json': '{}\n' });
    try {
      const before = snapshot(dir);
      const res = runCli(['--yes'], { cwd: dir, env: { CI: '1' } });

      assert.strictEqual(res.status, 0, 'explicit opt-in must exit 0');
      assert.notDeepStrictEqual(
        Object.keys(snapshot(dir)).filter((f) => !f.startsWith('package.json')),
        Object.keys(before).filter((f) => !f.startsWith('package.json')),
        'explicit opt-in must actually install'
      );
    } finally {
      teardown(dir);
    }
  });

  it('refuses an unknown flag even when combined with --yes', () => {
    const dir = createTmpProject({ 'package.json': '{}\n' });
    try {
      const before = snapshot(dir);
      const res = runCli(['--yes', '--bogus'], { cwd: dir, env: { CI: '1' } });

      assert.notStrictEqual(res.status, 0, 'unknown flag must not be accepted');
      assert.deepStrictEqual(snapshot(dir), before, 'unknown flag must not install');
    } finally {
      teardown(dir);
    }
  });
});
