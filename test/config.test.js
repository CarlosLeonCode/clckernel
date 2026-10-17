/**
 * CLC Forge — Config tests for the extracted zero-dependency YAML parser.
 * Covers: parser reuse (tools/yaml.js), unsupported anchor/alias syntax,
 * existing custom-rules behavior via tools/check_custom.js subprocess,
 * and `./yaml.js` resolution from a generated-style layout.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');

const { parseYaml } = require('../tools/yaml.js');

const {
  loadConfig,
  validateConfig,
  resolveConfig,
  ConfigError,
  HARNESS_PHASES,
  ENV_SEVERITIES,
} = require('../src/config.js');
const { generateHarness } = require('../src/generator.js');

const CHECK_CUSTOM = path.join(__dirname, '..', 'tools', 'check_custom.js');

const VALID_CONFIG = `rules:
  - name: no-debugger
    pattern: 'debugger'
    message: 'No debugger statements'
    severity: error
    scope: '**/*.js'
    meta: {owner: team, tier: 1}
  - name: no-todo
    pattern: 'TODO'
    message: 'No TODOs'
    severity: warning
    exclude: ['**/docs/**']
`;

const EXPECTED_CONFIG = {
  rules: [
    {
      name: 'no-debugger',
      pattern: 'debugger',
      message: 'No debugger statements',
      severity: 'error',
      scope: '**/*.js',
      meta: { owner: 'team', tier: 1 },
    },
    {
      name: 'no-todo',
      pattern: 'TODO',
      message: 'No TODOs',
      severity: 'warning',
      exclude: ['**/docs/**'],
    },
  ],
};

/**
 * Run tools/check_custom.js (or a copy at the given path) against a
 * target directory. Resolves with { parsed, exitCode }.
 * @param {string} script - Absolute path to check_custom.js
 * @param {string} targetDir - Directory to scan
 * @returns {Promise<{parsed: object, exitCode: number}>}
 */
function runCheckCustom(script, targetDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [script, targetDir], { cwd: targetDir });
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.on('close', (code) => {
      try {
        resolve({ parsed: JSON.parse(stdout), exitCode: code });
      } catch {
        reject(new Error(`Failed to parse output: ${stdout}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Initialize a git repo with an initial commit, so
 * `git diff --name-only HEAD~1` fails and check_custom
 * falls back to `git diff --name-only --cached`.
 * @param {string} dir - Target directory
 */
function initGitRepo(dir) {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });
}

describe('config: tools/yaml.js parser reuse', () => {
  it('parses a valid .clc-forge.yml with scalars, block sequence, flow mapping', () => {
    assert.deepStrictEqual(parseYaml(VALID_CONFIG), EXPECTED_CONFIG);
  });

  it('parses quoted and unquoted scalars into their typed values', () => {
    const cfg = 'enabled: true\ncount: 42\nratio: 1.5\nnothing: null\n';
    assert.deepStrictEqual(parseYaml(cfg), {
      enabled: true,
      count: 42,
      ratio: 1.5,
      nothing: null,
    });
  });

  it('strips comments and skips blank lines', () => {
    const cfg = '# top comment\nkey: value # trailing\n\nother: x\n';
    assert.deepStrictEqual(parseYaml(cfg), { key: 'value', other: 'x' });
  });
});

describe('config: unsupported YAML syntax', () => {
  it('throws on anchor syntax (&name)', () => {
    assert.throws(
      () => parseYaml('defaults: &defaults\n  a: 1\n'),
      /Unsupported YAML syntax at line 1: anchors\/aliases are not supported/
    );
  });

  it('throws on alias syntax (*name)', () => {
    assert.throws(
      () => parseYaml('db: *defaults\n'),
      /Unsupported YAML syntax at line 1: anchors\/aliases are not supported/
    );
  });

  it('throws on anchor inside a sequence item', () => {
    assert.throws(
      () => parseYaml('rules:\n  - &item name: x\n'),
      /Unsupported YAML syntax at line 2: anchors\/aliases are not supported/
    );
  });

  it('reports the exact line number for nested content', () => {
    assert.throws(
      () => parseYaml('rules:\n  - name: a\n    template: &tpl shared\n'),
      /Unsupported YAML syntax at line 3/
    );
  });

  it('does not false-positive on regex patterns or globs', () => {
    const cfg = `rules:
  - name: r
    pattern: 'a*b'
    message: 'm'
    scope: '**/*.js'
    exclude: ['**/docs/**', '*.min.js']
`;
    assert.deepStrictEqual(parseYaml(cfg), {
      rules: [
        {
          name: 'r',
          pattern: 'a*b',
          message: 'm',
          scope: '**/*.js',
          exclude: ['**/docs/**', '*.min.js'],
        },
      ],
    });
  });
});

