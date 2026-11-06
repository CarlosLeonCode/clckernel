/**
 * sdds/update-whats-new: `update` reports the guards released since the
 * version the project was installed or last updated with (from the registry's
 * kernelVersion), with their impact and the command that adopts them, in the
 * terminal and as JSON (`--json`) for agents. Nothing new is installed without
 * --add-guards. One group per item of the TDD plan.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, git } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { readRegistry } = require('../src/io');
const { updateHarness, whatsNew } = require('../src/updater');
const { SAFEGUARD_CATALOG } = require('../src/catalog');
const { compareVersions } = require('../src/version');
const { version: CURRENT } = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const REGISTRY = 'tools/.clckernel-managed.json';
const NEW_IN_2_2_0 = ['check_sql_migrations', 'check_query_efficiency', 'check_mcp_contracts'];
const ANSI_RE = /\x1b\[/;
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

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
const cli = (args) => {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf-8' });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, out: `${res.stdout}${res.stderr}` };
};
const pkg = (deps) => `${JSON.stringify({ name: 'x', private: true, dependencies: deps }, null, 2)}\n`;

const AGENT_OS = {
  'skills/research/SKILL.md': '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n',
  'playbooks/onboarding.md': '# Onboarding\n\n## Human checkpoint\nConfirm each step with the operator.\n',
};
// A Next.js project with Supabase migrations and a data client: check_sql_migrations
// and check_query_efficiency are part of its stack; check_mcp_contracts is not.
const NEXT_SUPABASE = {
  'package.json': pkg({ next: '^15.0.0', '@supabase/supabase-js': '^2.0.0' }),
  'supabase/config.toml': 'project_id = "x"\n',
};

function installed(files) {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  quietly(() => generateHarness(dir, autoDetectStack(dir)));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'install');
  return dir;
}

/** Rewrites the registry's kernelVersion: a project installed or last updated with `version`. */
function setKernelVersion(dir, version) {
  const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
  registry.kernelVersion = version;
  write(dir, REGISTRY, JSON.stringify(registry, null, 2) + '\n');
  return dir;
}

