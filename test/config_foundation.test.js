/**
 * sdds/config-foundation: every key of the .clckernel.yaml schema has a real
 * effect, removed keys warn, invalid values fail closed (file + key), and the
 * defaults reproduce the earlier behaviour. One group per TDD plan item.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, createGitRepo, teardown, git } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const NEXT_PKG = JSON.stringify({ name: 'web', private: true, dependencies: { next: '14.0.0' } });

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const lexists = (dir, rel) => {
  try {
    fs.lstatSync(path.join(dir, rel));
    return true;
  } catch {
    return false;
  }
};
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
/** Runs fn with console.log/warn captured; returns { result, warned }. */
const quietly = (fn) => {
  const { log, warn } = console;
  const warned = [];
  console.log = () => {};
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    return { result: fn(), warned: warned.join('\n') };
  } finally {
    console.log = log;
    console.warn = warn;
  }
};
const install = (dir) => quietly(() => generateHarness(dir, autoDetectStack(dir))).result;
const loadConfigModule = () => require('../tools/_config.js');
const python = (code, args = []) =>
  spawnSync('python3', ['-c', code, ...args], { encoding: 'utf-8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });

const DEFAULTS = {
  rules: [],
  exclude_paths: [],
  mirrors: { list: null, required: false },
  hitl: { markers: null, paths: null, optOut: null },
  update: { exclude: [] },
  tdd: { code: [], ignore: [] },
};

// ── 1. Schema ────────────────────────────────────────────────────────────

describe('item 1: schema (tools/_config.js and tools/_config.py)', () => {
  it('an empty config yields the defaults and no warning', () => {
    const { validateConfig } = loadConfigModule();
    assert.deepStrictEqual(validateConfig({}, '.clckernel.yaml'), { config: DEFAULTS, warnings: [] });
  });

  it('each removed key warns as deprecated and has no effect', () => {
    const { validateConfig } = loadConfigModule();
    for (const key of ['active_guards', 'phases', 'gate_mode', 'severities', 'layers', 'scope']) {
      const { config, warnings } = validateConfig({ [key]: ['x'] }, '.clckernel.yaml');
      assert.deepStrictEqual(config, DEFAULTS, key);
      assert.strictEqual(warnings.length, 1, key);
      assert.match(warnings[0], new RegExp(`\\.clckernel\\.yaml: key "${key}" is deprecated`));
    }
  });

  it('an unknown top-level key warns instead of passing silently', () => {
    const { validateConfig } = loadConfigModule();
    const { warnings } = validateConfig({ gaurds: 1 }, '.clckernel.yaml');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /unknown key "gaurds"/);
  });

  it('invalid values throw a ConfigError naming the file and the key', () => {
    const { validateConfig, ConfigError } = loadConfigModule();
    const cases = [
      [{ exclude_paths: [1] }, 'exclude_paths[0]'],
      [{ exclude_paths: 'vendor/**' }, 'exclude_paths'],
      [{ mirrors: { list: ['../outside.md'] } }, 'mirrors.list[0]'],
      [{ mirrors: { list: ['/abs.md'] } }, 'mirrors.list[0]'],
      [{ mirrors: { list: ['AGENTS.md'] } }, 'mirrors.list[0]'],
      [{ mirrors: { required: 'yes' } }, 'mirrors.required'],
      [{ mirrors: { requried: true } }, 'mirrors.requried'],
      [{ hitl: { markers: ['('] } }, 'hitl.markers[0]'],
      [{ hitl: { paths: 'skills/**' } }, 'hitl.paths'],
      [{ hitl: { optOut: { key: '' } } }, 'hitl.optOut.key'],
      [{ hitl: { optOut: { key: 'hitl' } } }, 'hitl.optOut.value'],
      [{ update: { exlude: [] } }, 'update.exlude'],
      [{ tdd: { code: 'tools/**/*.py' } }, 'tdd.code'],
      [{ tdd: { ignore: [''] } }, 'tdd.ignore[0]'],
      [{ tdd: [] }, 'tdd'],
    ];
    for (const [raw, key] of cases) {
      assert.throws(() => validateConfig(raw, '.clckernel.yml'), (err) => {
        assert.ok(err instanceof ConfigError, `${key}: ${err}`);
        assert.strictEqual(err.key, key);
        assert.ok(err.message.startsWith(`Invalid .clckernel.yml: key "${key}"`), err.message);
        return true;
      }, key);
    }
  });

  it('loadConfig reads the file of the project root and names it in errors', () => {
    const { loadConfig } = loadConfigModule();
    const dir = createTmpProject({ '.clckernel.yml': 'tdd:\n  code: nope\n' });
    try {
      assert.throws(() => loadConfig(dir, { cache: false }), /Invalid \.clckernel\.yml: key "tdd\.code"/);
      write(dir, '.clckernel.yml', 'tdd:\n  code:\n    - "tools/**/*.py"\n');
      const loaded = loadConfig(dir, { cache: false });
      assert.strictEqual(loaded.file, '.clckernel.yml');
      assert.deepStrictEqual(loaded.config.tdd.code, ['tools/**/*.py']);
    } finally {
      teardown(dir);
    }
    const none = createTmpProject({});
    try {
      assert.deepStrictEqual(loadConfig(none, { cache: false }), { file: null, path: null, config: DEFAULTS, warnings: [] });
    } finally {
      teardown(none);
    }
  });

  it('the Python twin returns the same config, warnings and error keys', () => {
    const { validateConfig } = loadConfigModule();
    const cases = [
      {},
      { gate_mode: 'hard', unknown_one: 1 },
      { exclude_paths: ['vendor/**'], mirrors: { list: ['CLAUDE.md'], required: true } },
      { hitl: { markers: ['^Gate:'], paths: ['docs/**/*.md'], optOut: { key: 'hitl', value: 'none' } } },
      { update: { exclude: ['AGENTS.md'] }, tdd: { code: ['tools/**/*.py'], ignore: ['scripts/**'] } },
      { exclude_paths: [1] },
      { mirrors: { list: ['../x'] } },
      { hitl: { optOut: { key: '' } } },
      { update: { exlude: [] } },
      { tdd: { code: 'x' } },
      { rules: [{ name: 'a' }, { name: 'a' }] },
    ];
    const js = cases.map((raw) => {
      try {
        return validateConfig(raw, '.clckernel.yaml');
      } catch (err) {
        return { error: err.key };
      }
    });
    const res = python([
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
      'import _config',
      'out = []',
      'for raw in json.loads(sys.argv[1]):',
      '    try:',
      '        config, warnings = _config.validate_config(raw, ".clckernel.yaml")',
      '        out.append({"config": config, "warnings": warnings})',
      '    except _config.ConfigError as err:',
      '        out.append({"error": err.key})',
      'print(json.dumps(out))',
    ].join('\n'), [JSON.stringify(cases)]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout), js);
  });

  it('src/config.js validates with the same module (one schema)', () => {
    const { validateConfig, readProjectConfig, ConfigError } = require('../src/config.js');
    assert.strictEqual(ConfigError, loadConfigModule().ConfigError);
    assert.deepStrictEqual(validateConfig({}, '.clckernel.yaml').config, DEFAULTS);
    assert.strictEqual(typeof readProjectConfig, 'function');
  });

  it("this repository's own config has no removed key and counts tools/**/*.py as code", () => {
    const { readProjectConfig } = require('../src/config.js');
    const loaded = readProjectConfig(ROOT);
    assert.deepStrictEqual(loaded.warnings, []);
    assert.ok(loaded.config.tdd.code.includes('tools/**/*.py'));
  });
});

