/**
 * sdds/guard-exclude: `guard_exclude` in .clckernel.yaml keeps paths out of
 * ONE guard (keyed by guard name, like `severities`), while global
 * `exclude_paths` hides them from every guard. The snapshot helpers
 * (_changes.js/.py) apply it for the guard that is running: the audit
 * orchestrators name it in CLCKERNEL_GUARD (in-process and subprocess
 * guards alike); a guard run directly is named by its own file. scan_secrets
 * also skips a line that carries the `clckernel: allow-secret` marker.
 *
 * Every secret-shaped value is built at runtime from fragments so this file never contains one.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const jsConfig = require('../tools/_config.js');

const j = (...parts) => parts.join('');
const body = (n) => 'A1b2C3d4e5F6'.repeat(Math.ceil(n / 12)).slice(0, n);
const Q = '"';
/** A line the scanner flags as "API Key". */
const SECRET_LINE = j('API', '_KEY = ', Q, body(20), Q);
const MARKER = j('clckernel', ': allow-secret');

/** The environment of a spawned tool, without an inherited guard identity. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...extra };
  if (!('CLCKERNEL_GUARD' in extra)) delete env.CLCKERNEL_GUARD;
  return env;
}

// ── 1. Config schema ─────────────────────────────────────────────────────

describe('guard_exclude in the config schema (tools/_config.js and tools/_config.py)', () => {
  function pyValidate(raw) {
    const code = [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
      'import _config',
      'try:',
      '    config, warnings = _config.validate_config(json.loads(sys.argv[1]))',
      '    print(json.dumps({"guard_exclude": config["guard_exclude"], "warnings": warnings}))',
      'except _config.ConfigError as exc:',
      '    print(json.dumps({"error": exc.key, "message": str(exc)}))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', code, JSON.stringify(raw)], { encoding: 'utf-8', env: cleanEnv() });
    assert.strictEqual(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  }

  function jsValidate(raw) {
    try {
      const { config, warnings } = jsConfig.validateConfig(raw);
      return { guard_exclude: config.guard_exclude, warnings };
    } catch (err) {
      return { error: err.key, message: err.message };
    }
  }

  const ok = (value) => ({ guard_exclude: value, warnings: [] });
  const cases = [
    [{}, ok({})],
    [{ guard_exclude: null }, ok({})],
    [{ guard_exclude: {} }, ok({})],
    [{ guard_exclude: { scan_secrets: ['tests/**', '**/*.md'] } }, ok({ scan_secrets: ['tests/**', '**/*.md'] })],
    [{ guard_exclude: { scan_secrets: ['tests/**'], check_custom: ['docs/**'] } }, ok({ scan_secrets: ['tests/**'], check_custom: ['docs/**'] })],
    // Any guard name is accepted, as in `severities`: project guards in tools/guards/ have their own names.
    [{ guard_exclude: { check_my_project_rule: ['legacy/**'] } }, ok({ check_my_project_rule: ['legacy/**'] })],
  ];
  const errors = [
    [{ guard_exclude: ['tests/**'] }, 'guard_exclude', 'expected a mapping of guard name to a list of globs, got a list'],
    [{ guard_exclude: 'tests/**' }, 'guard_exclude', 'expected a mapping of guard name to a list of globs, got string'],
    [{ guard_exclude: { '': ['tests/**'] } }, 'guard_exclude', 'guard names must be non-empty'],
    [{ guard_exclude: { '  ': ['tests/**'] } }, 'guard_exclude', 'guard names must be non-empty'],
    [{ guard_exclude: { scan_secrets: 'tests/**' } }, 'guard_exclude.scan_secrets', 'expected a list of strings, got string'],
    [{ guard_exclude: { scan_secrets: null } }, 'guard_exclude.scan_secrets', 'expected a list of strings, got null'],
    [{ guard_exclude: { scan_secrets: { glob: 'tests/**' } } }, 'guard_exclude.scan_secrets', 'expected a list of strings, got object'],
    [{ guard_exclude: { scan_secrets: [''] } }, 'guard_exclude.scan_secrets[0]', 'each item must be a non-empty string'],
    [{ guard_exclude: { scan_secrets: ['tests/**', '   '] } }, 'guard_exclude.scan_secrets[1]', 'each item must be a non-empty string'],
    [{ guard_exclude: { scan_secrets: [1] } }, 'guard_exclude.scan_secrets[0]', 'each item must be a non-empty string'],
  ];

  for (const [raw, expected] of cases) {
    it(`${JSON.stringify(raw)} is valid (JS and Python)`, () => {
      assert.deepStrictEqual(jsValidate(raw), expected);
      assert.deepStrictEqual(pyValidate(raw), expected);
    });
  }

  for (const [raw, key, reason] of errors) {
    it(`${JSON.stringify(raw)} → ConfigError on "${key}" (JS and Python)`, () => {
      const message = `Invalid .clckernel.yaml: key "${key}" — ${reason}`;
      assert.deepStrictEqual(jsValidate(raw), { error: key, message });
      assert.deepStrictEqual(pyValidate(raw), { error: key, message });
    });
  }

  it('guard_exclude is a known key and defaults to an empty mapping', () => {
    assert.deepStrictEqual(jsConfig.defaultConfig().guard_exclude, {});
    assert.ok(!Object.prototype.hasOwnProperty.call(jsConfig.DEPRECATED_KEYS, 'guard_exclude'));
  });

  it('parses from YAML (block and flow lists) in both languages', () => {
    const text = 'guard_exclude:\n  scan_secrets:\n    - "tests/**"\n    - "**/*.md"\n  check_custom: ["docs/**"]\n';
    const expected = { scan_secrets: ['tests/**', '**/*.md'], check_custom: ['docs/**'] };
    assert.deepStrictEqual(jsConfig.validateConfig(jsConfig.parseConfigText(text)).config.guard_exclude, expected);
    const res = spawnSync('python3', ['-c', [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
      'import _config',
      'print(json.dumps(_config.validate_config(_config.parse_config_text(sys.argv[1]))[0]["guard_exclude"]))',
    ].join('\n'), text], { encoding: 'utf-8', env: cleanEnv() });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout), expected);
  });
});

