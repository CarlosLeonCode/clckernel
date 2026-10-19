/**
 * sdds/domain-agnostic: the kernel holds no business-domain rules. Domain
 * knowledge lives in the project (tools/guards/), and the kernel runs those
 * project guards with the same contract as its own (hook and audit).
 * Plan TDD items 1-6 (item 7 lives in claims.test.js).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createTmpProject, createGitRepo, teardown, git: gitSync, registryPaths } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const AgentOSAdapter = require('../src/adapters/agent-os');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const LEGACY_DIR = path.join(__dirname, 'fixtures', 'legacy_guards');
const LEGACY_GUARDS = ['check_test_calendar_sync.js', 'check_domain_data.js'];

const SKILL = '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n';
const PLAYBOOK = '# Onboarding\n\n## Human checkpoint\nConfirm each step with the operator.\n';
const AGENT_OS = { 'skills/research/SKILL.md': SKILL, 'playbooks/onboarding.md': PLAYBOOK };

function detect(files) {
  const dir = createTmpProject(files);
  try {
    return autoDetectStack(dir);
  } finally {
    teardown(dir);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// ── Item 1: no domain guard is installed, check_data_files is ────────────────

describe('Agent-OS installs no domain guard', () => {
  for (const calendar of ['content-calendar/calendar.json', 'templates/content-calendar/index.html']) {
    it(`with ${path.dirname(calendar)}/ only generic guards are installed, check_data_files included`, () => {
      const dir = createTmpProject({ ...AGENT_OS, [calendar]: '{}\n' });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'agent-os');
        const result = generateHarness(dir, config);
        const registry = registryPaths(readJson(path.join(dir, 'tools', '.clckernel-managed.json')));
        const hook = fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf-8');
        for (const legacy of ['check_domain_data', 'check_test_calendar_sync']) {
          assert.ok(!result.installedGuards.includes(legacy), `${legacy} must not be installed`);
          assert.ok(!fs.existsSync(path.join(dir, 'tools', `${legacy}.js`)), `${legacy}.js must not be copied`);
          assert.ok(!hook.includes(legacy), `${legacy} must not run in the hook`);
        }
        assert.ok(result.installedGuards.includes('check_data_files'), 'check_data_files must be installed');
        assert.ok(registry.includes('tools/check_data_files.js'), 'check_data_files is a managed file');
        // sdds/unified-discovery: the hook calls audit.js, which runs it.
        assert.ok(hook.includes('node tools/audit.js --hook'), 'the hook runs the JS orchestrator');
        const { planGuards } = require(path.join(dir, 'tools', 'audit.js'));
        assert.ok(planGuards(path.join(dir, 'tools')).some((e) => e.label === 'check_data_files.js'), 'check_data_files runs in the hook');
      } finally {
        teardown(dir);
      }
    });
  }

  it('safeguards and AGENTS.md name no domain (Clean Creation State is generic)', () => {
    const dir = createTmpProject({ ...AGENT_OS, 'content-calendar/calendar.json': '{}\n' });
    try {
      const adapter = new AgentOSAdapter();
      const safeguards = adapter.getSafeguards(dir).join('\n');
      assert.doesNotMatch(safeguards, /calendar|metric/i);
      generateHarness(dir, autoDetectStack(dir));
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.match(agents, /Clean Creation State/);
      assert.match(agents, /`null`/);
      assert.doesNotMatch(agents, /calendar|metric/i);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 2: check_data_files ─────────────────────────────────────────────────

describe('check_data_files', () => {
  const checkDataFiles = () => require('../tools/check_data_files');

  it('a broken JSON file staged in any folder => exit 1 naming the file and the parse error', async () => {
    const dir = createGitRepo({ 'README.md': '# r\n' }, { 'any/where/data.json': '{"a": 1,}\n' });
    try {
      const res = await checkDataFiles()(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.strictEqual(res.name, 'check_data_files');
      assert.strictEqual(res.data.violations.length, 1);
      assert.strictEqual(res.data.violations[0].file, 'any/where/data.json');
      assert.ok(res.data.violations[0].message.length > 0, 'reports the parse error');
      assert.ok(!res.data.violations[0].message.includes('"a": 1,'), 'does not dump the content');
    } finally {
      teardown(dir);
    }
  });

  it('valid JSON staged => exit 0', async () => {
    const dir = createGitRepo({ 'README.md': '# r\n' }, { 'data/a.json': '{"a": [1, 2]}\n', 'b.json': '[]\n' });
    try {
      const res = await checkDataFiles()(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(dir);
    }
  });

  it('broken JSON only in the working copy => exit 0 (reads the snapshot)', async () => {
    const dir = createGitRepo({ 'README.md': '# r\n' }, { 'data/a.json': '{"a": 1}\n' });
    try {
      fs.writeFileSync(path.join(dir, 'data', 'a.json'), '{ broken\n');
      const res = await checkDataFiles()(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(dir);
    }
  });

  it('run as a script it exits with the result code', () => {
    const dir = createGitRepo({ 'README.md': '# r\n' }, { 'x.json': '{\n' });
    try {
      const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'check_data_files.js'), dir], { encoding: 'utf-8' });
      assert.strictEqual(run.status, 1, run.stdout + run.stderr);
      assert.match(run.stdout, /x\.json/);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 3: the hook runs tools/guards/ ──────────────────────────────────────

/** No git variables inherited from a running hook, no user/system git config. */
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

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }
}