// ── 2. Install and update read the project config ────────────────────────

describe('item 2: install reads .clckernel.yaml and fails closed', () => {
  it('an invalid config throws before anything is written', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG, '.clckernel.yaml': 'mirrors:\n  required: maybe\n' });
    try {
      assert.throws(() => install(dir), /Invalid \.clckernel\.yaml: key "mirrors\.required"/);
      assert.strictEqual(exists(dir, 'AGENTS.md'), false);
      assert.strictEqual(exists(dir, 'tools'), false);
    } finally {
      teardown(dir);
    }
  });

  it('a removed key is reported as a deprecation warning', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG, '.clckernel.yaml': 'gate_mode: hard\n' });
    try {
      const { warned } = quietly(() => generateHarness(dir, autoDetectStack(dir)));
      assert.match(warned, /key "gate_mode" is deprecated/);
    } finally {
      teardown(dir);
    }
  });

  it('generateHarness no longer writes .clckernel.resolved.json', () => {
    const dir = createTmpProject({});
    try {
      quietly(() => generateHarness(dir, { active_guards: ['scan_secrets'] }));
      assert.strictEqual(exists(dir, '.clckernel.resolved.json'), false);
    } finally {
      teardown(dir);
    }
  });

  it('CLI update with an invalid config exits 1 with the ConfigError text and writes nothing', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG });
    try {
      install(dir);
      fs.rmSync(path.join(dir, 'tools', 'scan_secrets.js'));
      write(dir, '.clckernel.yaml', 'tdd:\n  ignore: everything\n');
      const res = spawnSync(process.execPath, [CLI, 'update', dir], { encoding: 'utf-8' });
      assert.strictEqual(res.status, 1, res.stdout + res.stderr);
      assert.match(res.stdout + res.stderr, /Invalid \.clckernel\.yaml: key "tdd\.ignore"/);
      assert.strictEqual(exists(dir, 'tools/scan_secrets.js'), false, 'nothing written');
    } finally {
      teardown(dir);
    }
  });
});

