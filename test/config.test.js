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
  readProjectConfig,
  ConfigError,
} = require('../src/config.js');

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

    // Real end-to-end path: detect + generate a Next.js project that has a
    // config (sdds/config-foundation: the config helpers follow the config file).
    const dir = createTmpProject({
      'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      '.clc-forge.yml': VALID_CONFIG,
    });
    const config = autoDetectStack(dir);
    assert.strictEqual(config.framework, 'Next.js (App Router)');
    const { warn } = console;
    console.warn = () => {};
    try {
      generateHarness(dir, config);
    } finally {
      console.warn = warn;
    }

    try {
      // The generated project must ship the parser next to tools/check_custom.js.
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'yaml.js')), 'tools/yaml.js shipped');
      assert.ok(fs.existsSync(path.join(dir, 'tools', '_config.js')), 'tools/_config.js shipped');

      const generatedCheck = path.join(dir, 'tools', 'check_custom.js');
      assert.ok(fs.existsSync(generatedCheck), 'tools/check_custom.js shipped');

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
// sdds/config-foundation: src/config.js wraps the shared schema (tools/_config.js)
// ═══════════════════════════════════════════════════════════════════════════

// Keys earlier releases accepted without any effect, next to the live ones.
const LEGACY_FULL_YAML = `active_guards:
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

function assertConfigError(fn, keyPattern) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err.constructor.name}: ${err.message}`);
    assert.ok(err instanceof Error, 'ConfigError must extend Error');
    assert.match(err.key, keyPattern);
    assert.ok(typeof err.fix === 'string' && err.fix.length > 0, 'fix message present');
    return true;
  });
}

describe('config: loadConfig (parse only)', () => {
  it('parses yaml into a raw object and returns {} for empty input', () => {
    const raw = loadConfig(LEGACY_FULL_YAML);
    assert.deepStrictEqual(raw.exclude_paths, ['**/*.min.js']);
    assert.strictEqual(raw.rules.length, 1);
    assert.deepStrictEqual(loadConfig(''), {});
    assert.deepStrictEqual(loadConfig(undefined), {});
    assert.deepStrictEqual(loadConfig(null), {});
  });

  it('throws ConfigError on parse failure (unsupported anchor syntax)', () => {
    assertConfigError(() => loadConfig('base: &anchor\n  a: 1\n'), /<root>/);
  });
});

describe('config: validateConfig', () => {
  it('keeps the live keys and warns once per removed key', () => {
    const { config, warnings } = validateConfig(loadConfig(LEGACY_FULL_YAML));
    assert.deepStrictEqual(config.exclude_paths, ['**/*.min.js']);
    assert.strictEqual(config.rules[0].name, 'no-debugger');
    assert.deepStrictEqual(config.severities, { check_custom: 'warning', scan_secrets: 'error' });
    const removed = ['active_guards', 'phases', 'gate_mode', 'layers', 'scope'];
    assert.deepStrictEqual(warnings.map((w) => /key "(\w+)"/.exec(w)[1]), removed);
  });

  it('rejects rules with a missing or duplicate name and an invalid severity', () => {
    assertConfigError(() => validateConfig({ rules: [{ name: 'a', pattern: 'x' }, { name: 'a', pattern: 'y' }] }), /^rules\[1\]\.name$/);
    assertConfigError(() => validateConfig({ rules: [{ pattern: 'x' }] }), /^rules\[0\]\.name$/);
    assertConfigError(() => validateConfig({ rules: [{ name: 'a', severity: 'fatal' }] }), /^rules\[0\]\.severity$/);
    assertConfigError(() => validateConfig({ rules: 'x' }), /^rules$/);
  });

  it('rejects a document that is not a mapping', () => {
    assertConfigError(() => validateConfig(['a']), /<root>/);
  });
});

describe('config: readProjectConfig', () => {
  it('reads the file as it is now (no cache between calls)', () => {
    const dir = createTmpProject({ '.clckernel.yaml': 'exclude_paths:\n  - "a/**"\n' });
    try {
      assert.deepStrictEqual(readProjectConfig(dir).config.exclude_paths, ['a/**']);
      fs.writeFileSync(path.join(dir, '.clckernel.yaml'), 'exclude_paths:\n  - "b/**"\n');
      assert.deepStrictEqual(readProjectConfig(dir).config.exclude_paths, ['b/**']);
    } finally {
      teardown(dir);
    }
  });
});