/** A JS project guard that uses the snapshot helper and exits with `code`. */
const jsGuard = (code) => [
  "const { changedFiles } = require('../_changes');",
  'const { files } = changedFiles(process.cwd());',
  `console.log('PROJECT_GUARD_X ' + files.length + ' exit ${code}');`,
  `process.exit(${code});`,
  '',
].join('\n');

const PY_GUARD = "print('PROJECT_GUARD_Y ran')\n";

/** Agent-OS repo with the harness installed and committed (the install commit goes through the hook). */
async function installedAgentOs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-project-guards-'));
  write(dir, AGENT_OS);
  await git(dir, 'init', '-q');
  await git(dir, 'config', 'user.name', 'Project Guards');
  await git(dir, 'config', 'user.email', 'guards@example.com');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '--no-verify', '-m', 'project');
  const installed = await run(process.execPath, [CLI, dir, '--yes'], dir);
  assert.strictEqual(installed.status, 0, `install failed:\n${installed.output}`);
  await git(dir, 'add', '-A');
  const first = await run('git', ['commit', '-m', 'install'], dir);
  assert.strictEqual(first.status, 0, `without tools/guards/ the hook must pass:\n${first.output}`);
  return dir;
}

/** Commits the guard files without the hook (setup), then stages an unrelated change. */
async function setGuards(dir, files, change) {
  write(dir, files);
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '--no-verify', '-m', 'guards');
  write(dir, change);
  await git(dir, 'add', '-A');
}