/** Every path under dir (files, dirs, links) except .git, with its content hash. */
function tree(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);
      out.push(`${path.relative(dir, full)}:${stat.isDirectory() ? 'dir' : sha(stat.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full))}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

function copyDir(dir) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-forge-test-copy-'));
  fs.cpSync(dir, copy, { recursive: true, verbatimSymlinks: true });
  return copy;
}

// ── Item 2: readRegistry returns kernelVersion ──────────────────────────────

describe('item 2: readRegistry returns the kernelVersion the registry records', () => {
  const withRegistry = (content, fn) => {
    const dir = createTmpProject(content === undefined ? {} : { [REGISTRY]: content });
    try {
      return fn(readRegistry(dir));
    } finally {
      teardown(dir);
    }
  };

  it('the hashed registry: its kernelVersion string', () => {
    const content = JSON.stringify({ kernelVersion: '2.1.0', files: [{ path: 'tools/audit.js', sha256: 'abc' }] });
    withRegistry(content, (registry) => {
      assert.strictEqual(registry.format, 'hashed');
      assert.strictEqual(registry.kernelVersion, '2.1.0');
    });
  });

  it('null for the list format, no registry, a missing field or a non-string value', () => {
    withRegistry(JSON.stringify(['tools/audit.js']), (registry) => assert.strictEqual(registry.kernelVersion, null));
    withRegistry(undefined, (registry) => assert.strictEqual(registry.kernelVersion, null));
    withRegistry(JSON.stringify({ files: [] }), (registry) => assert.strictEqual(registry.kernelVersion, null));
    withRegistry(JSON.stringify({ kernelVersion: 220, files: [] }), (registry) => assert.strictEqual(registry.kernelVersion, null));
  });

  it('a fresh install records the current version, read back as kernelVersion', () => {
    const dir = installed(AGENT_OS);
    try {
      assert.strictEqual(readRegistry(dir).kernelVersion, CURRENT);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 3: the pure whatsNew function ──────────────────────────────────────

describe('item 3: whatsNew lists the bundled guards released after the installed version', () => {
  const entry = (name, fields) => ({
    name, checks: `${name} checks`, severity: 'error', gate_mode: 'hard', file: `${name}.js`, planned: false, ...fields,
  });
  const CATALOG = [
    entry('baseline_guard'),
    entry('new_hard', { since: '2.3.0', adopt: 'Check the hard prerequisite.' }),
    entry('new_soft', { since: '2.10.0', severity: 'warning', gate_mode: 'advisory', adopt: 'Check the soft prerequisite.' }),
    entry('new_error_advisory', { since: '2.3.0', gate_mode: 'advisory' }),
    entry('same_version', { since: '2.2.0' }),
    entry('older', { since: '2.1.0' }),
    entry('new_planned', { since: '2.3.0', planned: true }),
    entry('new_external', { since: '2.3.0', file: null }),
  ];

  it('filters by since > installed and describes each entry', () => {
    const result = whatsNew({ catalog: CATALOG, installedVersion: '2.2.0', installed: ['new_soft'], offered: ['new_hard', 'new_soft'] });
    assert.deepStrictEqual(result, [
      {
        name: 'new_hard', since: '2.3.0', checks: 'new_hard checks', blocking: true, adopt: 'Check the hard prerequisite.',
        installed: false, inStack: true, command: 'npx clckernel update --add-guards new_hard',
      },
      {
        name: 'new_soft', since: '2.10.0', checks: 'new_soft checks', blocking: false, adopt: 'Check the soft prerequisite.',
        installed: true, inStack: true, command: 'npx clckernel update --add-guards new_soft',
      },
      {
        name: 'new_error_advisory', since: '2.3.0', checks: 'new_error_advisory checks', blocking: false, adopt: null,
        installed: false, inStack: false, command: 'npx clckernel update --add-guards new_error_advisory',
      },
    ]);
  });

  it('excludes planned guards and external CLIs', () => {
    const names = whatsNew({ catalog: CATALOG, installedVersion: '2.0.0', installed: [], offered: [] }).map((e) => e.name);
    assert.ok(!names.includes('new_planned'));
    assert.ok(!names.includes('new_external'));
    assert.ok(!names.includes('baseline_guard'), 'an entry without since is the baseline, never new');
    assert.deepStrictEqual(names, ['new_hard', 'new_soft', 'new_error_advisory', 'same_version', 'older']);
  });

  it('an unknown installed version (null) yields no news', () => {
    assert.deepStrictEqual(whatsNew({ catalog: CATALOG, installedVersion: null, installed: [], offered: [] }), []);
    assert.deepStrictEqual(whatsNew({ catalog: CATALOG, installedVersion: undefined, installed: [], offered: [] }), []);
  });

  it('a malformed installed version (hand-edited registry) yields no news instead of failing the update', () => {
    assert.deepStrictEqual(whatsNew({ catalog: CATALOG, installedVersion: 'garbage', installed: [], offered: [] }), []);
  });

  it('defaults to the real catalog', () => {
    const names = whatsNew({ installedVersion: '2.1.0', installed: [], offered: [] }).map((e) => e.name);
    assert.deepStrictEqual(names, NEW_IN_2_2_0);
  });
});

// ── Item 4: since/adopt in the real catalog ─────────────────────────────────

describe('item 4: the catalog records the version that brought each new guard', () => {
  it('the three guards of 2.2.0 have since 2.2.0', () => {
    for (const name of NEW_IN_2_2_0) {
      assert.strictEqual(SAFEGUARD_CATALOG.find((e) => e.name === name).since, '2.2.0', name);
    }
  });

  it('every since is a valid version not newer than the package', () => {
    const withSince = SAFEGUARD_CATALOG.filter((e) => 'since' in e);
    assert.ok(withSince.length >= 3);
    for (const e of withSince) {
      assert.ok(compareVersions(e.since, CURRENT) <= 0, `${e.name}: since ${e.since} is newer than ${CURRENT}`);
    }
  });

  it('every entry with since has a one-line adopt text', () => {
    for (const e of SAFEGUARD_CATALOG.filter((x) => 'since' in x)) {
      assert.ok(typeof e.adopt === 'string' && e.adopt.trim().length > 0, `${e.name}: adopt`);
      assert.ok(!e.adopt.includes('\n'), `${e.name}: adopt is one line`);
    }
  });
});

// ── Item 5: integration, plan.whatsNew and the text output ──────────────────

describe('item 5: update reports what is new since the installed version', () => {
  it('a project last updated with 2.1.0: plan.whatsNew lists the three guards of 2.2.0, none installed', () => {
    const dir = setKernelVersion(installed(AGENT_OS), '2.1.0');
    try {
      const result = quietly(() => updateHarness(dir, { dryRun: true }));
      assert.deepStrictEqual(result.kernelVersion, { installed: '2.1.0', current: CURRENT });
      assert.deepStrictEqual(result.plan.whatsNew.map((e) => e.name), NEW_IN_2_2_0);
      for (const e of result.plan.whatsNew) {
        assert.strictEqual(e.since, '2.2.0');
        assert.strictEqual(e.installed, false, e.name);
        assert.strictEqual(e.inStack, false, `${e.name}: an agent-os stack does not offer it`);
        assert.strictEqual(e.command, `npx clckernel update --add-guards ${e.name}`);
      }
      const byName = Object.fromEntries(result.plan.whatsNew.map((e) => [e.name, e]));
      assert.strictEqual(byName.check_sql_migrations.blocking, true);
      assert.strictEqual(byName.check_query_efficiency.blocking, false);
      assert.strictEqual(byName.check_mcp_contracts.blocking, true);
      for (const name of NEW_IN_2_2_0) assert.ok(!fs.existsSync(path.join(dir, 'tools', `${name}.js`)), `${name} not installed`);
    } finally {
      teardown(dir);
    }
  });

  it('marks the guards the project has and the ones its stack offers', () => {
    const dir = setKernelVersion(installed(NEXT_SUPABASE), '2.1.0');
    try {
      const result = quietly(() => updateHarness(dir, { dryRun: true }));
      const byName = Object.fromEntries(result.plan.whatsNew.map((e) => [e.name, e]));
      assert.deepStrictEqual(Object.keys(byName), NEW_IN_2_2_0);
      assert.strictEqual(byName.check_sql_migrations.installed, true);
      assert.strictEqual(byName.check_sql_migrations.inStack, true);
      assert.strictEqual(byName.check_query_efficiency.installed, true);
      assert.strictEqual(byName.check_query_efficiency.inStack, true);
      assert.strictEqual(byName.check_mcp_contracts.installed, false);
      assert.strictEqual(byName.check_mcp_contracts.inStack, false);
    } finally {
      teardown(dir);
    }
  });

  it('--add-guards of a new guard: the plan marks it installed', () => {
    const dir = setKernelVersion(installed(AGENT_OS), '2.1.0');
    try {
      const result = quietly(() => updateHarness(dir, { addGuards: ['check_mcp_contracts'] }));
      const byName = Object.fromEntries(result.plan.whatsNew.map((e) => [e.name, e]));
      assert.strictEqual(byName.check_mcp_contracts.installed, true);
      assert.strictEqual(byName.check_sql_migrations.installed, false);
      assert.strictEqual(readRegistry(dir).kernelVersion, CURRENT, 'the update records the new baseline');
    } finally {
      teardown(dir);
    }
  });

  it('the dry-run text shows "New since 2.1.0" with the impact and the command', () => {
    const dir = setKernelVersion(installed(AGENT_OS), '2.1.0');
    try {
      const res = cli(['update', dir, '--dry-run']);
      assert.strictEqual(res.status, 0, res.out);
      assert.match(res.out, new RegExp(`New since 2\\.1\\.0 \\(${CURRENT.replace(/\./g, '\\.')}\\)`));
      assert.match(res.out, /check_sql_migrations — SQL migrations/);
      assert.match(res.out, /\[blocks commits\]/);
      assert.match(res.out, /npx clckernel update --add-guards check_sql_migrations/);
      assert.match(res.out, /npx clckernel update --add-guards check_mcp_contracts/);
    } finally {
      teardown(dir);
    }
  });

  it('a project already on 2.2.0 gets no "New since" section', () => {
    const dir = setKernelVersion(installed(AGENT_OS), '2.2.0');
    try {
      const result = quietly(() => updateHarness(dir, { dryRun: true }));
      assert.deepStrictEqual(result.plan.whatsNew, []);
      const res = cli(['update', dir, '--dry-run']);
      assert.strictEqual(res.status, 0, res.out);
      assert.doesNotMatch(res.out, /New since/);
    } finally {
      teardown(dir);
    }
  });

  it('a registry without kernelVersion gets no "New since" section', () => {
    const dir = installed(AGENT_OS);
    try {
      const registry = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
      delete registry.kernelVersion;
      write(dir, REGISTRY, JSON.stringify(registry, null, 2) + '\n');
      const result = quietly(() => updateHarness(dir, { dryRun: true }));
      assert.deepStrictEqual(result.kernelVersion, { installed: null, current: CURRENT });
      assert.deepStrictEqual(result.plan.whatsNew, []);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 6 (terminal): planLines and the next steps ─────────────────────────

describe('item 6: the terminal section and the next steps', () => {
  const { planLines, updateNextStepsLines, updateNextSteps } = require('../src/ui');
  const plain = (lines) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  const NEWS = [
    { name: 'new_hard', since: '2.3.0', checks: 'Hard checks', blocking: true, adopt: 'Check the hard prerequisite.',
      installed: false, inStack: true, command: 'npx clckernel update --add-guards new_hard' },
    { name: 'new_soft', since: '2.3.0', checks: 'Soft checks', blocking: false, adopt: 'Check the soft prerequisite.',
      installed: true, inStack: true, command: 'npx clckernel update --add-guards new_soft' },
  ];
  const PLAN = {
    written: [], unchanged: [], protected: [], moved: [], removed: [], gitignore: [], gitConfig: [],
    available: ['old_optional', 'new_hard'], mirrorsSkipped: [], trackedNotIgnored: [], detected: [], excluded: [],
    whatsNew: NEWS,
  };

  it('planLines adds "New since <installed> (<current>)" after "Available", with markers, adopt and command', () => {
    const text = plain(planLines(PLAN, { dryRun: true, kernelVersion: { installed: '2.2.0', current: '2.3.0' } }));
    const available = text.indexOf('Available, not installed');
    const news = text.indexOf('New since 2.2.0 (2.3.0)');
    assert.ok(available >= 0 && news > available, text);
    assert.match(text, /new_hard — Hard checks \[blocks commits\]/);
    assert.match(text, /new_soft — Soft checks \(installed\)/);
    assert.doesNotMatch(text, /new_soft — Soft checks \[blocks commits\]/);
    assert.match(text, /Check the hard prerequisite\./);
    assert.match(text, /Check the soft prerequisite\./);
    assert.match(text, /npx clckernel update --add-guards new_hard/);
  });

  it('planLines prints no section without news (install plans have no whatsNew)', () => {
    const { whatsNew: _ignored, ...installPlan } = PLAN;
    assert.doesNotMatch(plain(planLines(installPlan)), /New since/);
    assert.doesNotMatch(plain(planLines({ ...PLAN, whatsNew: [] })), /New since/);
  });

  it('the next steps list the command of each new guard not installed, not repeated in the generic line', () => {
    const text = plain(updateNextStepsLines(PLAN));
    assert.match(text, /Next steps/);
    assert.strictEqual(text.split('npx clckernel update --add-guards new_hard').length - 1, 1, text);
    assert.match(text, /--add-guards old_optional(?!,)/);
    assert.doesNotMatch(text, /--add-guards new_soft/, 'an installed new guard needs no command');
  });

  it('updateNextSteps is the plain-text variant (no ANSI, no header)', () => {
    const steps = updateNextSteps(PLAN);
    assert.ok(Array.isArray(steps) && steps.length === 2, JSON.stringify(steps));
    for (const step of steps) assert.doesNotMatch(step, ANSI_RE);
    assert.ok(steps.some((s) => s.includes('npx clckernel update --add-guards new_hard')));
    assert.ok(steps.some((s) => s.includes('npx clckernel update --add-guards old_optional')));
    assert.ok(!steps.some((s) => /Next steps/.test(s)));
  });
});

// ── Item 6 (--json): one JSON object on stdout ──────────────────────────────

describe('item 6: update --json prints one JSON object', () => {
  it('--dry-run --json: stdout parses as JSON, with no ANSI or banner, and carries the contract', () => {
    const dir = setKernelVersion(installed(AGENT_OS), '2.1.0');
    try {
      const before = tree(dir);
      const res = cli(['update', dir, '--dry-run', '--json']);
      assert.strictEqual(res.status, 0, res.out);
      assert.doesNotMatch(res.stdout, ANSI_RE);
      const out = JSON.parse(res.stdout);
      assert.strictEqual(out.contract, 'clckernel.update-plan/v1');
      assert.strictEqual(out.success, true);
      assert.strictEqual(out.dryRun, true);
      assert.deepStrictEqual(out.kernelVersion, { installed: '2.1.0', current: CURRENT });
      assert.deepStrictEqual(out.whatsNew.map((e) => e.name), NEW_IN_2_2_0);
      assert.ok(Array.isArray(out.plan.written) && Array.isArray(out.plan.unchanged) && Array.isArray(out.plan.protected));
      assert.ok(!('whatsNew' in out.plan), 'whatsNew is reported once, at the top level');
      assert.deepStrictEqual(out.warnings, { config: [], foreignGuards: [] });
      assert.strictEqual(typeof out.preserved, 'object');
      assert.ok(Array.isArray(out.retiredGuards));
      assert.ok(out.legacyCleanup && Array.isArray(out.legacyCleanup.removed));
      assert.ok(Array.isArray(out.nextSteps));
      assert.deepStrictEqual(tree(dir), before, '--dry-run --json writes nothing');
    } finally {
      teardown(dir);
    }
  });

  it('the dry-run JSON plan equals the plan of a real --json run on a copy', () => {
    const dir = setKernelVersion(installed(AGENT_OS), '2.1.0');
    write(dir, 'tools/check_hitl.js', '// edited by the project\n');
    const copy = copyDir(dir);
    try {
      const planned = cli(['update', dir, '--dry-run', '--json']);
      const done = cli(['update', copy, '--json']);
      assert.strictEqual(planned.status, 0, planned.out);
      assert.strictEqual(done.status, 0, done.out);
      const plannedOut = JSON.parse(planned.stdout);
      const doneOut = JSON.parse(done.stdout);
      assert.strictEqual(doneOut.dryRun, false);
      assert.deepStrictEqual(plannedOut.plan, doneOut.plan);
      assert.deepStrictEqual(plannedOut.whatsNew, doneOut.whatsNew);
      assert.ok(doneOut.plan.protected.some((p) => p.path === 'tools/check_hitl.js'));
      assert.ok(doneOut.nextSteps.every((s) => typeof s === 'string' && !ANSI_RE.test(s)));
      assert.ok(doneOut.nextSteps.some((s) => s.includes('npx clckernel update --add-guards check_sql_migrations')), JSON.stringify(doneOut.nextSteps));
      assert.ok(fs.existsSync(path.join(copy, 'tools', 'check_hitl.js.clckernel-new')), 'the real run wrote');
    } finally {
      teardown(dir);
      teardown(copy);
    }
  });

  it('an error prints { contract, success: false, error } on stdout and exits 1', () => {
    const dir = installed(AGENT_OS);
    try {
      const before = tree(dir);
      const res = cli(['update', dir, '--json', '--add-guards', 'check_nonexistent']);
      assert.strictEqual(res.status, 1, res.out);
      assert.doesNotMatch(res.stdout, ANSI_RE);
      const out = JSON.parse(res.stdout);
      assert.strictEqual(out.contract, 'clckernel.update-plan/v1');
      assert.strictEqual(out.success, false);
      assert.match(out.error, /check_nonexistent/);
      assert.deepStrictEqual(tree(dir), before);

      const missing = cli(['update', path.join(dir, 'does-not-exist'), '--json', '--dry-run']);
      assert.strictEqual(missing.status, 1, missing.out);
      assert.strictEqual(JSON.parse(missing.stdout).success, false);
    } finally {
      teardown(dir);
    }
  });

  it('--json twice, or outside update, is rejected without writing', () => {
    const dir = installed(AGENT_OS);
    try {
      const before = tree(dir);
      for (const args of [
        ['update', dir, '--json', '--json'],
        ['update', dir, '--dry-run', '--json', '--json'],
        ['start', '--json'],
        [dir, '--yes', '--json'],
        ['audit', dir, '--json'],
      ]) {
        const res = cli(args);
        assert.strictEqual(res.status, 1, `${args.join(' ')}: ${res.out}`);
        assert.match(res.out, /Unknown input|agent command/, args.join(' '));
      }
      assert.deepStrictEqual(tree(dir), before);
    } finally {
      teardown(dir);
    }
  });
});
