/**
 * sdds/kernel-bug-protocol: when an agent working in a governed project finds
 * that the bug is in CLC Kernel itself (a kernel guard, the hook, the audit
 * orchestrators, the CLI or the shipped skill), it never patches the kernel
 * file in the project. It offers a temporary config workaround, prepares a
 * bug report and explains the fork + pull request path (or an issue), and
 * waits for the user before anything outward-facing.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, git } = require('./helpers');
const { generateHarness } = require('../src/generator');
const { autoDetectStack } = require('../src/detector');
const { KERNEL_BUG_SECTION } = require('../src/onboarding');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const SKILL_DIR = path.join(ROOT, '.agents', 'skills', 'clckernel_cli');
const PLAYBOOK = path.join(SKILL_DIR, 'reference', 'report-bug.md');
const ADAPTERS_DIR = path.join(ROOT, 'src', 'adapters');
const PKG = require('../package.json');
const REPO_URL = PKG.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const ISSUES_URL = PKG.bugs.url;
const RULE_HEADING = '## If the bug is in CLC Kernel';
const ROW = '| `clckernel report-bug <summary>` |';

const read = (file) => fs.readFileSync(file, 'utf-8');

/** Top-level keys and dotted sub-keys tools/_config.js accepts. */
function configKeys() {
  const source = read(path.join(ROOT, 'tools', '_config.js'));
  const top = JSON.parse(source.match(/const KEYS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const sub = [...source.matchAll(/section\(raw, '([a-z_]+)', \[([^\]]*)\]/g)]
    .flatMap((m) => m[2].split(',').map((k) => `${m[1]}.${k.trim().replace(/'/g, '')}`));
  return new Set([...top, ...sub]);
}

describe('report-bug playbook', () => {
  it('exists', () => {
    assert.ok(fs.existsSync(PLAYBOOK), 'reference/report-bug.md must exist');
  });

  it('decides with the kernel registry and keeps project guards out', () => {
    const text = read(PLAYBOOK);
    assert.match(text, /tools\/\.clckernel-managed\.json/);
    assert.match(text, /tools\/guards\//);
    assert.match(text, /\.clckernel\.yaml/);
  });

  it('forbids patching kernel-owned files in the project', () => {
    const text = read(PLAYBOOK);
    assert.match(text, /Never patch a kernel-owned file/);
    assert.match(text, /\.clckernel-new/);
  });

  it('every workaround key it names is a real .clckernel.yaml key', () => {
    const text = read(PLAYBOOK);
    const keys = configKeys();
    const named = [...text.matchAll(/`(severities|exclude_paths|update\.exclude|tdd\.ignore|[a-z_]+\.[a-z_]+)`/g)]
      .map((m) => m[1])
      .filter((k) => /^(severities|exclude_paths|update\.|tdd\.)/.test(k));
    for (const expected of ['severities', 'exclude_paths', 'update.exclude', 'tdd.ignore']) {
      assert.ok(named.includes(expected), `playbook must name ${expected}`);
    }
    for (const key of named) assert.ok(keys.has(key), `${key} is not a key of tools/_config.js`);
    assert.match(text, /temporary/i);
  });

  it('builds a report with version, reproduction, expected vs actual and no private code', () => {
    const text = read(PLAYBOOK);
    assert.match(text, /npx clckernel --version/);
    assert.match(text, /kernelVersion/);
    assert.match(text, /[Mm]inimal reproduction/);
    assert.match(text, /[Ee]xpected/);
    assert.match(text, /[Aa]ctual/);
    assert.match(text, /placeholder/);
  });

  it('explains fork, clone, branch, AI agent, red→green and pull request', () => {
    const text = read(PLAYBOOK);
    for (const word of [/[Ff]ork/, /git clone/, /git checkout -b/, /pull request/, /failing test/]) {
      assert.match(text, word);
    }
    for (const agent of ['Claude Code', 'Antigravity', 'Cursor', 'Copilot', 'Gemini']) {
      assert.ok(text.includes(agent), `playbook must name ${agent}`);
    }
  });

  it('offers an issue as the alternative and links the URLs from package.json', () => {
    const text = read(PLAYBOOK);
    assert.ok(text.includes(ISSUES_URL), `playbook must link ${ISSUES_URL}`);
    assert.ok(text.includes(REPO_URL), `playbook must link ${REPO_URL}`);
    assert.match(text, /bug_report/);
    assert.match(text, /npm view clckernel/);
  });

  it('has a human checkpoint for outward-facing steps', () => {
    const text = read(PLAYBOOK);
    assert.match(text, /## Human checkpoint/);
    assert.match(text, /explicit approval/);
  });
});

describe('every generated AGENTS.md has the kernel-bug rule', () => {
  it('the shared section names the command, the playbook and the no-patch rule', () => {
    assert.ok(KERNEL_BUG_SECTION.startsWith(RULE_HEADING));
    assert.match(KERNEL_BUG_SECTION, /clckernel report-bug <summary>/);
    assert.match(KERNEL_BUG_SECTION, /reference\/report-bug\.md/);
    assert.match(KERNEL_BUG_SECTION, /[Nn]ever patch/);
    assert.match(KERNEL_BUG_SECTION, /[Ff]ork/);
    assert.match(KERNEL_BUG_SECTION, /issue/);
  });

  const adapters = fs.readdirSync(ADAPTERS_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'base.js')
    .map((f) => ({ file: f, adapter: new (require(path.join(ADAPTERS_DIR, f)))() }));

  for (const { file, adapter } of adapters) {
    it(file, () => {
      const dir = createTmpProject({});
      try {
        adapter.provision(dir, {});
        const text = read(path.join(dir, 'AGENTS.md'));
        assert.ok(text.includes(KERNEL_BUG_SECTION), `${file} AGENTS.md has no kernel-bug section`);
        if (text.includes('Universal Command Interface')) assert.ok(text.includes(ROW), `${file} table has no report-bug row`);
      } finally {
        teardown(dir);
      }
    });
  }

  for (const projectType of ['backend', 'frontend', 'unknown']) {
    it(`fallback ${projectType}`, () => {
      const dir = createTmpProject({});
      const warn = console.warn;
      try {
        console.warn = () => {};
        generateHarness(dir, { projectType, framework: 'Generic', testRunner: 'npm test', adapter: null });
        const text = read(path.join(dir, 'AGENTS.md'));
        assert.ok(text.includes(KERNEL_BUG_SECTION));
        assert.ok(text.includes(ROW));
      } finally {
        console.warn = warn;
        teardown(dir);
      }
    });
  }

  it('multi-part', () => {
    const dir = createTmpProject({ 'package.json': JSON.stringify({ name: 'x', dependencies: { next: '14' } }), 'backend/requirements.txt': 'fastapi\n' });
    const warn = console.warn;
    try {
      git(dir, 'init', '-q');
      const config = autoDetectStack(dir);
      assert.strictEqual(config.parts.length, 2);
      console.warn = () => {};
      generateHarness(dir, config);
      const text = read(path.join(dir, 'AGENTS.md'));
      assert.ok(text.includes(KERNEL_BUG_SECTION));
      assert.ok(text.includes(ROW));
    } finally {
      console.warn = warn;
      teardown(dir);
    }
  });

  it('agent-os table has the report-bug row', () => {
    const dir = createTmpProject({});
    try {
      new (require(path.join(ADAPTERS_DIR, 'agent-os.js')))().provision(dir, {});
      assert.ok(read(path.join(dir, 'AGENTS.md')).includes(ROW));
    } finally {
      teardown(dir);
    }
  });
});

describe('`clckernel report-bug` is an agent command', () => {
  function listAll(dir) {
    const out = [];
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        out.push(path.relative(dir, full));
        if (entry.isDirectory()) walk(full);
      }
    };
    walk(dir);
    return out.sort();
  }

  for (const args of [['report-bug'], ['report-bug', 'x']]) {
    it(`\`clckernel ${args.join(' ')}\` exits 1, points to the issues and writes nothing`, () => {
      const dir = createTmpProject({ 'package.json': '{}\n' });
      try {
        const before = listAll(dir);
        const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, CI: '1' } });
        assert.strictEqual(res.status, 1, res.stdout + res.stderr);
        assert.ok(res.stderr.includes('`report-bug` is an agent command defined in AGENTS.md, not a CLI command'), res.stderr);
        assert.ok(res.stderr.includes(ISSUES_URL), res.stderr);
        assert.deepStrictEqual(listAll(dir), before);
      } finally {
        teardown(dir);
      }
    });
  }

  it('help lists report-bug among the agent commands', () => {
    const res = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf-8' });
    const section = res.stdout.slice(res.stdout.indexOf('AGENT COMMANDS'));
    assert.match(section.split('EXAMPLES')[0], /report-bug/);
  });
});