describe('project guards in tools/guards/ run in the hook', () => {
  it('real git commit: a failing JS guard blocks, a passing one lets it through, .py guards run too', async () => {
    const dir = await installedAgentOs();
    try {
      await setGuards(dir, { 'tools/guards/check_x.js': jsGuard(1) }, { 'rules/a.md': '# A\n' });
      const blocked = await run('git', ['commit', '-m', 'blocked'], dir);
      assert.notStrictEqual(blocked.status, 0, `the project guard must block the commit:\n${blocked.output}`);
      assert.match(blocked.output, /PROJECT_GUARD_X 1 exit 1/, `blocked for the wrong reason:\n${blocked.output}`);

      await setGuards(dir, { 'tools/guards/check_x.js': jsGuard(0), 'tools/guards/check_y.py': PY_GUARD }, { 'rules/b.md': '# B\n' });
      const passed = await run('git', ['commit', '-m', 'passes'], dir);
      assert.strictEqual(passed.status, 0, `passing project guards must let the commit through:\n${passed.output}`);
      assert.match(passed.output, /PROJECT_GUARD_X \d+ exit 0/);
      assert.match(passed.output, /PROJECT_GUARD_Y ran/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const shell of ['sh', 'bash']) {
    it(`${shell}: the generated hook blocks on a failing guard and passes otherwise`, async () => {
      const dir = await installedAgentOs();
      try {
        await setGuards(dir, { 'tools/guards/check_x.js': jsGuard(1) }, { 'rules/a.md': '# A\n' });
        const blocked = await run(shell, ['.githooks/pre-commit'], dir);
        assert.notStrictEqual(blocked.status, 0, blocked.output);
        assert.match(blocked.output, /PROJECT_GUARD_X 1 exit 1/, blocked.output);

        await setGuards(dir, { 'tools/guards/check_x.js': jsGuard(0), 'tools/guards/check_y.py': PY_GUARD }, { 'rules/b.md': '# B\n' });
        const passed = await run(shell, ['.githooks/pre-commit'], dir);
        assert.strictEqual(passed.status, 0, passed.output);
        assert.match(passed.output, /PROJECT_GUARD_Y ran/, passed.output);

        fs.rmSync(path.join(dir, 'tools', 'guards'), { recursive: true, force: true });
        const without = await run(shell, ['.githooks/pre-commit'], dir);
        assert.strictEqual(without.status, 0, `no tools/guards/ => the hook works as before:\n${without.output}`);
        fs.mkdirSync(path.join(dir, 'tools', 'guards'));
        const empty = await run(shell, ['.githooks/pre-commit'], dir);
        assert.strictEqual(empty.status, 0, `empty tools/guards/ => the hook works as before:\n${empty.output}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  const STACKS = {
    'single stack (FastAPI)': { 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' },
    'multi-part (Next.js + backend/ FastAPI)': {
      'package.json': JSON.stringify({ name: 'x', private: true, dependencies: { next: '14' } }),
      'backend/requirements.txt': 'fastapi\n',
    },
    'fallback (unknown stack)': { 'README.md': '# r\n' },
  };
  // sdds/unified-discovery: the tools/guards/ loop is gone; the hook calls
  // the audit orchestrators, which discover tools/guards/ themselves.
  for (const [name, files] of Object.entries(STACKS)) {
    it(`${name}: the hook calls the orchestrators, which run tools/guards/`, () => {
      const dir = createTmpProject(files);
      const warn = console.warn;
      try {
        gitSync(dir, 'init', '-q');
        console.warn = () => {};
        const { hook } = generateHarness(dir, autoDetectStack(dir));
        const text = fs.readFileSync(path.join(dir, hook.file), 'utf-8');
        assert.match(text, /^if \[ -f tools\/audit\.js \]; then node tools\/audit\.js --hook; fi$/m);
        assert.match(text, /^if \[ -f tools\/audit\.py \]; then python3 tools\/audit\.py --hook; fi$/m);
        assert.doesNotMatch(text, /tools\/guards/, text);
      } finally {
        console.warn = warn;
        teardown(dir);
      }
    });
  }
});

describe('project guards can import the snapshot helpers', () => {
  it('JS: require("../_changes") and Python: _changes from the parent dir', () => {
    const dir = createGitRepo({ 'README.md': '# r\n' }, { 'data/a.json': '{}\n' });
    try {
      fs.mkdirSync(path.join(dir, 'tools', 'guards'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'tools', '_changes.js'), path.join(dir, 'tools', '_changes.js'));
      fs.copyFileSync(path.join(ROOT, 'tools', '_changes.py'), path.join(dir, 'tools', '_changes.py'));
      fs.writeFileSync(path.join(dir, 'tools', 'guards', 'check_js.js'), jsGuard(0));
      fs.writeFileSync(path.join(dir, 'tools', 'guards', 'check_py.py'), [
        'import pathlib, sys',
        'sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))',
        'from _changes import changed_files',
        'result = changed_files(".")',
        'print("PY_FILES", result["mode"], result["files"])',
        '',
      ].join('\n'));
      const js = spawnSync(process.execPath, ['tools/guards/check_js.js'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(js.status, 0, js.stderr);
      assert.match(js.stdout, /PROJECT_GUARD_X 1 exit 0/);
      const py = spawnSync('python3', ['tools/guards/check_py.py'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(py.status, 0, py.stderr);
      assert.match(py.stdout, /PY_FILES staged \['data\/a.json'\]/);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 4: audit.js / audit.py report project guards ────────────────────────

const AUDIT_GUARDS = {
  // Standard JSON contract, failing.
  'tools/guards/check_json_fail.js': "console.log(JSON.stringify({ exitCode: 1, name: 'check_json_fail', data: { message: 'JSON_FAIL_MESSAGE', violations: [{ file: 'a.md', message: 'bad' }] } }));\nprocess.exit(1);\n",
  // Plain output, passing.
  'tools/guards/check_plain.py': "print('PLAIN_PY_OUTPUT')\n",
};

function auditFixture(orchestrator) {
  const dir = createGitRepo({ 'README.md': '# r\n' });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tools', orchestrator), path.join(dir, 'tools', orchestrator));
  write(dir, AUDIT_GUARDS);
  return dir;
}

describe('audit orchestrators discover tools/guards/', () => {
  for (const [orchestrator, cmd] of [['audit.js', process.execPath], ['audit.py', 'python3']]) {
    it(`${orchestrator} runs and reports every project guard (architecture lens)`, () => {
      const dir = auditFixture(orchestrator);
      try {
        const res = spawnSync(cmd, [path.join('tools', orchestrator), '--change', 'audit-run'], { cwd: dir, encoding: 'utf-8' });
        assert.strictEqual(res.status, 1, `a failing project guard fails the audit:\n${res.stdout}${res.stderr}`);
        assert.match(res.stdout, /check json fail: JSON_FAIL_MESSAGE/, res.stdout);
        assert.match(res.stdout, /check plain: PLAIN_PY_OUTPUT/, res.stdout);
        const report = fs.readFileSync(path.join(dir, 'sdds', 'audit-run', '05-audit-report.md'), 'utf-8');
        const architecture = report.split('## 🏛️ Architecture Lens')[1].split('## ⚡ Performance Lens')[0];
        assert.match(architecture, /Check Json Fail/);
        assert.match(architecture, /Check Plain/);
      } finally {
        teardown(dir);
      }
    });
  }
});

// ── Item 5: update keeps the old domain guards in place (sdds/unified-discovery) ─

function legacyProject(extra = {}) {
  const dir = createTmpProject({ ...AGENT_OS, ...extra });
  generateHarness(dir, autoDetectStack(dir));
  const registryFile = path.join(dir, 'tools', '.clckernel-managed.json');
  // An older install: the registry was a list of paths.
  const registry = registryPaths(readJson(registryFile));
  for (const file of LEGACY_GUARDS) {
    fs.copyFileSync(path.join(LEGACY_DIR, file), path.join(dir, 'tools', file));
    registry.push(`tools/${file}`);
  }
  fs.writeFileSync(registryFile, JSON.stringify(registry.sort(), null, 2) + '\n');
  return dir;
}

describe('update keeps the removed domain guards where they are, as project guards', () => {
  const { updateHarness, runUpdate } = require('../src/updater');

  it('stays in tools/ with the same content, out of the registry, and is reported as retired', async () => {
    const dir = legacyProject();
    const log = console.log;
    const lines = [];
    try {
      console.log = (...args) => lines.push(args.join(' '));
      const result = await runUpdate(dir);
      console.log = log;
      for (const file of LEGACY_GUARDS) {
        const kept = path.join(dir, 'tools', file);
        assert.ok(fs.readFileSync(kept).equals(fs.readFileSync(path.join(LEGACY_DIR, file))), `tools/${file} kept, same content`);
        assert.ok(!fs.existsSync(path.join(dir, 'tools', 'guards', file)), 'never moved');
        assert.ok(result.retiredGuards.includes(`tools/${file}`));
        assert.ok(
          lines.some((l) => l.includes(`tools/${file}`) && l.includes('retired kernel guard kept as project guard')),
          `reports ${file}:\n${lines.join('\n')}`
        );
      }
      const registry = registryPaths(readJson(path.join(dir, 'tools', '.clckernel-managed.json')));
      assert.ok(!registry.some((f) => LEGACY_GUARDS.some((g) => f.endsWith(g))), 'out of the registry');
    } finally {
      console.log = log;
      teardown(dir);
    }
  });

  it('an existing tools/guards/ copy is left alone too (both are project guards)', () => {
    const dir = legacyProject({ 'tools/guards/check_domain_data.js': '// the project version\n' });
    try {
      updateHarness(dir);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'tools', 'guards', 'check_domain_data.js'), 'utf-8'), '// the project version\n');
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'check_domain_data.js')), 'the old file is left in place');
    } finally {
      teardown(dir);
    }
  });

  it('without a registry entry, a published version is recognised and kept in place', () => {
    const dir = createTmpProject({ ...AGENT_OS });
    try {
      generateHarness(dir, autoDetectStack(dir));
      fs.copyFileSync(path.join(LEGACY_DIR, 'check_domain_data.js'), path.join(dir, 'tools', 'check_domain_data.js'));
      const result = updateHarness(dir);
      assert.deepStrictEqual(result.retiredGuards, ['tools/check_domain_data.js']);
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'check_domain_data.js')));
    } finally {
      teardown(dir);
    }
  });

  it('the kept check_test_calendar_sync.js still runs, from tools/, through the orchestrator', () => {
    const dir = legacyProject();
    try {
      updateHarness(dir);
      const direct = spawnSync(process.execPath, ['tools/check_test_calendar_sync.js'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(direct.status, 0, direct.stdout + direct.stderr);
      const { planGuards } = require(path.join(dir, 'tools', 'audit.js'));
      const labels = planGuards(path.join(dir, 'tools')).map((e) => e.label);
      assert.ok(labels.includes('check_test_calendar_sync.js'), labels.join(', '));
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 6: detection without domain keywords ────────────────────────────────

describe('Agent-OS detection names no domain', () => {
  it('package.json with marketing-os and nothing else => not Agent-OS', () => {
    const config = detect({ 'package.json': JSON.stringify({ name: 'acme-marketing-os', keywords: ['marketing-os'] }) });
    assert.notStrictEqual(config.projectType, 'agent-os');
  });

  it('a "marketing operating system" description alone => not Agent-OS', () => {
    const config = detect({ 'package.json': JSON.stringify({ name: 'x', description: 'A marketing operating system' }) });
    assert.notStrictEqual(config.projectType, 'agent-os');
  });

  for (const pkg of [{ name: 'acme-agent-os' }, { name: 'x', keywords: ['ai-agents'] }, { name: 'x', keywords: ['agent-os'] }]) {
    it(`${JSON.stringify(pkg)} => Agent-OS (generic keywords)`, () => {
      assert.strictEqual(detect({ 'package.json': JSON.stringify(pkg) }).projectType, 'agent-os');
    });
  }
});