// ── 3. Mirrors ───────────────────────────────────────────────────────────

describe('item 3: mirrors.list and mirrors.required', () => {
  const checkSymlinks = () => require('../tools/check_symlinks.js');

  it('install creates exactly the listed mirrors', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG, '.clckernel.yaml': 'mirrors:\n  list:\n    - CLAUDE.md\n    - .windsurfrules\n' });
    try {
      install(dir);
      assert.ok(fs.lstatSync(path.join(dir, 'CLAUDE.md')).isSymbolicLink());
      assert.ok(fs.lstatSync(path.join(dir, '.windsurfrules')).isSymbolicLink());
      for (const rel of ['GEMINI.md', '.cursorrules', '.github/copilot-instructions.md', '.antigravity/rules.md']) {
        assert.strictEqual(lexists(dir, rel), false, rel);
      }
    } finally {
      teardown(dir);
    }
  });

  it('without the key install still creates the six default mirrors', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG });
    try {
      install(dir);
      for (const rel of ['CLAUDE.md', 'GEMINI.md', '.cursorrules', '.cursor/rules/clckernel_context.mdc', '.github/copilot-instructions.md', '.antigravity/rules.md']) {
        assert.ok(lexists(dir, rel), rel);
      }
    } finally {
      teardown(dir);
    }
  });

  it('check_symlinks verifies the listed mirrors', async () => {
    const dir = createTmpProject({
      'AGENTS.md': '# Law\n',
      '.github/copilot-instructions.md': '# Diverging copy\n',
      '.clckernel.yaml': 'mirrors:\n  list:\n    - .github/copilot-instructions.md\n',
    });
    try {
      const res = await checkSymlinks()(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(res.data.violations.map((v) => v.file), ['.github/copilot-instructions.md']);
    } finally {
      teardown(dir);
    }
  });

  it('mirrors.required fails on a listed mirror that is missing', async () => {
    const dir = createTmpProject({ 'AGENTS.md': '# Law\n', '.clckernel.yaml': 'mirrors:\n  list:\n    - CLAUDE.md\n  required: true\n' });
    try {
      const res = await checkSymlinks()(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.match(res.data.violations[0].message, /missing/i);
    } finally {
      teardown(dir);
    }
  });

  it('by default a missing mirror is not an error', async () => {
    const dir = createTmpProject({ 'AGENTS.md': '# Law\n' });
    try {
      const res = await checkSymlinks()(dir);
      assert.strictEqual(res.exitCode, 0);
    } finally {
      teardown(dir);
    }
  });
});

// ── 4. HITL ──────────────────────────────────────────────────────────────