describe('config: check_custom behavior preserved (subprocess)', () => {
  it('produces the same output shape (name, exitCode, skipped, data)', async () => {
    const dir = createTmpProject({
      '.clc-forge.yml': VALID_CONFIG,
      'src/app.js': 'module.exports = 1;\n',
    });
    initGitRepo(dir);

    try {
      // Introduce a violation, then stage it so check_custom's
      // fallback diff (`git diff --name-only --cached`) sees it.
      fs.writeFileSync(path.join(dir, 'src/app.js'), 'debugger;\nmodule.exports = 1;\n');
      spawnSync('git', ['add', 'src/app.js'], { cwd: dir });

      const { parsed, exitCode } = await runCheckCustom(CHECK_CUSTOM, dir);

      assert.strictEqual(parsed.name, 'check_custom');
      assert.strictEqual(parsed.skipped, false);
      assert.strictEqual(parsed.exitCode, 1);
      assert.strictEqual(exitCode, 1);
      assert.ok(parsed.data, 'data key present');
      assert.ok(parsed.data.violations, 'violations key present');
      assert.strictEqual(parsed.data.violations['src/app.js'].length, 1);
      assert.strictEqual(parsed.data.violations['src/app.js'][0].rule, 'no-debugger');
      assert.strictEqual(
        parsed.data.violations['src/app.js'][0].message,
        'No debugger statements'
      );
      assert.strictEqual(parsed.data.violations['src/app.js'][0].severity, 'error');
      assert.strictEqual(parsed.data.violations['src/app.js'][0].lineNo, 1);
      assert.strictEqual(parsed.data.message, '1 custom rule violation(s) in 1 file(s)');
    } finally {
      teardown(dir);
    }
  });

  it('ships tools/yaml.js to generated projects so check_custom resolves', async () => {
    const { autoDetectStack } = require('../src/detector');
    const { generateHarness } = require('../src/generator');

    // Real end-to-end path: detect + generate a Next.js project.
    const dir = createTmpProject({
      'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
    });
    const config = autoDetectStack(dir);
    assert.strictEqual(config.framework, 'Next.js (App Router)');
    generateHarness(dir, config);

    try {
      // The generated project must ship the parser next to tools/check_custom.js.
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'yaml.js')), 'tools/yaml.js shipped');

      const generatedCheck = path.join(dir, 'tools', 'check_custom.js');
      assert.ok(fs.existsSync(generatedCheck), 'tools/check_custom.js shipped');

      fs.writeFileSync(path.join(dir, '.clc-forge.yml'), VALID_CONFIG);
      fs.mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
      initGitRepo(dir);

      fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'debugger;\nmodule.exports = 1;\n');
      spawnSync('git', ['add', 'src/app.js'], { cwd: dir });

      const { parsed, exitCode } = await runCheckCustom(generatedCheck, dir);

      assert.strictEqual(parsed.name, 'check_custom');
      assert.strictEqual(parsed.skipped, false);
      assert.strictEqual(parsed.exitCode, 1);
      assert.strictEqual(exitCode, 1);
      assert.strictEqual(parsed.data.violations['src/app.js'][0].rule, 'no-debugger');
    } finally {
      teardown(dir);
    }
  });

  it('fails closed with a parse error message on unsupported anchor/alias config', async () => {
    const dir = createTmpProject({
      '.clc-forge.yml': 'rules:\n  - name: r\n    template: &tpl shared\n',
      'src/app.js': 'module.exports = 1;\n',
    });
    initGitRepo(dir);

    try {
      fs.writeFileSync(path.join(dir, 'src/app.js'), 'debugger;\n');
      spawnSync('git', ['add', 'src/app.js'], { cwd: dir });

      const { parsed, exitCode } = await runCheckCustom(CHECK_CUSTOM, dir);

      assert.strictEqual(parsed.name, 'check_custom');
      assert.strictEqual(parsed.skipped, false);
      assert.strictEqual(parsed.exitCode, 1);
      assert.strictEqual(exitCode, 1);
      assert.ok(
        parsed.data.message.includes('Config parse error') &&
          parsed.data.message.includes('Unsupported YAML syntax at line 3'),
        `unexpected message: ${parsed.data.message}`
      );
    } finally {
      teardown(dir);
    }
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// A-03: .clc-forge.yml loader / validator / resolver (extended schema)
// ═══════════════════════════════════════════════════════════════════════════

const FULL_VALID_YAML = `active_guards:
  - check_custom
  - scan_secrets
phases: [research, plan, test-scenarios, hit, tdd-red, green, audit, rdd-review, handover, close]
gate_mode: advisory
severities:
  check_custom: warning
  scan_secrets: error
layers: [domain, application]
scope: 'src'
exclude_paths: ['**/*.min.js']
rules:
  - name: no-debugger
    pattern: 'debugger'
    severity: error
`;

function assertConfigError(fn, pathPattern, fixPattern) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err.constructor.name}: ${err.message}`);
    assert.ok(err instanceof Error, 'ConfigError must extend Error');
    assert.match(err.path, pathPattern);
    assert.ok(typeof err.fix === 'string' && err.fix.length > 0, 'fix message present');
    if (fixPattern) assert.match(err.fix, fixPattern);
    return true;
  });
}

describe('config A-03: loadConfig', () => {
  it('parses yaml into a raw object and returns {} for empty input', () => {
    const raw = loadConfig(FULL_VALID_YAML);
    assert.deepStrictEqual(raw.active_guards, ['check_custom', 'scan_secrets']);
    assert.deepStrictEqual(raw.phases, HARNESS_PHASES);
    assert.deepStrictEqual(raw.severities, { check_custom: 'warning', scan_secrets: 'error' });
    assert.strictEqual(raw.scope, 'src');
    assert.deepStrictEqual(raw.exclude_paths, ['**/*.min.js']);
    assert.strictEqual(raw.rules.length, 1);
    assert.deepStrictEqual(loadConfig(''), {});
    assert.deepStrictEqual(loadConfig(undefined), {});
    assert.deepStrictEqual(loadConfig(null), {});
  });

  it('throws ConfigError on parse failure (unsupported anchor syntax)', () => {
    assertConfigError(() => loadConfig('base: &anchor\n  a: 1\n'), /<root>/, /parse/i);
  });
});

describe('config A-03: validateConfig', () => {
  it('accepts full valid and empty configs, returning them unchanged', () => {
    const raw = loadConfig(FULL_VALID_YAML);
    assert.strictEqual(validateConfig(raw), raw);
    assert.deepStrictEqual(validateConfig({}), {});
  });

  it('rejects unknown guard names in active_guards and severities', () => {
    assertConfigError(
      () => validateConfig({ active_guards: ['check_custom', 'does_not_exist'] }),
      /active_guards\[1\]/, /does_not_exist/
    );
    assertConfigError(() => validateConfig({ severities: { bogus_guard: 'error' } }), /severities\.bogus_guard/);
  });

  it('rejects invalid severity and gate_mode values', () => {
    assertConfigError(
      () => validateConfig({ severities: { check_custom: 'fatal' } }),
      /severities\.check_custom/, /to one of: error, warning, advisory/
    );
    assertConfigError(() => validateConfig({ gate_mode: 'soft' }), /gate_mode/, /to one of: hard, advisory/);
  });

  it('rejects unknown/out-of-order/duplicate phases; accepts ordered subset', () => {
    assertConfigError(() => validateConfig({ phases: ['research', 'plan', 'nonsense'] }), /phases\[2\]/, /nonsense/);
    assertConfigError(() => validateConfig({ phases: ['research', 'audit', 'plan'] }), /phases\[2\]/, /out of order/);
    assertConfigError(() => validateConfig({ phases: ['research', 'research'] }), /phases\[1\]/);
    assert.deepStrictEqual(
      validateConfig({ phases: ['research', 'plan', 'tdd-red', 'green'] }).phases,
      ['research', 'plan', 'tdd-red', 'green']
    );
  });

  it('validates scope / exclude_paths / layers types', () => {
    assert.strictEqual(validateConfig({ scope: 'src' }).scope, 'src');
    assert.deepStrictEqual(validateConfig({ scope: ['src', 'lib'] }).scope, ['src', 'lib']);
    assert.deepStrictEqual(validateConfig({ exclude_paths: ['**/*.min.js'] }).exclude_paths, ['**/*.min.js']);
    assert.deepStrictEqual(validateConfig({ layers: ['domain'] }).layers, ['domain']);
    assertConfigError(() => validateConfig({ scope: [42] }), /scope\[0\]/);
    assertConfigError(() => validateConfig({ exclude_paths: 'src' }), /exclude_paths/);
    assertConfigError(() => validateConfig({ layers: [12] }), /layers\[0\]/);
  });

  it('preserves legacy rules with unique required names', () => {
    assert.strictEqual(validateConfig(loadConfig(FULL_VALID_YAML)).rules[0].name, 'no-debugger');
    assertConfigError(
      () => validateConfig({ rules: [{ name: 'a', pattern: 'x' }, { name: 'a', pattern: 'y' }] }),
      /rules\[1\]\.name/, /duplicate/
    );
    assertConfigError(() => validateConfig({ rules: [{ pattern: 'x' }] }), /rules\[0\]/, /name/);
    assertConfigError(() => validateConfig({ rules: [{ name: 'a', severity: 'fatal' }] }), /rules\[0\]\.severity/);
  });
});

const DETECTED = { projectType: 'backend', framework: 'FastAPI', orm: 'Framework Native', testRunner: 'Pytest', techTools: [] };

describe('config A-03: resolveConfig', () => {
  it('resolves a valid full config with catalog defaults merged', () => {
    const resolved = resolveConfig(loadConfig(FULL_VALID_YAML), DETECTED);
    assert.deepStrictEqual(resolved.activeGuards, ['check_custom', 'scan_secrets']);
    assert.strictEqual(resolved.gateMode, 'advisory');
    assert.deepStrictEqual(resolved.phases, HARNESS_PHASES);
    assert.strictEqual(resolved.scope, 'src');
    assert.deepStrictEqual(resolved.excludePaths, ['**/*.min.js']);
    assert.deepStrictEqual(resolved.layers, ['domain', 'application']);
    assert.strictEqual(resolved.framework, 'FastAPI');
    // Config severities override catalog defaults.
    assert.strictEqual(resolved.effectiveSeverities.check_custom, 'warning');
    assert.strictEqual(resolved.effectiveSeverities.scan_secrets, 'error');
    // __catalog pipeline with override + advisory downgrade-everything.
    assert.strictEqual(resolved.__catalog.length, 2);
    assert.strictEqual(resolved.__catalog[0].name, 'check_custom');
    assert.strictEqual(resolved.__catalog[0].severity, 'warning');
    assert.strictEqual(resolved.__catalog[0].file, 'check_custom.js+check_custom.py');
    assert.strictEqual(resolved.__catalog[0].gate_mode, 'advisory');
    assert.strictEqual(resolved.__catalog[1].gate_mode, 'advisory');
  });

  it('defaults active_guards to catalog rows applicable to the detected stack', () => {
    const resolved = resolveConfig({}, { projectType: 'frontend', framework: 'Next.js (App Router)', orm: 'Framework Native', testRunner: 'Vitest', techTools: [] });
    const names = new Set(resolved.activeGuards);
    assert.ok(names.has('scan_secrets'), 'always-applicable guard active');
    assert.ok(names.has('check_a11y'), 'frontend-applicable guard active');
    assert.ok(!names.has('check_migrations'), 'backend-only guard NOT active');
    assert.ok(!names.has('celery_guard'), 'tech guard NOT active without techTools');
  });

  it('activates tech guards whose names are detected in techTools', () => {
    const resolved = resolveConfig({}, { ...DETECTED, framework: 'Django', techTools: [{ name: 'celery_guard', path: 'celery_guard.py', command: 'python3 tools/celery_guard.py' }] });
    assert.ok(resolved.activeGuards.includes('celery_guard'));
    assert.ok(resolved.activeGuards.includes('check_migrations'));
  });

  it('applies severity precedence: env override > config severities > catalog default', () => {
    const prev = process.env[ENV_SEVERITIES];
    try {
      // catalog default for check_ui_reuse is 'warning'.
      assert.strictEqual(resolveConfig({}, { projectType: 'frontend' }).effectiveSeverities.check_ui_reuse, 'warning');
      // env override wins over config severities and catalog default.
      process.env[ENV_SEVERITIES] = JSON.stringify({ check_ui_reuse: 'error' });
      assert.strictEqual(
        resolveConfig({ severities: { check_ui_reuse: 'warning' } }, { projectType: 'frontend' }).effectiveSeverities.check_ui_reuse,
        'error'
      );
      // unknown guard / invalid value / malformed JSON in env are ignored.
      process.env[ENV_SEVERITIES] = JSON.stringify({ bogus_guard: 'error' });
      assert.strictEqual(resolveConfig({}, { projectType: 'frontend' }).effectiveSeverities.check_ui_reuse, 'warning');
      process.env[ENV_SEVERITIES] = JSON.stringify({ check_ui_reuse: 'fatal' });
      assert.strictEqual(resolveConfig({}, { projectType: 'frontend' }).effectiveSeverities.check_ui_reuse, 'warning');
      process.env[ENV_SEVERITIES] = '{not json';
      assert.strictEqual(resolveConfig({}, { projectType: 'frontend' }).effectiveSeverities.check_ui_reuse, 'warning');
    } finally {
      if (prev === undefined) delete process.env[ENV_SEVERITIES];
      else process.env[ENV_SEVERITIES] = prev;
    }
  });

  it('does not silently fall back on invalid raw config', () => {
    assertConfigError(() => resolveConfig({ active_guards: ['nope'] }, {}), /active_guards\[0\]/);
  });
});

describe('config A-03: generateHarness integration', () => {
  it('generateHarness(config) writes .clc-forge.resolved.json metadata', () => {
    const dir = createTmpProject({});
    try {
      const resolved = generateHarness(dir, loadConfig(FULL_VALID_YAML));
      const meta = JSON.parse(fs.readFileSync(path.join(dir, '.clc-forge.resolved.json'), 'utf-8'));
      assert.deepStrictEqual(meta.activeGuards, ['check_custom', 'scan_secrets']);
      assert.strictEqual(meta.gateMode, 'advisory');
      assert.deepStrictEqual(meta.phases, HARNESS_PHASES);
      assert.strictEqual(meta.scope, 'src');
      assert.deepStrictEqual(meta.excludePaths, ['**/*.min.js']);
      assert.deepStrictEqual(meta.layers, ['domain', 'application']);
      assert.strictEqual(meta.framework, 'unknown');
      assert.strictEqual(meta.__catalog.length, 2);
      assert.deepStrictEqual(resolved.activeGuards, meta.activeGuards);
    } finally {
      teardown(dir);
    }
  });

  it('generateHarness with a pre-resolved config does not re-resolve', () => {
    const dir = createTmpProject({});
    try {
      const resolved = resolveConfig(loadConfig(FULL_VALID_YAML), { ...DETECTED });
      resolved.__clcForgeConfigPath = true;
      generateHarness(dir, resolved);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, '.clc-forge.resolved.json'), 'utf-8'));
      assert.strictEqual(meta.framework, 'FastAPI', 'detected metadata preserved (no re-resolve)');
    } finally {
      teardown(dir);
    }
  });

  it('generateHarness(null/undefined/adapter-config) keeps the legacy path, no metadata', () => {
    const dir = createTmpProject({});
    try {
      generateHarness(dir, null);
      assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md still written');
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'scan_secrets.py')), 'fallback tools still installed');
      assert.strictEqual(fs.existsSync(path.join(dir, '.clc-forge.resolved.json')), false, 'no metadata for the legacy/null path');
    } finally {
      teardown(dir);
    }

    const dir2 = createTmpProject({ 'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }) });
    try {
      const { autoDetectStack } = require('../src/detector');
      generateHarness(dir2, autoDetectStack(dir2));
      assert.strictEqual(fs.existsSync(path.join(dir2, '.clc-forge.resolved.json')), false, 'adapter-detected config does not emit metadata');
      generateHarness(dir2, undefined);
      assert.strictEqual(fs.existsSync(path.join(dir2, '.clc-forge.resolved.json')), false);
    } finally {
      teardown(dir2);
    }
  });

  it('generateHarness with an invalid config throws ConfigError (no partial harness)', () => {
    const dir = createTmpProject({});
    try {
      assertConfigError(() => generateHarness(dir, { active_guards: ['not_a_guard'] }), /active_guards\[0\]/);
      assert.strictEqual(fs.existsSync(path.join(dir, '.clc-forge.resolved.json')), false);
    } finally {
      teardown(dir);
    }
  });
});