/**
 * Retirement of the old "clc-forge" name (sdds/clc-forge-sunset).
 *
 * Invariant: a fresh install creates no artifact under the old name, and an
 * existing project keeps working (old names are read with a deprecation
 * warning; update removes old artifacts only when they are provably ours).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');

const ROOT = path.join(__dirname, '..');
const BUNDLED_SKILL = path.join(ROOT, '.agents', 'skills', 'clckernel_cli');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const TOOLS = path.join(ROOT, 'tools');

const LEGACY_SKILL_REL = path.join('.agents', 'skills', 'clc_forge_cli');
const LEGACY_MDC_REL = path.join('.cursor', 'rules', 'clc_forge_context.mdc');
const LEGACY_JSON_REL = '.clc-forge.resolved.json';

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Recreate the three artifacts the previous version wrote into a project. */
function plantLegacyArtifacts(dir) {
  fs.cpSync(BUNDLED_SKILL, path.join(dir, LEGACY_SKILL_REL), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor', 'rules'), { recursive: true });
  fs.symlinkSync(path.join('..', '..', 'AGENTS.md'), path.join(dir, LEGACY_MDC_REL));
  fs.writeFileSync(path.join(dir, LEGACY_JSON_REL), '{}\n');
}

// ── 1. Install ─────────────────────────────────────────────────────────

describe('clc-forge sunset — install writes no legacy artifact', () => {
  it('adapter install creates no clc_forge_cli/, clc_forge_context.mdc or .clc-forge.resolved.json', () => {
    const dir = createTmpProject({ 'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }) });
    try {
      const { autoDetectStack } = require('../src/detector');
      generateHarness(dir, autoDetectStack(dir));
      assert.ok(exists(path.join(dir, '.agents', 'skills', 'clckernel_cli', 'SKILL.md')), 'canonical skill installed');
      assert.ok(exists(path.join(dir, '.cursor', 'rules', 'clckernel_context.mdc')), 'canonical Cursor rule installed');
      assert.strictEqual(exists(path.join(dir, LEGACY_SKILL_REL)), false, 'no clc_forge_cli/');
      assert.strictEqual(exists(path.join(dir, LEGACY_MDC_REL)), false, 'no clc_forge_context.mdc');
    } finally {
      teardown(dir);
    }
  });

  // sdds/config-foundation: the config-driven metadata path is gone; install
  // reads .clckernel.yaml itself and writes no resolved copy of it.
  it('install with a config writes no .clckernel.resolved.json nor its legacy copy', () => {
    const dir = createTmpProject({ '.clckernel.yaml': 'exclude_paths:\n  - "vendor/**"\n' });
    try {
      generateHarness(dir, null);
      assert.strictEqual(exists(path.join(dir, '.clckernel.resolved.json')), false);
      assert.strictEqual(exists(path.join(dir, LEGACY_JSON_REL)), false);
    } finally {
      teardown(dir);
    }
  });
});

// ── 2. Update cleanup ──────────────────────────────────────────────────

describe('clc-forge sunset — update removes legacy artifacts only when provably ours', () => {
  it('removes the three generated artifacts and lists each removal', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n' });
    try {
      plantLegacyArtifacts(dir);
      const result = updateHarness(dir);
      assert.strictEqual(exists(path.join(dir, LEGACY_SKILL_REL)), false, 'clc_forge_cli/ removed');
      assert.strictEqual(exists(path.join(dir, LEGACY_MDC_REL)), false, 'clc_forge_context.mdc removed');
      assert.strictEqual(exists(path.join(dir, LEGACY_JSON_REL)), false, '.clc-forge.resolved.json removed');
      assert.ok(result.legacyCleanup, 'result reports the legacy cleanup');
      assert.deepStrictEqual(
        [...result.legacyCleanup.removed].sort(),
        ['.agents/skills/clc_forge_cli/', '.clc-forge.resolved.json', '.cursor/rules/clc_forge_context.mdc']
      );
      assert.deepStrictEqual(result.legacyCleanup.kept, []);
    } finally {
      teardown(dir);
    }
  });

  it('removes a legacy skill that matches the previously installed clckernel_cli byte for byte', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n' });
    try {
      // An older release: both skill dirs carry the same (now outdated) playbook.
      for (const skill of ['clckernel_cli', 'clc_forge_cli']) {
        const base = path.join(dir, '.agents', 'skills', skill);
        fs.cpSync(BUNDLED_SKILL, base, { recursive: true });
        fs.writeFileSync(path.join(base, 'reference', 'audit.md'), '# audit (older release)\n');
      }
      const result = updateHarness(dir);
      assert.strictEqual(exists(path.join(dir, LEGACY_SKILL_REL)), false);
      assert.ok(result.legacyCleanup.removed.includes('.agents/skills/clc_forge_cli/'));
    } finally {
      teardown(dir);
    }
  });

  it('keeps a modified clc_forge_cli/SKILL.md and warns', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n' });
    try {
      plantLegacyArtifacts(dir);
      fs.appendFileSync(path.join(dir, LEGACY_SKILL_REL, 'SKILL.md'), '\nMy team notes.\n');
      const result = updateHarness(dir);
      assert.ok(exists(path.join(dir, LEGACY_SKILL_REL, 'SKILL.md')), 'modified legacy skill kept');
      assert.match(fs.readFileSync(path.join(dir, LEGACY_SKILL_REL, 'SKILL.md'), 'utf-8'), /My team notes/);
      const kept = result.legacyCleanup.kept.find((k) => k.path === '.agents/skills/clc_forge_cli/');
      assert.ok(kept, 'kept entry reported');
      assert.match(kept.reason, /SKILL\.md/);
      assert.ok(!result.legacyCleanup.removed.includes('.agents/skills/clc_forge_cli/'));
    } finally {
      teardown(dir);
    }
  });

  it('keeps a legacy skill dir with an unknown extra file and warns', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n' });
    try {
      plantLegacyArtifacts(dir);
      fs.writeFileSync(path.join(dir, LEGACY_SKILL_REL, 'reference', 'ours.md'), '# team playbook\n');
      const result = updateHarness(dir);
      assert.ok(exists(path.join(dir, LEGACY_SKILL_REL, 'reference', 'ours.md')));
      assert.ok(result.legacyCleanup.kept.some((k) => k.path === '.agents/skills/clc_forge_cli/'));
    } finally {
      teardown(dir);
    }
  });

  it('keeps a clc_forge_context.mdc that is a regular file', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n', '.cursor/rules/clc_forge_context.mdc': '# my own rules\n' });
    try {
      const result = updateHarness(dir);
      const mdc = path.join(dir, LEGACY_MDC_REL);
      assert.ok(fs.lstatSync(mdc).isFile(), 'regular file left in place');
      assert.strictEqual(fs.readFileSync(mdc, 'utf-8'), '# my own rules\n');
      assert.ok(result.legacyCleanup.kept.some((k) => k.path === '.cursor/rules/clc_forge_context.mdc'));
    } finally {
      teardown(dir);
    }
  });

  it('keeps a clc_forge_context.mdc symlink that points somewhere other than AGENTS.md', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n', 'docs/rules.md': '# rules\n' });
    try {
      fs.mkdirSync(path.join(dir, '.cursor', 'rules'), { recursive: true });
      fs.symlinkSync(path.join('..', '..', 'docs', 'rules.md'), path.join(dir, LEGACY_MDC_REL));
      updateHarness(dir);
      assert.ok(fs.lstatSync(path.join(dir, LEGACY_MDC_REL)).isSymbolicLink());
    } finally {
      teardown(dir);
    }
  });

  it('reports nothing when no legacy artifact exists', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n' });
    try {
      const result = updateHarness(dir);
      assert.deepStrictEqual(result.legacyCleanup, { removed: [], kept: [] });
    } finally {
      teardown(dir);
    }
  });

  it('detects a config under any of the four supported names', () => {
    for (const name of ['.clckernel.yaml', '.clckernel.yml', '.clc-forge.yaml', '.clc-forge.yml']) {
      const dir = createTmpProject({ 'AGENTS.md': '# AGENTS\n', [name]: 'rules: []\n' });
      try {
        assert.strictEqual(updateHarness(dir).preserved.configYaml, true, name);
      } finally {
        teardown(dir);
      }
    }
  });
});