describe('item 4: hitl.markers, hitl.paths, hitl.optOut', () => {
  const checkHitl = (dir) => require('../tools/check_hitl.js')(dir);
  const SKILL = 'skills/publish/SKILL.md';

  it('defaults: a bare HITL word is not a marker', async () => {
    const dir = createGitRepo({ 'README.md': '# r\n' }, { [SKILL]: '# Publish\n\nHITL\n' });
    try {
      assert.strictEqual((await checkHitl(dir)).exitCode, 1);
    } finally {
      teardown(dir);
    }
  });

  it('hitl.markers replaces the default markers', async () => {
    const config = 'hitl:\n  markers:\n    - "^Approval gate:"\n';
    const dir = createGitRepo({ '.clckernel.yaml': config }, {
      [SKILL]: '# Publish\n\napproval gate: the operator signs off\n',
      'skills/draft/SKILL.md': '# Draft\n\nHITL: the operator reviews\n',
    });
    try {
      const res = await checkHitl(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(res.data.violations.map((v) => v.file), ['skills/draft/SKILL.md']);
    } finally {
      teardown(dir);
    }
  });

  it('hitl.paths selects the files that are evaluated', async () => {
    const config = 'hitl:\n  paths:\n    - "docs/flows/**/*.md"\n';
    const dir = createGitRepo({ '.clckernel.yaml': config }, {
      'docs/flows/billing/refund.md': '# Refund\nNo marker.\n',
      [SKILL]: '# Publish\nNo marker either.\n',
    });
    try {
      const res = await checkHitl(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(res.data.violations.map((v) => v.file), ['docs/flows/billing/refund.md']);
    } finally {
      teardown(dir);
    }
  });

  it('hitl.optOut exempts a file whose frontmatter has the key/value', async () => {
    const config = 'hitl:\n  optOut:\n    key: checkpoint\n    value: none\n';
    const dir = createGitRepo({ '.clckernel.yaml': config }, {
      [SKILL]: '---\nname: publish\ncheckpoint: "none"\n---\n# Publish\nRead-only skill.\n',
      'skills/draft/SKILL.md': '---\nname: draft\ncheckpoint: required\n---\n# Draft\n',
    });
    try {
      const res = await checkHitl(dir);
      assert.deepStrictEqual(res.data.violations.map((v) => v.file), ['skills/draft/SKILL.md']);
    } finally {
      teardown(dir);
    }
  });
});

// ── 5. update.exclude ────────────────────────────────────────────────────

describe('item 5: update.exclude', () => {
  const CONFIG = 'update:\n  exclude:\n    - tools/scan_secrets.js\n    - CLAUDE.md\n';

  it('install never writes an excluded path and reports it', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG, '.clckernel.yaml': CONFIG, 'tools/scan_secrets.js': '// mine\n' });
    try {
      const { plan } = install(dir);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'tools/scan_secrets.js'), 'utf-8'), '// mine\n');
      assert.strictEqual(exists(dir, 'tools/scan_secrets.js.clckernel-new'), false);
      assert.strictEqual(lexists(dir, 'CLAUDE.md'), false);
      assert.deepStrictEqual([...plan.excluded].sort(), ['CLAUDE.md', 'tools/scan_secrets.js']);
    } finally {
      teardown(dir);
    }
  });

  it('update leaves an excluded kernel file alone', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG });
    try {
      install(dir);
      fs.rmSync(path.join(dir, 'tools', 'scan_secrets.js'));
      write(dir, '.clckernel.yaml', CONFIG);
      const { plan } = quietly(() => updateHarness(dir)).result;
      assert.strictEqual(exists(dir, 'tools/scan_secrets.js'), false);
      assert.ok(plan.excluded.includes('tools/scan_secrets.js'));
    } finally {
      teardown(dir);
    }
  });

  it('the plan prints the excluded paths', () => {
    const { planLines } = require('../src/ui');
    const plan = {
      written: [], unchanged: [], protected: [], moved: [], removed: [], gitignore: [], gitConfig: [],
      available: [], mirrorsSkipped: [], trackedNotIgnored: [], excluded: ['CLAUDE.md'],
    };
    assert.match(planLines(plan).join('\n'), /Excluded by config[\s\S]*CLAUDE\.md/);
  });
});

// ── 6. exclude_paths ─────────────────────────────────────────────────────