// ── 2. The snapshot helpers ──────────────────────────────────────────────

describe('guard_exclude drops paths only for the guard it names (_changes.js/.py)', () => {
  const CONFIG = 'exclude_paths: ["vendor/**"]\nguard_exclude:\n  scan_secrets: ["tests/**", "**/*.md"]\n';
  const STAGED = { 'src/app.txt': 'a\n', 'tests/fixture.txt': 'b\n', 'docs/guide.md': 'c\n', 'vendor/lib.txt': 'd\n' };

  const viaJs = (dir, env) => {
    const res = spawnSync(process.execPath, ['-e',
      `console.log(JSON.stringify(require(${JSON.stringify(path.join(TOOLS, '_changes.js'))}).changedFiles(process.argv[1]).files))`, dir],
    { encoding: 'utf-8', env: cleanEnv(env) });
    assert.strictEqual(res.status, 0, res.stderr);
    return JSON.parse(res.stdout).sort();
  };
  const viaPy = (dir, env) => {
    const res = spawnSync('python3', ['-c', [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
      'import _changes',
      'print(json.dumps(_changes.changed_files(sys.argv[1])["files"]))',
    ].join('\n'), dir], { encoding: 'utf-8', env: cleanEnv(env) });
    assert.strictEqual(res.status, 0, res.stderr);
    return JSON.parse(res.stdout).sort();
  };

  for (const [lang, run] of Object.entries({ js: viaJs, py: viaPy })) {
    it(`${lang}: the named guard loses its excluded paths; exclude_paths still applies`, () => {
      const dir = createGitRepo({ '.clckernel.yaml': CONFIG }, STAGED);
      try {
        assert.deepStrictEqual(run(dir, { CLCKERNEL_GUARD: 'scan_secrets' }), ['src/app.txt']);
      } finally {
        teardown(dir);
      }
    });

    it(`${lang}: another guard (or no guard) still sees those paths`, () => {
      const dir = createGitRepo({ '.clckernel.yaml': CONFIG }, STAGED);
      try {
        const all = ['docs/guide.md', 'src/app.txt', 'tests/fixture.txt'];
        assert.deepStrictEqual(run(dir, { CLCKERNEL_GUARD: 'verify_tdd' }), all);
        assert.deepStrictEqual(run(dir, {}), all);
      } finally {
        teardown(dir);
      }
    });
  }

  it('JS and Python agree', () => {
    const dir = createGitRepo({ '.clckernel.yaml': CONFIG }, STAGED);
    try {
      for (const guard of ['scan_secrets', 'check_custom']) {
        assert.deepStrictEqual(viaJs(dir, { CLCKERNEL_GUARD: guard }), viaPy(dir, { CLCKERNEL_GUARD: guard }), guard);
      }
    } finally {
      teardown(dir);
    }
  });
});

