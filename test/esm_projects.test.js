/**
 * sdds/esm-tools-commonjs: the harness's JS guards are CommonJS. In a project
 * whose package.json sets "type": "module", Node would load every tools/*.js
 * as ESM and the guards (and the pre-commit hook) would crash. Install writes
 * a kernel-owned tools/package.json ({ "type": "commonjs" }) so they keep
 * running; doctor detects the ESM case with a fix that works; verify_tdd does
 * not take that marker for a project root.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, createGitRepo, teardown, git } = require('./helpers');
const { generateHarness } = require('../src/generator');
const { autoDetectStack } = require('../src/detector');
const { runDoctor } = require('../src/doctor');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;
const ESM_NEXT = { 'package.json': PACKAGE({ name: 'web', private: true, type: 'module', dependencies: { next: '^16.0.0' } }) };
const MARKER = `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`;

function install(dir) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    generateHarness(dir, autoDetectStack(dir));
  } finally {
    console.warn = warn;
  }
}

function registered(dir) {
  const registry = JSON.parse(fs.readFileSync(path.join(dir, 'tools', '.clckernel-managed.json'), 'utf-8'));
  return registry.files.map((f) => f.path);
}

function gitEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return env;
}

describe('install into a project with "type": "module"', () => {
  it('writes tools/package.json as CommonJS and registers it', () => {
    const dir = createTmpProject(ESM_NEXT);
    try {
      install(dir);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'tools', 'package.json'), 'utf-8'), MARKER);
      assert.ok(registered(dir).includes('tools/package.json'), 'tools/package.json must be in the registry');
    } finally {
      teardown(dir);
    }
  });

  it('the installed audit orchestrator runs instead of crashing on require', () => {
    const dir = createTmpProject(ESM_NEXT);
    try {
      install(dir);
      git(dir, 'init', '-q');
      fs.writeFileSync(path.join(dir, 'clean.txt'), 'nothing to see\n');
      git(dir, 'add', 'clean.txt');
      const res = spawnSync(process.execPath, [path.join(dir, 'tools', 'audit.js'), '--hook'], { cwd: dir, encoding: 'utf-8', env: gitEnv() });
      const out = `${res.stdout}\n${res.stderr}`;
      assert.ok(!/require is not defined|ERR_REQUIRE_ESM/.test(out), `audit.js must load as CommonJS:\n${out}`);
      assert.strictEqual(res.status, 0, out);
    } finally {
      teardown(dir);
    }
  });

  it('keeps a project tools/package.json and writes the kernel version next to it', () => {
    const own = PACKAGE({ name: 'project-tools', private: true });
    const dir = createTmpProject({ ...ESM_NEXT, 'tools/package.json': own });
    try {
      install(dir);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'tools', 'package.json'), 'utf-8'), own);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'tools', 'package.json.clckernel-new'), 'utf-8'), MARKER);
      assert.ok(!registered(dir).includes('tools/package.json'), 'a project file is not registered');
    } finally {
      teardown(dir);
    }
  });

  it('a stack without JS tools gets no tools/package.json', () => {
    const dir = createTmpProject({ 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' });
    try {
      install(dir);
      assert.ok(!fs.existsSync(path.join(dir, 'tools', 'package.json')));
    } finally {
      teardown(dir);
    }
  });
});

describe('doctor in a project with "type": "module"', () => {
  let output;
  let log;
  beforeEach(() => {
    output = [];
    log = console.log;
    console.log = (...args) => output.push(args.join(' '));
  });
  afterEach(() => {
    console.log = log;
  });

  const GUARDS = {
    'tools/audit.js': "require('./check_scan');\n",
    'tools/check_scan.js': "const fs = require('fs');\nmodule.exports = () => fs.existsSync('.');\n",
  };

  it('fails the module-type check and points to clckernel update', () => {
    const dir = createTmpProject({ ...ESM_NEXT, ...GUARDS });
    try {
      runDoctor(dir);
      const line = output.find((l) => l.includes('tools/ JS runs as CommonJS'));
      assert.ok(line && line.includes('[FAIL]'), `expected a failing module-type check:\n${output.join('\n')}`);
      assert.match(line, /package\.json/);
      assert.match(line, /clckernel update/);
    } finally {
      teardown(dir);
    }
  });

  it('tells to fix tools/package.json when that file sets "type": "module"', () => {
    const dir = createTmpProject({ ...ESM_NEXT, ...GUARDS, 'tools/package.json': PACKAGE({ type: 'module' }) });
    try {
      runDoctor(dir);
      const line = output.find((l) => l.includes('tools/ JS runs as CommonJS'));
      assert.ok(line && line.includes('[FAIL]'), output.join('\n'));
      assert.match(line, /tools\/package\.json/);
      assert.match(line, /"type": "commonjs"/);
    } finally {
      teardown(dir);
    }
  });

  it('passes once tools/package.json sets CommonJS', () => {
    const dir = createTmpProject({ ...ESM_NEXT, ...GUARDS, 'tools/package.json': MARKER });
    try {
      runDoctor(dir);
      const line = output.find((l) => l.includes('tools/ JS runs as CommonJS'));
      assert.ok(line && line.includes('[PASS]'), output.join('\n'));
      assert.ok(output.some((l) => l.includes('tool/check_scan.js loads') && l.includes('[PASS]')), output.join('\n'));
    } finally {
      teardown(dir);
    }
  });
});

describe('verify_tdd.js and the kernel tools/package.json', () => {
  it('a managed tools/package.json does not split tools/ into its own project root', () => {
    const registry = PACKAGE({ kernelVersion: '0.0.0', files: [{ path: 'tools/package.json', sha256: 'x' }] });
    const dir = createGitRepo({
      'package.json': PACKAGE({ name: 'app', private: true }),
      'tools/package.json': MARKER,
      'tools/.clckernel-managed.json': registry,
      'tools/guards/check_x.js': 'module.exports = () => 1;\n',
    }, {
      'tools/guards/check_x.js': 'module.exports = () => 1;\nmodule.exports.two = () => 2;\n',
      'test/check_x.test.js': [
        "const { it } = require('node:test');",
        "const assert = require('node:assert');",
        "const check = require('../tools/guards/check_x.js');",
        "it('two', () => assert.strictEqual(check.two(), 2));",
        '',
      ].join('\n'),
    });
    try {
      const res = spawnSync(process.execPath, [path.join(TOOLS, 'verify_tdd.js'), dir], { cwd: dir, encoding: 'utf-8', env: { ...gitEnv(), CLC_TDD_TIMEOUT: '60' } });
      const raw = `${res.stdout}\n${res.stderr}`;
      assert.doesNotMatch(raw, /\[tools\]/, raw);
      assert.strictEqual(res.status, 0, raw);
      assert.match(JSON.parse(res.stdout).data.message, /TDD red->green verified/, raw);
    } finally {
      teardown(dir);
    }
  });
});

describe('Next steps after install name the linter exclusion', () => {
  const { nextStepsLines } = require('../src/ui');
  const hook = { file: '.githooks/pre-commit', active: true };

  it('when tools/package.json was installed', () => {
    const text = nextStepsLines(hook, { written: ['tools/package.json'], unchanged: [] }).join('\n');
    assert.match(text, /tools\/ is CommonJS \(tools\/package\.json\)/);
    assert.match(text, /add tools\/\*\* to its ignores/);
  });

  it('not when no JS tools were installed', () => {
    const text = nextStepsLines(hook, { written: ['tools/audit.py'], unchanged: [] }).join('\n');
    assert.doesNotMatch(text, /tools\/package\.json/);
  });
});