describe('item 6: exclude_paths drops paths for every diff-based guard', () => {
  const CONFIG = 'exclude_paths:\n  - "vendor/**"\n';

  it('_changes.js', () => {
    const dir = createGitRepo({ '.clckernel.yaml': CONFIG }, { 'vendor/lib.js': 'x\n', 'src/app.js': 'y\n' });
    try {
      const res = spawnSync(process.execPath, ['-e',
        `console.log(JSON.stringify(require(${JSON.stringify(path.join(TOOLS, '_changes.js'))}).changedFiles(process.argv[1]).files))`, dir],
      { encoding: 'utf-8' });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.deepStrictEqual(JSON.parse(res.stdout), ['src/app.js']);
    } finally {
      teardown(dir);
    }
  });

  it('_changes.py', () => {
    const dir = createGitRepo({ '.clckernel.yaml': CONFIG }, { 'vendor/lib.py': 'x\n', 'src/app.py': 'y\n' });
    try {
      const res = python([
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
        'import _changes',
        'print(json.dumps(_changes.changed_files(sys.argv[1])["files"]))',
      ].join('\n'), [dir]);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.deepStrictEqual(JSON.parse(res.stdout), ['src/app.py']);
    } finally {
      teardown(dir);
    }
  });
});

// ── 7. tdd.code / tdd.ignore ─────────────────────────────────────────────

describe('item 7: tdd.code and tdd.ignore', () => {
  const PKG = JSON.stringify({ name: 'p', private: true });
  const runJs = (dir) => {
    const res = spawnSync(process.execPath, [path.join(TOOLS, 'verify_tdd.js'), dir], { cwd: dir, encoding: 'utf-8' });
    return { status: res.status, data: JSON.parse(res.stdout).data };
  };
  const runPy = (dir) => {
    const res = spawnSync('python3', [path.join(TOOLS, 'verify_tdd.py'), dir], { cwd: dir, encoding: 'utf-8' });
    return { status: res.status, data: JSON.parse(res.stdout).data };
  };

  it('verify_tdd.js counts tdd.code files as production code', () => {
    const dir = createGitRepo({ 'package.json': PKG, '.clckernel.yaml': 'tdd:\n  code:\n    - "tools/**/*.py"\n' }, { 'tools/gen.py': 'print(1)\n' });
    try {
      const { status, data } = runJs(dir);
      assert.strictEqual(status, 1);
      assert.deepStrictEqual(data.changed_code, ['tools/gen.py']);
      assert.match(data.message, /No test evidence/);
    } finally {
      teardown(dir);
    }
  });

  it('verify_tdd.js never counts tdd.ignore files as code', () => {
    const dir = createGitRepo({ 'package.json': PKG, '.clckernel.yaml': 'tdd:\n  ignore:\n    - "scripts/**"\n' }, { 'scripts/build.js': 'module.exports = 1;\n' });
    try {
      const { status, data } = runJs(dir);
      assert.strictEqual(status, 0, data.message);
      assert.deepStrictEqual(data.changed_code, []);
    } finally {
      teardown(dir);
    }
  });

  it('verify_tdd.py counts tdd.code files as production code', () => {
    const dir = createGitRepo({ '.clckernel.yaml': 'tdd:\n  code:\n    - "sql/**/*.sql"\n' }, { 'sql/schema.sql': 'select 1;\n' });
    try {
      const { status, data } = runPy(dir);
      assert.strictEqual(status, 1);
      assert.deepStrictEqual(data.changed_code, ['sql/schema.sql']);
    } finally {
      teardown(dir);
    }
  });

  it('verify_tdd.py never counts tdd.ignore files as code', () => {
    const dir = createGitRepo({ '.clckernel.yaml': 'tdd:\n  ignore:\n    - "scripts/**"\n' }, { 'scripts/gen.py': 'print(1)\n' });
    try {
      const { status, data } = runPy(dir);
      assert.strictEqual(status, 0, data.message);
      assert.deepStrictEqual(data.changed_code, []);
    } finally {
      teardown(dir);
    }
  });
});

// ── 8. Runtime config infrastructure ─────────────────────────────────────