describe('the skill routes report-bug', () => {
  it('SKILL.md has the command row, the description trigger and a route', () => {
    const skill = read(path.join(SKILL_DIR, 'SKILL.md'));
    assert.match(skill.split('---')[1], /clckernel report-bug/);
    assert.match(skill, /\| `report-bug` \|[^\n]*\[reference\/report-bug\.md\]\(reference\/report-bug\.md\)/);
  });

  it('fix.md switches to report-bug when the root cause is kernel-owned', () => {
    const fix = read(path.join(SKILL_DIR, 'reference', 'fix.md'));
    assert.match(fix, /report-bug\.md/);
    assert.match(fix, /kernel-owned/);
  });
});

describe('docs explain the kernel-bug path', () => {
  const cases = [
    ['README.md', [/clckernel report-bug/, /[Ff]ork/, /pull request/]],
    ['README.es.md', [/clckernel report-bug/, /[Ff]ork/, /pull request/]],
    ['CONTRIBUTING.md', [/## Found a bug while using CLC Kernel in your project\?/, /report-bug/]],
  ];
  for (const [file, patterns] of cases) {
    it(file, () => {
      const text = read(path.join(ROOT, file));
      for (const p of patterns) assert.match(text, p);
    });
  }

  it('CHANGELOG [Unreleased] mentions report-bug', () => {
    const text = read(path.join(ROOT, 'CHANGELOG.md'));
    const unreleased = text.slice(text.indexOf('## [Unreleased]'), text.indexOf('## [2.0.0]'));
    assert.match(unreleased, /### Added[\s\S]*report-bug/);
  });
});