describe('a guard run directly is named by its own file', () => {
  const CONFIG = 'guard_exclude:\n  scan_secrets: ["tests/**"]\n';
  const RUNNERS = {
    js: (dir) => spawnSync(process.execPath, [path.join(TOOLS, 'scan_secrets.js'), dir], { cwd: dir, encoding: 'utf-8', env: cleanEnv() }),
    py: (dir) => spawnSync('python3', [path.join(TOOLS, 'scan_secrets.py'), dir], { cwd: dir, encoding: 'utf-8', env: cleanEnv() }),
  };

  for (const [lang, run] of Object.entries(RUNNERS)) {
    it(`${lang}: scan_secrets skips a fake credential under tests/, still blocks one under src/`, () => {
      const dir = createGitRepo({ '.clckernel.yaml': CONFIG }, { 'tests/test_login.py': `${SECRET_LINE}\n` });
      try {
        const passed = run(dir);
        assert.strictEqual(passed.status, 0, passed.stdout + passed.stderr);
        fs.writeFileSync(path.join(dir, 'src.py'), `${SECRET_LINE}\n`);
        spawnSync('git', ['add', 'src.py'], { cwd: dir });
        const failed = run(dir);
        assert.strictEqual(failed.status, 1, failed.stdout + failed.stderr);
        const findings = JSON.parse(failed.stdout).data.findings;
        assert.deepStrictEqual(Object.keys(findings), ['src.py']);
      } finally {
        teardown(dir);
      }
    });
  }
});

// ── 3. The audit orchestrators ───────────────────────────────────────────