// ── 3. check_custom config lookup (JS and Python parity) ────────────────

const RUNNERS = {
  js: (dir) => spawnSync(process.execPath, [path.join(TOOLS, 'check_custom.js'), dir], { cwd: dir, encoding: 'utf-8' }),
  py: (dir) => spawnSync('python3', [path.join(TOOLS, 'check_custom.py'), dir], { cwd: dir, encoding: 'utf-8' }),
};

function makeRepo(files) {
  const dir = createTmpProject({ 'src/app.js': 'module.exports = 1;\n', ...files });
  const git = (...args) => spawnSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'debugger;\n');
  git('add', 'src/app.js');
  return dir;
}

const RULE = (name) => `rules:\n  - name: ${name}\n    pattern: 'debugger'\n    message: m\n`;

function runCheck(lang, dir) {
  const res = RUNNERS[lang](dir);
  const parsed = JSON.parse(res.stdout);
  return { res, parsed, exitCode: parsed.exitCode !== undefined ? parsed.exitCode : parsed.exit_code };
}

function rulesHit(parsed) {
  return Object.values(parsed.data.violations).flat().map((v) => v.rule);
}

for (const lang of Object.keys(RUNNERS)) {
  describe(`clc-forge sunset — check_custom.${lang} config lookup`, () => {
    it('with only .clc-forge.yml it applies the rules and reports the deprecation warning', () => {
      const dir = makeRepo({ '.clc-forge.yml': RULE('legacy-rule') });
      try {
        const { parsed, exitCode } = runCheck(lang, dir);
        assert.strictEqual(exitCode, 1, parsed.data.message);
        assert.deepStrictEqual(rulesHit(parsed), ['legacy-rule']);
        assert.ok(Array.isArray(parsed.data.warnings), 'data.warnings present');
        assert.ok(
          parsed.data.warnings.some((w) => /deprecated config name, rename to \.clckernel\.yaml/.test(w) && w.includes('.clc-forge.yml')),
          JSON.stringify(parsed.data.warnings)
        );
      } finally {
        teardown(dir);
      }
    });

    it('with .clckernel.yaml and .clc-forge.yml it uses .clckernel.yaml and warns nothing', () => {
      const dir = makeRepo({ '.clckernel.yaml': RULE('kernel-rule'), '.clc-forge.yml': RULE('legacy-rule') });
      try {
        const { parsed } = runCheck(lang, dir);
        assert.deepStrictEqual(rulesHit(parsed), ['kernel-rule']);
        assert.deepStrictEqual(parsed.data.warnings || [], []);
      } finally {
        teardown(dir);
      }
    });

    it('prefers .clckernel.yaml over .clckernel.yml', () => {
      const dir = makeRepo({ '.clckernel.yaml': RULE('yaml-rule'), '.clckernel.yml': RULE('yml-rule') });
      try {
        assert.deepStrictEqual(rulesHit(runCheck(lang, dir).parsed), ['yaml-rule']);
      } finally {
        teardown(dir);
      }
    });

    it('prefers .clc-forge.yaml over .clc-forge.yml', () => {
      const dir = makeRepo({ '.clc-forge.yaml': RULE('forge-yaml'), '.clc-forge.yml': RULE('forge-yml') });
      try {
        assert.deepStrictEqual(rulesHit(runCheck(lang, dir).parsed), ['forge-yaml']);
      } finally {
        teardown(dir);
      }
    });

    it('with no config the message names .clckernel.yaml', () => {
      const dir = makeRepo({});
      try {
        const { parsed } = runCheck(lang, dir);
        assert.strictEqual(parsed.skipped, true);
        assert.match(parsed.data.message, /\.clckernel\.yaml/);
        assert.doesNotMatch(parsed.data.message, /clc-forge|\.clckernel\.yml\b/);
      } finally {
        teardown(dir);
      }
    });
  });
}