describe('item 8: the config readers are installed with the snapshot helpers', () => {
  it('a JS stack with a config gets tools/_config.js and tools/yaml.js', () => {
    const dir = createTmpProject({ 'package.json': NEXT_PKG, '.clckernel.yaml': 'exclude_paths:\n  - "vendor/**"\n' });
    try {
      install(dir);
      assert.ok(exists(dir, 'tools/_config.js'));
      assert.ok(exists(dir, 'tools/yaml.js'));
    } finally {
      teardown(dir);
    }
  });

  it('a Python stack with a config gets tools/_config.py and tools/_yaml.py', () => {
    const dir = createTmpProject({ 'requirements.txt': 'fastapi\n', '.clckernel.yaml': 'exclude_paths:\n  - "vendor/**"\n' });
    try {
      install(dir);
      assert.ok(exists(dir, 'tools/_config.py'));
      assert.ok(exists(dir, 'tools/_yaml.py'));
    } finally {
      teardown(dir);
    }
  });

  // A config added after install needs no `clckernel update`: the readers are
  // installed with the snapshot helpers.
  const RULE = 'rules:\n  - name: no-forbidden\n    pattern: "FORBIDDEN_CALL"\n    message: "Do not call it"\n';
  const addConfigAndStage = (dir, config, files) => {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--no-verify', '-m', 'install');
    write(dir, '.clckernel.yaml', config);
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    git(dir, 'add', '-A');
  };

  it('JS guards apply a config added after install', () => {
    const dir = createGitRepo({ 'package.json': NEXT_PKG });
    try {
      install(dir);
      assert.ok(exists(dir, 'tools/_config.js'), 'reader installed without a config');
      addConfigAndStage(dir, `${RULE}tdd:\n  ignore:\n    - "scripts/**"\n`, {
        'src/app.js': 'FORBIDDEN_CALL();\n',
        'scripts/build.js': 'module.exports = 1;\n',
      });
      const custom = spawnSync(process.execPath, ['tools/check_custom.js'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(custom.status, 1, custom.stdout + custom.stderr);
      assert.ok(JSON.parse(custom.stdout).data.violations['src/app.js'], custom.stdout);
      git(dir, 'rm', '-q', '--cached', 'src/app.js');
      const tdd = spawnSync(process.execPath, ['tools/verify_tdd.js'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(tdd.status, 0, tdd.stdout + tdd.stderr);
      assert.deepStrictEqual(JSON.parse(tdd.stdout).data.changed_code, []);
    } finally {
      teardown(dir);
    }
  });

  it('Python guards apply a config added after install', () => {
    const dir = createGitRepo({ 'requirements.txt': 'fastapi\n' });
    try {
      install(dir);
      assert.ok(exists(dir, 'tools/_config.py'), 'reader installed without a config');
      addConfigAndStage(dir, RULE, { 'app/main.py': 'FORBIDDEN_CALL()\n' });
      const res = spawnSync('python3', ['tools/check_custom.py'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 1, res.stdout + res.stderr);
      assert.ok(JSON.parse(res.stdout).data.violations['app/main.py'], res.stdout);
      assert.doesNotMatch(res.stdout + res.stderr, /clckernel update/);
    } finally {
      teardown(dir);
    }
  });

  it('a guard fails closed on an invalid config', () => {
    const dir = createGitRepo({ '.clckernel.yaml': 'tdd:\n  code: nope\n' }, { 'src/app.js': 'module.exports = 1;\n' });
    try {
      const res = spawnSync(process.execPath, [path.join(TOOLS, 'scan_secrets.js')], { cwd: dir, encoding: 'utf-8' });
      assert.notStrictEqual(res.status, 0);
      assert.match(res.stdout + res.stderr, /Invalid \.clckernel\.yaml: key "tdd\.code"/);
    } finally {
      teardown(dir);
    }
  });
});

// ── 9. Documentation ─────────────────────────────────────────────────────

describe('item 9: the README config tables list every key', () => {
  const KEYS = ['rules', 'exclude_paths', 'mirrors.list', 'mirrors.required', 'hitl.markers', 'hitl.paths', 'hitl.optOut', 'update.exclude', 'tdd.code', 'tdd.ignore'];
  for (const file of ['README.md', 'README.es.md']) {
    it(file, () => {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      for (const key of KEYS) assert.ok(text.includes(`| \`${key}\``), `${file}: ${key}`);
    });
  }
});
