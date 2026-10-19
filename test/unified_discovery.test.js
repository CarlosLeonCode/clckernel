/**
 * sdds/unified-discovery: the commit hook and `clckernel audit` run exactly
 * the same guards — the kernel guards installed for the project plus every
 * project guard (top-level tools/ guards the kernel does not own, and
 * tools/guards/*) — each exactly once. The hook calls the audit orchestrators
 * with --hook; update never moves or deletes a project's guard.
 * TDD plan items 1-8.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const REGISTRY = 'tools/.clckernel-managed.json';

const SKILL = '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n';
const AGENT_OS = { 'skills/research/SKILL.md': SKILL };
const FASTAPI = { 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' };
const MULTI_PART = {
  'package.json': JSON.stringify({ name: 'web', private: true, dependencies: { next: '14' } }, null, 2) + '\n',
  'backend/requirements.txt': 'fastapi\n',
  'backend/app/__init__.py': '',
};

function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, CI: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf-8', env: cleanEnv(), timeout: 120000 });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}${res.error ? res.error.message : ''}` };
}

function git(dir, ...args) {
  const res = run('git', args, dir);
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed:\n${res.output}`);
  return res.output;
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }
}

/** A repo with the harness installed by the CLI and committed with --no-verify. */
function installed(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-unified-'));
  write(dir, files);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Unified Discovery');
  git(dir, 'config', 'user.email', 'unified@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'project');
  const res = run(process.execPath, [CLI, dir, '--yes'], dir);
  assert.strictEqual(res.status, 0, `install failed:\n${res.output}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'install');
  return dir;
}

/** Commits `files` without the hook, then stages an unrelated harmless change. */
function commitThenStage(dir, files) {
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'setup');
  write(dir, { 'notes.txt': `change ${Date.now()}\n` });
  git(dir, 'add', '-A');
}

/** Marker file outside the repo: one line per guard execution. */
const markOf = (dir) => `${dir}.marks`;

const jsGuard = (mark, name, code = 0) =>
  `require('fs').appendFileSync(${JSON.stringify(mark)}, ${JSON.stringify(name)} + '\\n');\n` +
  `console.log('GUARD_${name.toUpperCase()} exit ${code}');\nprocess.exit(${code});\n`;
const pyGuard = (mark, name, code = 0) =>
  `import sys\n\nwith open(${JSON.stringify(mark)}, "a") as marks:\n    marks.write(${JSON.stringify(name + '\n')})\n` +
  `print("GUARD_${name.toUpperCase()} exit ${code}")\nsys.exit(${code})\n`;

/** The discovery rule, restated independently: every guard file of a project. */
function expectedGuards(dir) {
  const tools = path.join(dir, 'tools');
  const top = fs.readdirSync(tools).filter((f) => {
    const ext = path.extname(f);
    const stem = path.basename(f, ext);
    return (ext === '.js' || ext === '.py') && fs.statSync(path.join(tools, f)).isFile() &&
      (/^(check|scan|verify)_/.test(stem) || stem.endsWith('_guard'));
  });
  const guardsDir = path.join(tools, 'guards');
  const nested = fs.existsSync(guardsDir)
    ? fs.readdirSync(guardsDir).filter((f) => /\.(js|py)$/.test(f)).map((f) => `guards/${f}`)
    : [];
  return [...top, ...nested].sort();
}

/**
 * Makes every kernel guard in tools/ append its file name to the marker
 * when it is loaded (in process) or run (as a process).
 */
function instrumentKernelGuards(dir, mark) {
  for (const file of expectedGuards(dir).filter((f) => !f.startsWith('guards/'))) {
    const full = path.join(dir, 'tools', file);
    const lines = fs.readFileSync(full, 'utf-8').split('\n');
    if (file.endsWith('.js')) {
      const at = lines[0].startsWith('#!') ? 1 : 0;
      lines.splice(at, 0, `require('fs').appendFileSync(${JSON.stringify(mark)}, ${JSON.stringify(file + '\n')});`);
    } else {
      const future = lines.findIndex((l) => l.startsWith('from __future__'));
      const at = future >= 0 ? future + 1 : (lines[0].startsWith('#!') ? 1 : 0);
      lines.splice(at, 0, `open(${JSON.stringify(mark)}, 'a').write(${JSON.stringify(file + '\n')})`);
    }
    fs.writeFileSync(full, lines.join('\n'));
  }
}

function marks(mark) {
  return fs.existsSync(mark) ? fs.readFileSync(mark, 'utf-8').split('\n').filter(Boolean).sort() : [];
}

function readRegistry(dir) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
  return Array.isArray(data) ? data : data.files.map((f) => f.path);
}

function cleanup(dir) {
  teardown(dir);
  fs.rmSync(markOf(dir), { force: true });
}

// ── Items 1 and 2: unmanaged guards block the commit and fail the audit ──────

describe('unmanaged project guards run in the hook and in the audit', () => {
  const cases = [
    { label: 'top-level tools/check_x.js', file: 'tools/check_x.js', guard: jsGuard, name: 'check_x' },
    { label: 'tools/guards/check_y.py (Node stack, no audit.py)', file: 'tools/guards/check_y.py', guard: pyGuard, name: 'check_y' },
  ];
  for (const c of cases) {
    it(`${c.label} failing => real git commit blocked and clckernel audit fails`, () => {
      const dir = installed(AGENT_OS);
      try {
        commitThenStage(dir, { [c.file]: c.guard(markOf(dir), c.name, 1) });
        const commit = run('git', ['commit', '-m', 'blocked'], dir);
        assert.notStrictEqual(commit.status, 0, `the guard must block the commit:\n${commit.output}`);
        assert.match(commit.output, new RegExp(`GUARD_${c.name.toUpperCase()} exit 1`), commit.output);

        const audit = run(process.execPath, [CLI, 'audit', dir], dir);
        assert.notStrictEqual(audit.status, 0, `the audit must fail too:\n${audit.output}`);
        assert.match(audit.output, new RegExp(c.name.replace('_', '.')), audit.output);
      } finally {
        cleanup(dir);
      }
    });
  }
});

// ── Item 3: each guard runs exactly once ─────────────────────────────────────

describe('each guard runs exactly once across the orchestrators', () => {
  const STACKS = {
    'Node stack (Agent-OS)': {
      files: AGENT_OS,
      orchestrators: ['audit.js'],
      project: (m) => ({
        'tools/check_proj.js': jsGuard(m, 'check_proj.js'),
        'tools/guards/g1.js': jsGuard(m, 'guards/g1.js'),
        'tools/guards/g2.py': pyGuard(m, 'guards/g2.py'),
      }),
    },
    'Python stack (FastAPI)': {
      files: FASTAPI,
      orchestrators: ['audit.py'],
      project: (m) => ({
        'tools/check_proj.py': pyGuard(m, 'check_proj.py'),
        'tools/guards/g1.js': jsGuard(m, 'guards/g1.js'),
        'tools/guards/g2.py': pyGuard(m, 'guards/g2.py'),
      }),
    },
    'multi-part repo (Next.js + backend/ FastAPI)': {
      files: MULTI_PART,
      orchestrators: ['audit.js', 'audit.py'],
      project: (m) => ({
        'tools/check_proj.js': jsGuard(m, 'check_proj.js'),
        'tools/check_proj.py': pyGuard(m, 'check_proj.py'),
        'tools/guards/g1.js': jsGuard(m, 'guards/g1.js'),
        'tools/guards/g2.py': pyGuard(m, 'guards/g2.py'),
      }),
    },
  };
  for (const [label, stack] of Object.entries(STACKS)) {
    it(`${label}: one hook run executes every guard once, verify_tdd included`, () => {
      const dir = installed(stack.files);
      const mark = markOf(dir);
      try {
        const tools = fs.readdirSync(path.join(dir, 'tools'));
        assert.deepStrictEqual(tools.filter((f) => /^audit\./.test(f)).sort(), stack.orchestrators);
        instrumentKernelGuards(dir, mark);
        commitThenStage(dir, stack.project(mark));
        const expected = expectedGuards(dir);
        assert.ok(expected.some((f) => f.startsWith('verify_tdd.')), expected.join(', '));

        const hook = run('sh', ['.githooks/pre-commit'], dir);
        assert.deepStrictEqual(marks(mark), expected, `each guard exactly once:\n${hook.output}`);
      } finally {
        cleanup(dir);
      }
    });
  }

  it('a registered kernel guard missing on disk fails the hook (no bypass by deletion)', () => {
    const dir = installed(AGENT_OS);
    try {
      fs.rmSync(path.join(dir, 'tools', 'check_links.js'));
      git(dir, 'add', '-A');
      const hook = run('sh', ['.githooks/pre-commit'], dir);
      assert.notStrictEqual(hook.status, 0, hook.output);
      assert.match(hook.output, /check_links/, hook.output);
    } finally {
      cleanup(dir);
    }
  });
});

// ── Item 4: retired kernel guards stay in place and keep running ─────────────

describe('a retired kernel guard is kept in place as a project guard', () => {
  const { runUpdate } = require('../src/updater');

  it('stays byte-identical in tools/, leaves the registry, is reported, and the hook still runs it', async () => {
    const dir = installed(AGENT_OS);
    const mark = markOf(dir);
    const retired = [
      "const { changedFiles } = require('./_changes');",
      'changedFiles(process.cwd());',
      jsGuard(mark, 'check_retired.js'),
    ].join('\n');
    const log = console.log;
    const lines = [];
    try {
      write(dir, { 'tools/check_retired.js': retired });
      const registryFile = path.join(dir, REGISTRY);
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
      registry.files.push({ path: 'tools/check_retired.js', sha256: crypto.createHash('sha256').update(retired).digest('hex') });
      fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');

      console.log = (...args) => lines.push(args.join(' '));
      const result = await runUpdate(dir);
      console.log = log;

      assert.strictEqual(fs.readFileSync(path.join(dir, 'tools', 'check_retired.js'), 'utf-8'), retired, 'kept in place, same bytes');
      assert.ok(!fs.existsSync(path.join(dir, 'tools', 'guards', 'check_retired.js')), 'never moved');
      assert.ok(!readRegistry(dir).includes('tools/check_retired.js'), 'out of the registry');
      assert.deepStrictEqual(result.retiredGuards, ['tools/check_retired.js']);
      assert.ok(
        lines.some((l) => l.includes('tools/check_retired.js') && l.includes('retired kernel guard kept as project guard')),
        lines.join('\n')
      );

      commitThenStage(dir, {});
      const commit = run('git', ['commit', '-m', 'after update'], dir);
      assert.strictEqual(commit.status, 0, commit.output);
      assert.deepStrictEqual(marks(mark), ['check_retired.js'], 'run once, as a project guard, with its sibling require');
    } finally {
      console.log = log;
      cleanup(dir);
    }
  });
});

// ── Item 5: --hook writes no files ───────────────────────────────────────────

describe('--hook mode writes nothing', () => {
  for (const [orchestrator, cmd] of [['audit.js', process.execPath], ['audit.py', 'python3']]) {
    it(`${orchestrator} --hook creates no sdds/, report or receipt`, () => {
      const dir = createTmpProject({ 'tools/guards/ok.js': 'process.exit(0);\n', 'tools/guards/ok.py': 'import sys\nsys.exit(0)\n' });
      try {
        fs.copyFileSync(path.join(ROOT, 'tools', orchestrator), path.join(dir, 'tools', orchestrator));
        const res = run(cmd, [path.join('tools', orchestrator), '--hook'], dir);
        assert.strictEqual(res.status, 0, res.output);
        assert.ok(!fs.existsSync(path.join(dir, 'sdds')), `--hook must not create sdds/:\n${res.output}`);
        assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['tools']);
      } finally {
        teardown(dir);
      }
    });
  }
});

// ── Items 6 and 7: sh and bash; an orchestrator crash fails the hook ─────────

describe('the generated hook under sh and bash', () => {
  for (const shell of ['sh', 'bash']) {
    it(`${shell}: blocks on a failing project guard and passes otherwise`, () => {
      const dir = installed(AGENT_OS);
      try {
        commitThenStage(dir, { 'tools/check_x.js': jsGuard(markOf(dir), 'check_x', 1) });
        const blocked = run(shell, ['.githooks/pre-commit'], dir);
        assert.notStrictEqual(blocked.status, 0, blocked.output);
        assert.match(blocked.output, /GUARD_CHECK_X exit 1/, blocked.output);

        commitThenStage(dir, { 'tools/check_x.js': jsGuard(markOf(dir), 'check_x', 0) });
        const passed = run(shell, ['.githooks/pre-commit'], dir);
        assert.strictEqual(passed.status, 0, passed.output);
      } finally {
        cleanup(dir);
      }
    });

    const crashes = [
      { label: 'audit.js throws', files: AGENT_OS, orchestrator: 'tools/audit.js', source: "throw new Error('orchestrator boom');\n" },
      { label: 'audit.py raises', files: FASTAPI, orchestrator: 'tools/audit.py', source: "raise RuntimeError('orchestrator boom')\n" },
    ];
    for (const c of crashes) {
      it(`${shell}: ${c.label} => the hook fails`, () => {
        const dir = installed(c.files);
        try {
          commitThenStage(dir, { [c.orchestrator]: c.source });
          const res = run(shell, ['.githooks/pre-commit'], dir);
          assert.notStrictEqual(res.status, 0, res.output);
          assert.match(res.output, /orchestrator boom/, res.output);
        } finally {
          cleanup(dir);
        }
      });
    }
  }
});

// ── Item 8: the hook body ────────────────────────────────────────────────────

describe('generated hooks call the orchestrators instead of listing guards', () => {
  const ORCHESTRATOR_LINES = [
    'if [ -f tools/audit.js ]; then node tools/audit.js --hook; fi',
    'if [ -f tools/audit.py ]; then python3 tools/audit.py --hook; fi',
  ];
  const CASES = {
    FastAPI: FASTAPI,
    'Next.js': { 'package.json': MULTI_PART['package.json'] },
    'Next.js + Docker': { 'package.json': MULTI_PART['package.json'], Dockerfile: 'FROM node:20\n' },
    'multi-part': MULTI_PART,
    generic: { 'README.md': '# r\n' },
  };
  for (const [label, files] of Object.entries(CASES)) {
    it(`${label}: orchestrator lines, no per-guard line, no tools/guards/ loop`, () => {
      const dir = createTmpProject(files);
      const warn = console.warn;
      try {
        spawnSync('git', ['init', '-q'], { cwd: dir, env: cleanEnv() });
        console.warn = () => {};
        const { hook } = generateHarness(dir, autoDetectStack(dir));
        const text = fs.readFileSync(path.join(dir, hook.file), 'utf-8');
        const toolLines = text.split('\n').filter((l) => /(node|python3) tools\//.test(l));
        assert.deepStrictEqual(toolLines, ORCHESTRATOR_LINES, `only the orchestrators run tools/ scripts:\n${text}`);
        assert.match(text, /^\[ -f tools\/audit\.js \] \|\| \[ -f tools\/audit\.py \] \|\| \{ .*exit 1; \}$/m, 'no orchestrator => fail');
        assert.doesNotMatch(text, /tools\/guards/, text);
        assert.doesNotMatch(text, /pipefail|\[\[/, 'POSIX sh only');
      } finally {
        console.warn = warn;
        teardown(dir);
      }
    });
  }

  it('with no orchestrator installed the hook fails (sh)', () => {
    const dir = installed(AGENT_OS);
    try {
      fs.rmSync(path.join(dir, 'tools', 'audit.js'));
      git(dir, 'add', '-A');
      const res = run('sh', ['.githooks/pre-commit'], dir);
      assert.notStrictEqual(res.status, 0, res.output);
      assert.match(res.output, /no audit orchestrator/, res.output);
    } finally {
      cleanup(dir);
    }
  });
});
