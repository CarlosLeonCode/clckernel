/**
 * sdds/decision-log: check_journal requires one journal entry
 * (docs/Journal/<YYYY>/<YYYYMMDDTHHMMZ>-<change>.md) for every SDD change
 * audited on the current HEAD, and validates the format of every staged
 * entry. One group per item of the TDD plan (1, 3, 4, 5).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, createGitRepo, stageFiles, teardown, git, plannedGuards } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness, whatsNew } = require('../src/updater');
const { SAFEGUARD_CATALOG, bundledGuard } = require('../src/catalog');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const REGISTRY = 'tools/.clckernel-managed.json';
const GUARD = path.join(TOOLS, 'check_journal.js');

const loadGuard = () => require(GUARD);
const head = (dir) => git(dir, 'rev-parse', 'HEAD').trim();
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const quietly = (fn) => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};

/** An audit receipt of `change` (what `audit --change` writes) naming commit `hash`. */
function receipt(dir, change, hash, name = 'audit-receipt.json') {
  write(dir, `sdds/${change}/${name}`, `${JSON.stringify({ contract: 'clckernel.audit-receipt/v1', commitHash: hash, verdict: 'PASSED' }, null, 2)}\n`);
}

/** A valid entry of `change`, with options to break one part of it. */
function entry(change, { frontmatterChange = change, sections = ['Context', 'Decision', 'Alternatives', 'Consequences'], extraLines = 0 } = {}) {
  const lines = ['---'];
  if (frontmatterChange !== null) lines.push(`change: ${frontmatterChange}`);
  lines.push('date: 2026-11-06T12:00:00Z', '---', '', `# ${change}`, '');
  for (const section of sections) lines.push(`## ${section}`, `The ${section.toLowerCase()} of the change.`, '');
  for (let i = 0; i < extraLines; i++) lines.push(`Line ${i}.`);
  return `${lines.join('\n')}\n`;
}

const ENTRY = (change, stamp = '20261106T1200Z') => `docs/Journal/${stamp.slice(0, 4)}/${stamp}-${change}.md`;

/** A repository with an initial commit (sdds/.gitkeep, as install leaves it) and `staged` files staged. */
function repo(staged = {}, committed = {}) {
  return createGitRepo({ 'README.md': '# x\n', 'sdds/.gitkeep': '', ...committed }, staged);
}

async function runIn(dir) {
  return loadGuard()(dir);
}

const messages = (res) => res.data.violations.map((v) => v.message).join('\n');

// ── Item 1: the guard on temporary git repositories ─────────────────────────

describe('item 1: check_journal requires an entry for the change audited on HEAD', () => {
  it('without sdds/ it is skipped, exit 0, and says why', async () => {
    const dir = createGitRepo({ 'README.md': '# x\n' }, { 'src/a.js': 'module.exports = 1;\n' });
    try {
      const res = await runIn(dir);
      assert.strictEqual(res.name, 'check_journal');
      assert.strictEqual(res.exitCode, 0);
      assert.strictEqual(res.skipped, true);
      assert.match(res.data.message, /sdds\//);
    } finally {
      teardown(dir);
    }
  });

  it('without a commit yet it is skipped and says why', async () => {
    const dir = createTmpProject({ 'sdds/.gitkeep': '' });
    try {
      git(dir, 'init', '-q');
      stageFiles(dir, { 'src/a.js': 'module.exports = 1;\n' });
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 0);
      assert.strictEqual(res.skipped, true);
      assert.match(res.data.message, /no commit/i);
    } finally {
      teardown(dir);
    }
  });

  it('a receipt of X naming HEAD and no entry: exit 1, naming X and the command', async () => {
    const dir = repo({ 'src/a.js': 'module.exports = 1;\n' });
    try {
      receipt(dir, 'add-cache', head(dir));
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 1, JSON.stringify(res));
      assert.strictEqual(res.skipped, false);
      assert.match(messages(res), /add-cache/);
      assert.match(messages(res), /npx clckernel journal add-cache/);
    } finally {
      teardown(dir);
    }
  });

  it('the JS and Python receipts of a mixed stack count the same', async () => {
    const dir = repo({ 'src/a.js': 'module.exports = 1;\n' });
    try {
      receipt(dir, 'mixed', head(dir), 'audit-receipt.py.json');
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.match(messages(res), /npx clckernel journal mixed/);
    } finally {
      teardown(dir);
    }
  });

  it('the entry of X staged: passes', async () => {
    const dir = repo({ 'src/a.js': 'module.exports = 1;\n', [ENTRY('add-cache')]: entry('add-cache') });
    try {
      receipt(dir, 'add-cache', head(dir));
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(dir);
    }
  });

  it('the entry of X already in HEAD: passes', async () => {
    const dir = repo({}, { [ENTRY('add-cache')]: entry('add-cache') });
    try {
      stageFiles(dir, { 'src/a.js': 'module.exports = 1;\n' });
      receipt(dir, 'add-cache', head(dir));
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(dir);
    }
  });

  it('a receipt naming another commit (an older change) is ignored', async () => {
    const dir = repo({ 'src/a.js': 'module.exports = 1;\n' });
    try {
      receipt(dir, 'old-change', '0123456789abcdef0123456789abcdef01234567');
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(dir);
    }
  });

  it('an entry of another change does not stand in for X', async () => {
    const dir = repo({ 'src/a.js': 'module.exports = 1;\n', [ENTRY('other')]: entry('other') });
    try {
      receipt(dir, 'add-cache', head(dir));
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 1);
      assert.match(messages(res), /add-cache/);
    } finally {
      teardown(dir);
    }
  });
});

