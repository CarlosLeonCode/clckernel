/**
 * sdds/audit-cli: the audit orchestrators only write a report when told where
 * (--change <name>), reject unknown input, and a failing guard can be a
 * non-blocking warning (its own `level`, or `severities` in .clckernel.yaml).
 * Every behaviour is checked on tools/audit.js and tools/audit.py alike.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

const LANGS = {
  js: {
    orchestrator: 'audit.js',
    support: ['_config.js', 'yaml.js'],
    cmd: process.execPath,
    guard: (name, { exit = 0, level, message = 'MSG', crash = false } = {}) => [
      `tools/${name}.js`,
      crash
        ? `module.exports = async () => { throw new Error('KABOOM_${name}'); };\n`
        : `module.exports = async () => (${JSON.stringify({ exitCode: exit, name, ...(level ? { level } : {}), data: { message } })});\n`,
    ],
  },
  py: {
    orchestrator: 'audit.py',
    support: ['_config.py', '_yaml.py'],
    cmd: 'python3',
    guard: (name, { exit = 0, level, message = 'MSG', crash = false } = {}) => [
      `tools/${name}.py`,
      crash
        ? `def check(target_dir=None):\n    raise RuntimeError("KABOOM_${name}")\n`
        : `import json\ndef check(target_dir=None):\n    return json.loads(${JSON.stringify(JSON.stringify({ exit_code: exit, name, ...(level ? { level } : {}), data: { message } }))})\n`,
    ],
  },
};

/** A project with the orchestrator of lang (plus its config modules) and the given guards. */
function project(lang, guards = [], extra = {}) {
  const { orchestrator, support, guard } = LANGS[lang];
  const files = { ...extra };
  for (const f of [orchestrator, ...support]) files[`tools/${f}`] = fs.readFileSync(path.join(ROOT, 'tools', f), 'utf-8');
  for (const [name, opts] of guards) {
    const [rel, src] = guard(name, opts);
    files[rel] = src;
  }
  return createTmpProject(files);
}

function audit(lang, dir, args = []) {
  const { orchestrator, cmd } = LANGS[lang];
  const res = spawnSync(cmd, [path.join('tools', orchestrator), ...args], { cwd: dir, encoding: 'utf-8' });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', output: `${res.stdout}${res.stderr}` };
}