describe('audit orchestrators name the running guard (in-process and subprocess guards)', () => {
  const SUPPORT = ['_changes.js', '_config.js', 'yaml.js', '_changes.py', '_config.py', '_yaml.py'];
  const report = () => `SEEN=" + ",".join(_changes.changed_files(target_dir)["files"])`;
  const GUARDS = {
    // In process for audit.js; through its module runner (node -e) for audit.py.
    'tools/check_a_scoped.js': [
      "const { changedFiles } = require('./_changes');",
      "module.exports = async (dir) => ({ exitCode: 0, name: 'check_a_scoped', data: { message: 'SEEN=' + changedFiles(dir).files.join(',') } });",
      '',
    ].join('\n'),
    'tools/check_b_open.js': [
      "const { changedFiles } = require('./_changes');",
      "module.exports = async (dir) => ({ exitCode: 0, name: 'check_b_open', data: { message: 'SEEN=' + changedFiles(dir).files.join(',') } });",
      '',
    ].join('\n'),
    // In process for audit.py; through its module runner (python3 -c) for audit.js.
    'tools/check_c_pyscoped.py': [
      'import os, sys',
      'sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))',
      'import _changes',
      'def check(target_dir=None):',
      `    return {"exit_code": 0, "name": "check_c_pyscoped", "data": {"message": "${report()}}}`,
      '',
    ].join('\n'),
    'tools/check_d_pyopen.py': [
      'import os, sys',
      'sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))',
      'import _changes',
      'def check(target_dir=None):',
      `    return {"exit_code": 0, "name": "check_d_pyopen", "data": {"message": "${report()}}}`,
      '',
    ].join('\n'),
    // Project guards: plain scripts, always a separate process.
    'tools/guards/check_e_proj.js': [
      "const { changedFiles } = require('../_changes');",
      "console.log('SEEN=' + changedFiles(process.cwd()).files.join(','));",
      '',
    ].join('\n'),
    'tools/guards/check_f_pyproj.py': [
      'import os, sys',
      'sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))',
      'import _changes',
      'print("SEEN=" + ",".join(_changes.changed_files()["files"]))',
      '',
    ].join('\n'),
  };
  const CONFIG = [
    'guard_exclude:',
    '  check_a_scoped: ["tests/**"]',
    '  check_c_pyscoped: ["tests/**"]',
    '  check_e_proj: ["tests/**"]',
    '  check_f_pyproj: ["tests/**"]',
    '',
  ].join('\n');
  const SCOPED = 'src/app.txt';
  const ALL = 'src/app.txt,tests/fixture.txt';
  const EXPECTED = {
    check_a_scoped: SCOPED,
    check_b_open: ALL,
    check_c_pyscoped: SCOPED,
    check_d_pyopen: ALL,
    check_e_proj: SCOPED,
    check_f_pyproj: SCOPED,
  };

  function project(orchestrator) {
    const files = { '.clckernel.yaml': CONFIG, ...GUARDS };
    for (const f of [orchestrator, ...SUPPORT]) files[`tools/${f}`] = fs.readFileSync(path.join(TOOLS, f), 'utf-8');
    return createGitRepo(files, { 'src/app.txt': 'a\n', 'tests/fixture.txt': 'b\n' });
  }

  function seen(output) {
    const out = {};
    for (const m of output.matchAll(/^clckernel: \S+\s+(\S+): SEEN=(.*)$/gm)) out[m[1]] = m[2];
    return out;
  }

  const ORCHESTRATORS = { 'audit.js': process.execPath, 'audit.py': 'python3' };
  for (const [orchestrator, cmd] of Object.entries(ORCHESTRATORS)) {
    it(`${orchestrator}: each guard sees the changed files minus its own guard_exclude`, () => {
      const dir = project(orchestrator);
      try {
        const res = spawnSync(cmd, [path.join('tools', orchestrator), '--hook'], { cwd: dir, encoding: 'utf-8', env: cleanEnv() });
        assert.strictEqual(res.status, 0, res.stdout + res.stderr);
        assert.deepStrictEqual(seen(res.stdout), EXPECTED, res.stdout + res.stderr);
      } finally {
        teardown(dir);
      }
    });
  }

  it('an in-process guard does not leave its name behind for the caller', async () => {
    const dir = project('audit.js');
    const before = process.env.CLCKERNEL_GUARD;
    try {
      const { runGuard } = require('../tools/audit.js');
      const result = await runGuard(path.join(dir, 'tools', 'check_a_scoped.js'), dir);
      assert.strictEqual(result.data.message, `SEEN=${SCOPED}`);
      assert.strictEqual(process.env.CLCKERNEL_GUARD, before);
    } finally {
      teardown(dir);
    }
  });
});

// ── 4. scan_secrets inline allow marker ──────────────────────────────────