describe('clc-forge sunset — config error names the canonical file', () => {
  it('ConfigError message says .clckernel.yaml', () => {
    const { validateConfig } = require('../src/config');
    assert.throws(() => validateConfig({ tdd: { code: 'nope' } }), (err) => /Invalid \.clckernel\.yaml:/.test(err.message));
  });
});

// ── 5. Legacy binaries ─────────────────────────────────────────────────

describe('clc-forge sunset — legacy binary names', () => {
  const pkg = require('../package.json');
  const { version } = pkg;
  const DEPRECATION = '"clc-forge" is deprecated; use "clckernel"';

  /** Run a bin the way npm links it: a symlink named `name` to the file package.json maps it to. */
  function runVia(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-bin-'));
    try {
      const link = path.join(dir, name);
      fs.symlinkSync(path.join(ROOT, pkg.bin[name]), link);
      return spawnSync(process.execPath, [link, '--version'], { encoding: 'utf-8' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The bin `npx clckernel` runs, as libnpmexec's get-bin-from-manifest picks it:
   * when every bin points to the same file it takes the FIRST key, otherwise the
   * one named like the package. The registry stores the bin keys sorted, so the
   * first key is "clc-forge" whenever all bins share a file.
   */
  function binNpxRuns(manifest) {
    const sorted = Object.fromEntries(Object.entries(manifest.bin).sort(([a], [b]) => a.localeCompare(b)));
    if (new Set(Object.values(sorted)).size === 1) return Object.keys(sorted)[0];
    return sorted[manifest.name] ? manifest.name : null;
  }

  it('npx clckernel runs the clckernel bin and prints no deprecation', () => {
    const name = binNpxRuns(pkg);
    assert.strictEqual(name, 'clckernel');
    const res = runVia(name);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stderr, '');
  });

  for (const name of ['clc-forge', 'create-clc-forge']) {
    it(`${name} prints the deprecation to stderr and behaves the same`, () => {
      const res = runVia(name);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout, `clckernel v${version}\n`);
      assert.ok(res.stderr.includes(DEPRECATION), res.stderr);
    });
  }

  for (const name of ['clckernel', 'clc-kernel', 'create-clckernel']) {
    it(`${name} prints no deprecation`, () => {
      const res = runVia(name);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout, `clckernel v${version}\n`);
      assert.strictEqual(res.stderr, '');
    });
  }
});

// ── 7. This repo ───────────────────────────────────────────────────────

describe('clc-forge sunset — this repository', () => {
  it('ships no .agents/skills/clc_forge_cli/ copy', () => {
    assert.strictEqual(exists(path.join(ROOT, LEGACY_SKILL_REL)), false);
  });

  it('src/, tools/ and bin/ carry no "CLC Forge" header or comment', () => {
    const offenders = [];
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__pycache__') walk(full); continue; }
        if (!/\.(js|py|sh|md)$/.test(entry.name)) continue;
        fs.readFileSync(full, 'utf-8').split('\n').forEach((line, i) => {
          if (/CLC Forge/i.test(line)) offenders.push(`${path.relative(ROOT, full)}:${i + 1}`);
        });
      }
    };
    ['src', 'tools', 'bin'].forEach((d) => walk(path.join(ROOT, d)));
    assert.deepStrictEqual(offenders, []);
  });

  it('only CLCKERNEL_SEVERITIES is documented; legacy spellings appear only where they are read', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf-8');
    const commentLines = text.split('\n').filter((l) => /^\s*(\*|\/\/|\/\*)/.test(l));
    assert.deepStrictEqual(commentLines.filter((l) => /CLC_FORGE_SEVERITIES|CLC_KERNEL_SEVERITIES/.test(l)), []);
  });
});