/** Every file under dir (relative, sorted) with its content: a byte-level snapshot. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__') walk(p);
      } else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf-8');
    }
  };
  walk(dir);
  return out;
}

const sddFiles = (dir) => Object.keys(snapshot(path.join(dir, 'sdds'))).sort();
const receipt = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, 'sdds', name, 'audit-receipt.json'), 'utf-8'));
const report = (dir, name) => fs.readFileSync(path.join(dir, 'sdds', name, '05-audit-report.md'), 'utf-8');

for (const lang of Object.keys(LANGS)) {
  const label = LANGS[lang].orchestrator;

  describe(`${label}: writes a report only with --change (sdds/audit-cli items 1-4)`, () => {
    it('no flag: writes nothing and does not create sdds/', () => {
      const dir = project(lang, [['check_ok', {}]]);
      try {
        const res = audit(lang, dir);
        assert.strictEqual(res.status, 0, res.output);
        assert.match(res.stdout, /4-LENS RDD AUDIT SUMMARY/);
        assert.match(res.stdout, /--change/, 'the summary tells how to write a report');
        assert.ok(!fs.existsSync(path.join(dir, 'sdds')), 'sdds/ must not be created');
      } finally {
        teardown(dir);
      }
    });

    it('no flag: an existing sdds/ with folders stays byte-for-byte untouched', () => {
      const dir = project(lang, [['check_ok', {}]], {
        'sdds/aaa-first/01-spec.md': 'spec A\n',
        'sdds/zzz-last/01-spec.md': 'spec Z\n',
      });
      try {
        const before = snapshot(path.join(dir, 'sdds'));
        const res = audit(lang, dir);
        assert.strictEqual(res.status, 0, res.output);
        assert.deepStrictEqual(snapshot(path.join(dir, 'sdds')), before);
      } finally {
        teardown(dir);
      }
    });

    it('--hook writes nothing either', () => {
      const dir = project(lang, [['check_ok', {}]], { 'sdds/one/01-spec.md': 'x\n' });
      try {
        const res = audit(lang, dir, ['--hook']);
        assert.strictEqual(res.status, 0, res.output);
        assert.deepStrictEqual(sddFiles(dir), ['one/01-spec.md']);
      } finally {
        teardown(dir);
      }
    });

    it('--change <name> writes exactly sdds/<name>/05-audit-report.md and audit-receipt.json', () => {
      const dir = project(lang, [['check_ok', {}]], { 'sdds/aaa-first/01-spec.md': 'spec A\n' });
      try {
        const res = audit(lang, dir, ['--change', 'feat-x']);
        assert.strictEqual(res.status, 0, res.output);
        assert.deepStrictEqual(sddFiles(dir), ['aaa-first/01-spec.md', 'feat-x/05-audit-report.md', 'feat-x/audit-receipt.json']);
        assert.match(report(dir, 'feat-x'), /# Code Audit Report: feat-x/);
        assert.strictEqual(receipt(dir, 'feat-x').verdict, 'PASSED');
      } finally {
        teardown(dir);
      }
    });

    it('--change with an explicit targetDir writes under that dir', () => {
      const dir = project(lang, [['check_ok', {}]]);
      try {
        const { orchestrator, cmd } = LANGS[lang];
        const res = spawnSync(cmd, [path.join(dir, 'tools', orchestrator), dir, '--change', 'there'], { cwd: path.dirname(dir), encoding: 'utf-8' });
        assert.strictEqual(res.status, 0, `${res.stdout}${res.stderr}`);
        assert.deepStrictEqual(sddFiles(dir), ['there/05-audit-report.md', 'there/audit-receipt.json']);
      } finally {
        teardown(dir);
      }
    });

    for (const bad of [['--change', '../x'], ['--change', 'a/b'], ['--change', ''], ['--change', '..'], ['--change', '.hidden'], ['--change']]) {
      it(`rejects ${JSON.stringify(bad)} with exit 2 and writes nothing`, () => {
        const dir = project(lang, [['check_ok', {}]]);
        try {
          const res = audit(lang, dir, bad);
          assert.strictEqual(res.status, 2, res.output);
          assert.match(res.stderr, /usage: audit\.(js|py)/i);
          assert.ok(!fs.existsSync(path.join(dir, 'sdds')), 'nothing may be written');
          assert.ok(!fs.existsSync(path.join(dir, 'x')), 'nothing may be written outside sdds/');
        } finally {
          teardown(dir);
        }
      });
    }

    for (const bad of [['--strict'], ['--chnage', 'x'], ['a', 'b'], ['--hook', '--change', 'x']]) {
      it(`rejects ${JSON.stringify(bad)} with exit 2 and usage`, () => {
        const dir = project(lang, [['check_ok', {}]]);
        try {
          const res = audit(lang, dir, bad);
          assert.strictEqual(res.status, 2, res.output);
          assert.match(res.stderr, /usage: audit\.(js|py) \[targetDir\] \[--hook\] \[--change <name>\] \[--staged\]/i);
          assert.doesNotMatch(res.stdout, /AUDIT SUMMARY/, 'no guard may run');
        } finally {
          teardown(dir);
        }
      });
    }

    it('accepts --staged as the default snapshot', () => {
      const dir = project(lang, [['check_ok', {}]]);
      try {
        const res = audit(lang, dir, ['--staged']);
        assert.strictEqual(res.status, 0, res.output);
        assert.ok(!fs.existsSync(path.join(dir, 'sdds')));
      } finally {
        teardown(dir);
      }
    });
  });

  describe(`${label}: non-blocking warnings (sdds/audit-cli items 5-7)`, () => {
    it('a guard result with level warning: exit 0, WARN, PASSED_WITH_WARNINGS', () => {
      const dir = project(lang, [['check_ok', {}], ['check_soft', { exit: 1, level: 'warning', message: 'SOFT_ISSUE' }]]);
      try {
        const res = audit(lang, dir, ['--change', 'w']);
        assert.strictEqual(res.status, 0, res.output);
        assert.match(res.stdout, /⚠️ check soft: SOFT_ISSUE/);
        const r = receipt(dir, 'w');
        assert.strictEqual(r.verdict, 'PASSED_WITH_WARNINGS');
        assert.deepStrictEqual(r.warnings.map((w) => w.name), ['check_soft']);
        assert.strictEqual(r.lenses.architecture.status, 'PASSED_WITH_WARNINGS');
        assert.strictEqual(r.lenses.architecture.failed, 0);
        assert.strictEqual(r.lenses.architecture.warnings, 1);
        const md = report(dir, 'w');
        assert.match(md, /## ⚠️ Warnings/);
        assert.match(md, /\| Warnings \| 1 \|/);

        const hook = audit(lang, dir, ['--hook']);
        assert.strictEqual(hook.status, 0, hook.output);
        assert.match(hook.stdout, /clckernel: WARN check_soft: SOFT_ISSUE/);
      } finally {
        teardown(dir);
      }
    });

    it('severities: { guard: warning } in .clckernel.yaml makes a failure non-blocking', () => {
      const dir = project(lang, [['check_hard', { exit: 1, message: 'HARD_ISSUE' }]], {
        '.clckernel.yaml': 'severities:\n  check_hard: warning\n',
      });
      try {
        const res = audit(lang, dir, ['--change', 'w']);
        assert.strictEqual(res.status, 0, res.output);
        assert.match(res.stdout, /⚠️ check hard: HARD_ISSUE/);
        assert.strictEqual(receipt(dir, 'w').verdict, 'PASSED_WITH_WARNINGS');
        assert.match(audit(lang, dir, ['--hook']).stdout, /clckernel: WARN check_hard/);
      } finally {
        teardown(dir);
      }
    });

    it('severities: { guard: error } overrides a guard that reports level warning', () => {
      const dir = project(lang, [['check_soft', { exit: 1, level: 'warning' }]], {
        '.clckernel.yaml': 'severities:\n  check_soft: error\n',
      });
      try {
        const res = audit(lang, dir, ['--change', 'w']);
        assert.strictEqual(res.status, 1, res.output);
        assert.strictEqual(receipt(dir, 'w').verdict, 'FAILED');
        assert.match(audit(lang, dir, ['--hook']).stdout, /clckernel: FAIL check_soft/);
      } finally {
        teardown(dir);
      }
    });

    it('a crashing guard stays blocking even with severities: warning (fail closed)', () => {
      const dir = project(lang, [['check_boom', { crash: true }]], {
        '.clckernel.yaml': 'severities:\n  check_boom: warning\n',
      });
      try {
        const res = audit(lang, dir, ['--change', 'w']);
        assert.strictEqual(res.status, 1, res.output);
        assert.match(res.stdout, /Guard crashed: KABOOM_check_boom/);
        assert.strictEqual(receipt(dir, 'w').verdict, 'FAILED');
        assert.strictEqual(audit(lang, dir, ['--hook']).status, 1);
      } finally {
        teardown(dir);
      }
    });

    it('a process guard declaring level warning in its JSON is non-blocking', () => {
      const ext = lang === 'js' ? 'js' : 'py';
      const src = ext === 'js'
        ? "console.log(JSON.stringify({ name: 'proc_soft', level: 'warning', data: { message: 'PROC_SOFT' } })); process.exit(1);\n"
        : "import json, sys\nprint(json.dumps({'name': 'proc_soft', 'level': 'warning', 'data': {'message': 'PROC_SOFT'}}))\nsys.exit(1)\n";
      const dir = project(lang, [], { [`tools/guards/proc_soft.${ext}`]: src });
      try {
        const res = audit(lang, dir, ['--hook']);
        assert.strictEqual(res.status, 0, res.output);
        assert.match(res.stdout, /clckernel: WARN proc_soft: PROC_SOFT/);
      } finally {
        teardown(dir);
      }
    });

    it('an invalid severities value stops the audit with the config error', () => {
      const dir = project(lang, [['check_ok', {}]], { '.clckernel.yaml': 'severities:\n  check_ok: loud\n' });
      try {
        const res = audit(lang, dir);
        assert.strictEqual(res.status, 1, res.output);
        assert.match(res.stderr, /severities\.check_ok/);
      } finally {
        teardown(dir);
      }
    });
  });
}

describe('audit.js and audit.py agree (sdds/audit-cli item 9)', () => {
  const scenarios = [
    { name: 'pass', guards: [['check_ok', {}]], args: ['--change', 'p'] },
    { name: 'warning', guards: [['check_soft', { exit: 1, level: 'warning' }]], args: ['--change', 'p'] },
    { name: 'error', guards: [['check_hard', { exit: 1 }]], args: ['--change', 'p'] },
    { name: 'config warning', guards: [['check_hard', { exit: 1 }]], args: ['--change', 'p'], extra: { '.clckernel.yaml': 'severities:\n  check_hard: warning\n' } },
    { name: 'crash', guards: [['check_boom', { crash: true }]], args: ['--change', 'p'], extra: { '.clckernel.yaml': 'severities:\n  check_boom: warning\n' } },
    { name: 'unknown flag', guards: [['check_ok', {}]], args: ['--nope'] },
    { name: 'bad change', guards: [['check_ok', {}]], args: ['--change', '../p'] },
  ];
  for (const s of scenarios) {
    it(`${s.name}: same exit code, verdict and written files`, () => {
      const outcome = {};
      for (const lang of Object.keys(LANGS)) {
        const dir = project(lang, s.guards, s.extra);
        try {
          const res = audit(lang, dir, s.args);
          const files = sddFiles(dir);
          outcome[lang] = { status: res.status, files, verdict: files.length ? receipt(dir, 'p').verdict : null };
        } finally {
          teardown(dir);
        }
      }
      assert.deepStrictEqual(outcome.py, outcome.js);
    });
  }
});

describe('severities in the config schema (sdds/audit-cli item 8)', () => {
  const jsConfig = require('../tools/_config.js');

  function pyValidate(raw) {
    const code = [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})`,
      'import _config',
      'try:',
      '    config, warnings = _config.validate_config(json.loads(sys.argv[1]))',
      '    print(json.dumps({"severities": config["severities"], "warnings": warnings}))',
      'except _config.ConfigError as exc:',
      '    print(json.dumps({"error": exc.key}))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', code, JSON.stringify(raw)], { encoding: 'utf-8' });
    return JSON.parse(res.stdout);
  }

  function jsValidate(raw) {
    try {
      const { config, warnings } = jsConfig.validateConfig(raw);
      return { severities: config.severities, warnings };
    } catch (err) {
      return { error: err.key };
    }
  }

  const cases = [
    [{}, { severities: {}, warnings: [] }],
    [{ severities: { check_custom: 'warning', scan_secrets: 'error' } }, { severities: { check_custom: 'warning', scan_secrets: 'error' }, warnings: [] }],
    [{ severities: { check_custom: 'loud' } }, { error: 'severities.check_custom' }],
    [{ severities: { check_custom: 1 } }, { error: 'severities.check_custom' }],
    [{ severities: ['check_custom'] }, { error: 'severities' }],
  ];
  for (const [raw, expected] of cases) {
    it(`${JSON.stringify(raw)} → ${JSON.stringify(expected)} (JS and Python)`, () => {
      assert.deepStrictEqual(jsValidate(raw), expected);
      assert.deepStrictEqual(pyValidate(raw), expected);
    });
  }

  it('severities is no longer a deprecated key', () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(jsConfig.DEPRECATED_KEYS, 'severities'));
  });
});

describe('clckernel audit --change (sdds/audit-cli item 10)', () => {
  function cli(args, cwd) {
    const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
    return { status: res.status, output: `${res.stdout}${res.stderr}`, stderr: res.stderr };
  }

  it('passes --change through: the report lands in sdds/<name>/', () => {
    const dir = project('js', [['check_ok', {}]], { 'sdds/other/01-spec.md': 'x\n' });
    try {
      const res = cli(['audit', dir, '--change', 'my-change'], path.dirname(dir));
      assert.strictEqual(res.status, 0, res.output);
      assert.deepStrictEqual(sddFiles(dir), ['my-change/05-audit-report.md', 'my-change/audit-receipt.json', 'other/01-spec.md']);
    } finally {
      teardown(dir);
    }
  });

  it('without --change writes nothing', () => {
    const dir = project('js', [['check_ok', {}]], { 'sdds/other/01-spec.md': 'x\n' });
    try {
      const res = cli(['audit', dir], path.dirname(dir));
      assert.strictEqual(res.status, 0, res.output);
      assert.deepStrictEqual(sddFiles(dir), ['other/01-spec.md']);
    } finally {
      teardown(dir);
    }
  });

  it('rejects an unknown flag and a --change without a name', () => {
    const dir = project('js', [['check_ok', {}]]);
    try {
      for (const args of [['audit', dir, '--bogus'], ['audit', dir, '--change']]) {
        const res = cli(args, path.dirname(dir));
        assert.notStrictEqual(res.status, 0, res.output);
        assert.match(res.stderr, /Unknown input/);
      }
      assert.ok(!fs.existsSync(path.join(dir, 'sdds')));
    } finally {
      teardown(dir);
    }
  });
});