describe('scan_secrets: `clckernel: allow-secret` skips that line only', () => {
  const jsFind = (text, filename) => {
    delete require.cache[require.resolve('../tools/scan_secrets.js')];
    return require('../tools/scan_secrets.js').findSecrets(text, filename);
  };
  const pyFind = (cases) => {
    const res = spawnSync('python3', ['-c', [
      'import json, sys',
      'sys.path.insert(0, sys.argv[1])',
      'import scan_secrets',
      'print(json.dumps([scan_secrets.find_secrets(c["text"], c["filename"]) for c in json.load(sys.stdin)]))',
    ].join('\n'), TOOLS], { input: JSON.stringify(cases), encoding: 'utf-8', env: cleanEnv() });
    assert.strictEqual(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  };

  const CASES = [
    // [id, filename, text, reported line numbers]
    ['python comment', 'tests/test_auth.py', `${SECRET_LINE}  # ${MARKER}\n${SECRET_LINE}\n`, [2]],
    ['js comment', 'test/auth.test.js', `const k = 1; // ${MARKER}\n${SECRET_LINE};\n${SECRET_LINE}; // ${MARKER}\n`, [2]],
    ['marker on the line above does not cover the next line', 'a.py', `# ${MARKER}\n${SECRET_LINE}\n`, [2]],
    ['markdown example', 'docs/api.md', `    ${SECRET_LINE}  <!-- ${MARKER} -->\n`, []],
    ['dotenv', '.env', `${j('API', '_KEY=', body(24))} # ${MARKER}\n${j('AUTH', '_TOKEN=', body(16))}\n`, [2]],
    ['a similar word is not the marker', 'a.py', `${SECRET_LINE}  # ${j('clckernel', ': allow-secrets-everywhere')}\n`, [1]],
  ];

  for (const [id, filename, text, lines] of CASES) {
    it(`${id} (JS and Python)`, () => {
      assert.deepStrictEqual(jsFind(text, filename).map((f) => f.lineNo), lines, 'js');
      assert.deepStrictEqual(pyFind([{ text, filename }])[0].map((f) => f.lineNo), lines, 'py');
    });
  }

  it('JS and Python return identical findings', () => {
    const cases = CASES.map(([, filename, text]) => ({ filename, text }));
    assert.deepStrictEqual(cases.map((c) => jsFind(c.text, c.filename)), pyFind(cases));
  });
});

// ── 5. The guard identity stays with the guard ───────────────────────────

describe('verify_tdd does not hand CLCKERNEL_GUARD to the test runs it spawns', () => {
  const pytestMissing = spawnSync('python3', ['-c', 'import pytest'], { encoding: 'utf-8' }).status !== 0;

  function repo(committed, staged) {
    const dir = createGitRepo(committed, staged);
    return dir;
  }
  function runVerify(cmd, script, dir) {
    const res = spawnSync(cmd, [script, dir], {
      cwd: dir, encoding: 'utf-8', env: cleanEnv({ CLCKERNEL_GUARD: 'verify_tdd', CLC_TDD_TIMEOUT: '60' }),
    });
    return { status: res.status, raw: `${res.stdout}\n${res.stderr}`, result: JSON.parse(res.stdout) };
  }

  it('verify_tdd.js: the project test sees no CLCKERNEL_GUARD', () => {
    const header = "const { test } = require('node:test');\nconst assert = require('node:assert');\nconst sum = require('../lib/sum');\n";
    const dir = repo({
      'package.json': `${JSON.stringify({ name: 'calc', version: '1.0.0', private: true })}\n`,
      'lib/sum.js': 'exports.add = (a, b) => a + b;\n',
      'test/sum.test.js': `${header}test('add', () => assert.strictEqual(sum.add(2, 3), 5));\n`,
    }, {
      'lib/sum.js': 'exports.add = (a, b) => a + b;\nexports.mul = (a, b) => a * b;\n',
      'test/sum.test.js': `${header}test('add', () => assert.strictEqual(sum.add(2, 3), 5));\n`
        + "test('mul', () => assert.strictEqual(sum.mul(2, 3), 6));\n"
        + "test('no inherited guard identity', () => assert.strictEqual(process.env.CLCKERNEL_GUARD, undefined));\n",
    });
    try {
      const res = runVerify(process.execPath, path.join(TOOLS, 'verify_tdd.js'), dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.match(res.result.data.message, /red.*green verified/i, res.raw);
    } finally {
      teardown(dir);
    }
  });

  it('verify_tdd.py: the project test sees no CLCKERNEL_GUARD', { skip: pytestMissing && 'pytest is not importable' }, () => {
    const base = 'from calc import ops\n\n\ndef test_add():\n    assert ops.add(2, 3) == 5\n';
    const dir = repo({
      'calc/__init__.py': '',
      'calc/ops.py': 'def add(a, b):\n    return a + b\n',
      'tests/test_ops.py': base,
    }, {
      'calc/ops.py': 'def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n',
      'tests/test_ops.py': `import os\n${base}\n\ndef test_mul():\n    assert ops.mul(2, 3) == 6\n`
        + '\n\ndef test_no_inherited_guard_identity():\n    assert "CLCKERNEL_GUARD" not in os.environ\n',
    });
    try {
      const res = runVerify('python3', path.join(TOOLS, 'verify_tdd.py'), dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.match(res.result.data.message, /red.*green verified/i, res.raw);
    } finally {
      teardown(dir);
    }
  });
});