describe('item 1: check_journal validates the staged entries', () => {
  const cases = [
    ['an invalid name', 'docs/Journal/2026/notes.md', entry('notes'), /name/i],
    ['a year folder that is not the timestamp year', 'docs/Journal/2025/20261106T1200Z-x.md', entry('x'), /name|year/i],
    ['no `change` in the frontmatter', ENTRY('x'), entry('x', { frontmatterChange: null }), /change/],
    ['a `change` that is not the one of the file name', ENTRY('x'), entry('x', { frontmatterChange: 'y' }), /change/],
    ['a missing section', ENTRY('x'), entry('x', { sections: ['Context', 'Decision', 'Consequences'] }), /## Alternatives/],
    ['more than max_lines lines', ENTRY('x'), entry('x', { extraLines: 80 }), /max_lines|80/],
  ];
  for (const [label, file, content, reason] of cases) {
    it(`${label}: exit 1 with the reason`, async () => {
      const dir = repo({ [file]: content });
      try {
        const res = await runIn(dir);
        assert.strictEqual(res.exitCode, 1, `${label}: ${JSON.stringify(res)}`);
        assert.ok(res.data.violations.some((v) => v.file === file), JSON.stringify(res.data.violations));
        assert.match(messages(res), reason);
      } finally {
        teardown(dir);
      }
    });
  }

  it('a valid entry passes on its own', async () => {
    const dir = repo({ [ENTRY('x')]: entry('x') });
    try {
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(dir);
    }
  });

  it('the numbered ADRs and templates at the root of docs/Journal/ are not validated', async () => {
    const dir = repo({
      'docs/Journal/003-adr-something.md': '# ADR 003\n\nNo journal sections here.\n',
      'docs/Journal/templates/ADR-template.md': '# Template\n',
    });
    try {
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(dir);
    }
  });

  it('journal.dir and journal.max_lines come from .clckernel.yaml', async () => {
    const config = 'journal:\n  dir: notes/log\n  max_lines: 12\n';
    const dir = repo({ 'notes/log/2026/20261106T1200Z-x.md': entry('x') }, { '.clckernel.yaml': config });
    try {
      const res = await runIn(dir);
      assert.strictEqual(res.exitCode, 1, JSON.stringify(res));
      assert.match(messages(res), /12/);
    } finally {
      teardown(dir);
    }
    const custom = repo({ 'src/a.js': 'module.exports = 1;\n', 'notes/log/2026/20261106T1200Z-x.md': entry('x') }, { '.clckernel.yaml': 'journal:\n  dir: notes/log\n' });
    try {
      receipt(custom, 'x', head(custom));
      const res = await runIn(custom);
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
    } finally {
      teardown(custom);
    }
  });
});

// ── Item 1 (orchestrator): severities and the Python orchestrator ───────────

const JS_TOOLS = ['audit.js', 'check_journal.js', '_changes.js', '_config.js', 'yaml.js'];

describe('item 1: the audit orchestrators run it and honour severities', () => {
  it('audit.js --hook blocks without the entry', () => {
    const dir = createGitRepo({ 'README.md': '# x\n', 'sdds/.gitkeep': '', 'tools/.keep': '' }, { 'src/a.js': 'module.exports = 1;\n' });
    try {
      for (const file of JS_TOOLS) fs.copyFileSync(path.join(TOOLS, file), path.join(dir, 'tools', file));
      receipt(dir, 'add-cache', head(dir));
      const res = spawnSync(process.execPath, ['tools/audit.js', '--hook'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 1, `${res.stdout}${res.stderr}`);
      assert.match(res.stdout, /check_journal/);
      assert.match(res.stdout, /add-cache/);
    } finally {
      teardown(dir);
    }
  });

  it('severities: { check_journal: warning } reports it without blocking', () => {
    const dir = createGitRepo(
      { 'README.md': '# x\n', 'sdds/.gitkeep': '', 'tools/.keep': '', '.clckernel.yaml': 'severities:\n  check_journal: warning\n' },
      { 'src/a.js': 'module.exports = 1;\n' },
    );
    try {
      for (const file of JS_TOOLS) fs.copyFileSync(path.join(TOOLS, file), path.join(dir, 'tools', file));
      receipt(dir, 'add-cache', head(dir));
      const res = spawnSync(process.execPath, ['tools/audit.js', '--hook'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 0, `${res.stdout}${res.stderr}`);
      assert.match(res.stdout, /WARN.*check_journal|check_journal.*WARN/i);
    } finally {
      teardown(dir);
    }
  });

  it('item 4: audit.py without audit.js runs check_journal.js with node and blocks without the entry', () => {
    const dir = createGitRepo({ 'README.md': '# x\n', 'sdds/.gitkeep': '', 'tools/.keep': '' }, { 'src/a.js': 'module.exports = 1;\n' });
    try {
      for (const file of ['audit.py', '_config.py', '_yaml.py', 'check_journal.js', '_changes.js', '_config.js', 'yaml.js']) {
        fs.copyFileSync(path.join(TOOLS, file), path.join(dir, 'tools', file));
      }
      receipt(dir, 'add-cache', head(dir));
      const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
      const blocked = spawnSync('python3', ['tools/audit.py', '--hook'], { cwd: dir, encoding: 'utf-8', env });
      assert.strictEqual(blocked.status, 1, `${blocked.stdout}${blocked.stderr}`);
      assert.match(blocked.stdout, /check_journal/);

      stageFiles(dir, { [ENTRY('add-cache')]: entry('add-cache') });
      const passed = spawnSync('python3', ['tools/audit.py', '--hook'], { cwd: dir, encoding: 'utf-8', env });
      assert.strictEqual(passed.status, 0, `${passed.stdout}${passed.stderr}`);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 3: catalog and update ──────────────────────────────────────────────

describe('item 3: catalog entry and update --add-guards check_journal', () => {
  const NEXT = `${JSON.stringify({ name: 'web', private: true, dependencies: { next: '^15.0.0' } })}\n`;
  const installed = (files) => {
    const dir = createTmpProject(files);
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    quietly(() => generateHarness(dir, autoDetectStack(dir)));
    return dir;
  };

  it('the catalog entry: since 2.3.0, optional (manifest false), blocking, JS-only', () => {
    const e = SAFEGUARD_CATALOG.find((x) => x.name === 'check_journal');
    assert.ok(e, 'check_journal is in the catalog');
    assert.strictEqual(e.since, '2.3.0');
    assert.strictEqual(e.manifest, false);
    assert.strictEqual(e.severity, 'error');
    assert.strictEqual(e.gate_mode, 'hard');
    assert.strictEqual(e.applies_when, 'always');
    assert.strictEqual(e.lens, 'correctness');
    assert.strictEqual(e.file, 'check_journal.js');
    assert.deepStrictEqual([...e.config_keys], ['journal', 'exclude_paths', 'guard_exclude']);
    assert.strictEqual(bundledGuard('check_journal').path, 'check_journal.js');
    assert.strictEqual(bundledGuard('check_journal').command, 'node tools/check_journal.js');
    assert.match(e.adopt, /journal/);
    assert.match(e.adopt, /sdds\//);
  });

  it('with a registry at 2.2.1, whatsNew lists it as blocking', () => {
    const news = whatsNew({ installedVersion: '2.2.1', installed: [], offered: [] });
    const item = news.find((x) => x.name === 'check_journal');
    assert.ok(item, JSON.stringify(news));
    assert.strictEqual(item.blocking, true);
    assert.strictEqual(item.command, 'npx clckernel update --add-guards check_journal');
  });

  it('a fresh install does not bring it', () => {
    const dir = installed({ 'package.json': NEXT });
    try {
      assert.ok(!fs.existsSync(path.join(dir, 'tools', 'check_journal.js')));
    } finally {
      teardown(dir);
    }
  });

  it('update --add-guards check_journal installs it, records it and the hook runs it', () => {
    const dir = installed({ 'README.md': '# A project of an unknown stack\n' });
    try {
      quietly(() => updateHarness(dir, { addGuards: ['check_journal'] }));
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'check_journal.js')));
      const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
      assert.ok(registry.extraGuards.includes('check_journal'), JSON.stringify(registry.extraGuards));
      assert.ok(plannedGuards(dir).includes('check_journal.js'), 'the hook (audit orchestrator) runs it');
    } finally {
      teardown(dir);
    }
  });

  it('in a stack with section 2, AGENTS.md shows its line', () => {
    const dir = installed({ 'package.json': NEXT });
    try {
      quietly(() => updateHarness(dir, { addGuards: ['check_journal'] }));
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      const { checks } = SAFEGUARD_CATALOG.find((x) => x.name === 'check_journal');
      assert.ok(agents.includes(`${checks} (check_journal)`), agents);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 5: the `journal` config key, JS/Python parity ──────────────────────

describe('item 5: the journal key in tools/_config.js and tools/_config.py', () => {
  const { validateConfig } = require('../tools/_config.js');

  it('defaults: dir docs/Journal, max_lines 80', () => {
    assert.deepStrictEqual(validateConfig({}, '.clckernel.yaml').config.journal, { dir: 'docs/Journal', max_lines: 80 });
  });

  it('accepts a folder inside the project and a positive integer; rejects the rest with the key', () => {
    assert.deepStrictEqual(validateConfig({ journal: { dir: 'notes/log/', max_lines: 40 } }).config.journal, { dir: 'notes/log', max_lines: 40 });
    const bad = [
      [{ journal: { dir: '../outside' } }, 'journal.dir'],
      [{ journal: { dir: '/abs' } }, 'journal.dir'],
      [{ journal: { dir: '' } }, 'journal.dir'],
      [{ journal: { dir: 3 } }, 'journal.dir'],
      [{ journal: { max_lines: 0 } }, 'journal.max_lines'],
      [{ journal: { max_lines: 'many' } }, 'journal.max_lines'],
      [{ journal: { max_lines: 2.5 } }, 'journal.max_lines'],
      [{ journal: { max_lines: true } }, 'journal.max_lines'],
      [{ journal: { index: true } }, 'journal.index'],
      [{ journal: [] }, 'journal'],
    ];
    for (const [raw, key] of bad) {
      assert.throws(() => validateConfig(raw, '.clckernel.yaml'), (err) => err.key === key, key);
    }
  });

  it('the Python twin returns the same config and error keys', () => {
    const cases = [
      {},
      { journal: { dir: 'notes/log/', max_lines: 40 } },
      { journal: { dir: './docs/Journal' } },
      { journal: { dir: '../outside' } },
      { journal: { dir: '' } },
      { journal: { max_lines: 0 } },
      { journal: { max_lines: true } },
      { journal: { max_lines: 2.5 } },
      { journal: { index: true } },
      { journal: [] },
    ];
    const js = cases.map((raw) => {
      try {
        return { journal: validateConfig(raw, '.clckernel.yaml').config.journal };
      } catch (err) {
        return { error: err.key };
      }
    });
    const res = spawnSync('python3', ['-c', [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
      'import _config',
      'out = []',
      'for raw in json.loads(sys.argv[1]):',
      '    try:',
      '        config, _ = _config.validate_config(raw, ".clckernel.yaml")',
      '        out.append({"journal": config["journal"]})',
      '    except _config.ConfigError as err:',
      '        out.append({"error": err.key})',
      'print(json.dumps(out))',
    ].join('\n'), JSON.stringify(cases)], { encoding: 'utf-8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout), js);
  });
});

describe('check_journal — change name rule stays in step with audit --change', () => {
  it('check_journal.js, audit.js and audit.py use the same CHANGE_NAME pattern', () => {
    const source = (file, re) => {
      const m = re.exec(fs.readFileSync(path.join(TOOLS, file), 'utf-8'));
      assert.ok(m, `${file}: CHANGE_NAME not found`);
      return m[1];
    };
    const jsRule = /const CHANGE_NAME = \/(.+)\/;/;
    const journal = source('check_journal.js', jsRule);
    assert.strictEqual(source('audit.js', jsRule), journal);
    assert.strictEqual(source('audit.py', /CHANGE_NAME = re\.compile\(r"(.+)"\)/), journal);
  });
});
