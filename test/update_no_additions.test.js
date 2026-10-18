/**
 * sdds/update-no-additions: `update` refreshes what the project already has;
 * it never adds guards, mirrors or .gitignore rules that contradict the
 * project's state unless asked to (--add-guards). One group per TDD item.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, git } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const REGISTRY = 'tools/.clckernel-managed.json';
const HOOK = '.githooks/pre-commit';
const CURSOR_MIRROR = '.cursor/rules/clckernel_context.mdc';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const readText = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
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
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

const AGENT_OS = {
  'skills/research/SKILL.md': '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n',
  'playbooks/onboarding.md': '# Onboarding\n\n## Human checkpoint\nConfirm each step with the operator.\n',
};
const AGENT_OS_GUARDS = [
  'check_symlinks', 'check_hitl', 'check_skills', 'check_links', 'check_placeholders',
  'check_data_files', 'scan_secrets', 'verify_tdd', 'check_custom',
];
// Guards a project chose not to install (it never had them).
const NOT_CHOSEN = ['check_skills', 'check_placeholders', 'check_data_files', 'verify_tdd', 'check_custom'];

function gitRepo(files) {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commitAll(dir, message = 'snapshot') {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '--allow-empty', '-m', message);
}

/** Every path under dir (files, dirs, links) except .git. */
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

function install(dir) {
  quietly(() => generateHarness(dir, autoDetectStack(dir)));
  return dir;
}

function registryOf(dir) {
  return JSON.parse(readText(dir, REGISTRY));
}

/** Deletes the given guards from tools/ and from the registry: a project that never had them. */
function withoutGuards(dir, names) {
  const registry = registryOf(dir);
  for (const name of names) {
    fs.rmSync(path.join(dir, 'tools', `${name}.js`), { force: true });
    registry.files = registry.files.filter((f) => f.path !== `tools/${name}.js`);
  }
  write(dir, REGISTRY, JSON.stringify(registry, null, 2) + '\n');
  return dir;
}

const hookRuns = (dir, name) => readText(dir, HOOK).includes(`tools/${name}.js`);
// The hook this update generated: in place, or next to a protected one.
const newHookRuns = (dir, name) =>
  readText(dir, exists(dir, `${HOOK}.clckernel-new`) ? `${HOOK}.clckernel-new` : HOOK).includes(`tools/${name}.js`);

// ── Item 1: update keeps the project's guard set ────────────────────────────

describe('item 1: update does not add guards the project does not have', () => {
  it('with a registry: missing guards are not installed, are listed as available, and the hook skips them', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      const result = quietly(() => updateHarness(dir));
      for (const name of NOT_CHOSEN) {
        assert.ok(!exists(dir, `tools/${name}.js`), `${name} must not be added`);
        assert.ok(!hookRuns(dir, name), `the hook must not run ${name}`);
        assert.ok(result.plan.available.includes(name), `${name} must be listed as available`);
      }
      for (const name of ['check_symlinks', 'check_hitl', 'check_links', 'scan_secrets']) {
        assert.ok(exists(dir, `tools/${name}.js`));
        assert.ok(hookRuns(dir, name), `the hook must still run ${name}`);
        assert.ok(!result.plan.available.includes(name));
      }
      assert.ok(!registryOf(dir).files.some((f) => f.path === 'tools/check_skills.js'));
    } finally {
      teardown(dir);
    }
  });

  it('without a registry: the guards present in tools/ are the installed set', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      fs.rmSync(path.join(dir, REGISTRY));
      const result = quietly(() => updateHarness(dir));
      for (const name of NOT_CHOSEN) {
        assert.ok(!exists(dir, `tools/${name}.js`), `${name} must not be added`);
        assert.ok(!newHookRuns(dir, name));
        assert.ok(result.plan.available.includes(name));
      }
      assert.ok(newHookRuns(dir, 'check_hitl'));
    } finally {
      teardown(dir);
    }
  });

  it('with an old path-list registry: the guards present in tools/ are the installed set', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      // The old format listed every managed path; it cannot tell what was chosen.
      write(dir, REGISTRY, JSON.stringify(AGENT_OS_GUARDS.map((n) => `tools/${n}.js`)));
      quietly(() => updateHarness(dir));
      for (const name of NOT_CHOSEN) assert.ok(!exists(dir, `tools/${name}.js`));
    } finally {
      teardown(dir);
    }
  });

  it('a present but locally edited (protected) guard stays installed and in the hook, update after update', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      write(dir, 'tools/check_hitl.js', '// the project hardened it\n');
      const first = quietly(() => updateHarness(dir));
      assert.ok(first.plan.protected.some((p) => p.path === 'tools/check_hitl.js'));
      assert.ok(hookRuns(dir, 'check_hitl'));
      quietly(() => updateHarness(dir));
      assert.ok(hookRuns(dir, 'check_hitl'), 'still in the hook although the registry no longer vouches for it');
      assert.strictEqual(readText(dir, 'tools/check_hitl.js'), '// the project hardened it\n');
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 2: --add-guards is the explicit opt-in ─────────────────────────────

describe('item 2: --add-guards', () => {
  it('--add-guards check_skills installs it, registers it, runs it in the hook, and a later update keeps it', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      const result = quietly(() => updateHarness(dir, { addGuards: ['check_skills'] }));
      assert.ok(exists(dir, 'tools/check_skills.js'));
      assert.ok(hookRuns(dir, 'check_skills'));
      assert.ok(registryOf(dir).files.some((f) => f.path === 'tools/check_skills.js'));
      assert.ok(!result.plan.available.includes('check_skills'));
      assert.ok(!exists(dir, 'tools/check_placeholders.js'), 'only the named guard is added');

      const later = quietly(() => updateHarness(dir));
      assert.ok(exists(dir, 'tools/check_skills.js'));
      assert.ok(hookRuns(dir, 'check_skills'));
      assert.ok(!later.plan.available.includes('check_skills'));
    } finally {
      teardown(dir);
    }
  });

  it('--add-guards all installs the whole manifest', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      const result = quietly(() => updateHarness(dir, { addGuards: 'all' }));
      for (const name of AGENT_OS_GUARDS) {
        assert.ok(exists(dir, `tools/${name}.js`), name);
        assert.ok(hookRuns(dir, name), name);
      }
      assert.deepStrictEqual(result.plan.available, []);
    } finally {
      teardown(dir);
    }
  });

  it('the CLI accepts --add-guards <list> (and the = form)', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      const res = cli(['update', dir, '--add-guards', 'check_skills,check_placeholders']);
      assert.strictEqual(res.status, 0, res.out);
      assert.ok(exists(dir, 'tools/check_skills.js'));
      assert.ok(exists(dir, 'tools/check_placeholders.js'));
      assert.ok(!exists(dir, 'tools/check_data_files.js'));
      const eq = cli(['update', dir, '--add-guards=check_data_files']);
      assert.strictEqual(eq.status, 0, eq.out);
      assert.ok(exists(dir, 'tools/check_data_files.js'));
    } finally {
      teardown(dir);
    }
  });

  it('an unknown guard name: clear error, exit 1, nothing written', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      const before = tree(dir);
      const res = cli(['update', dir, '--add-guards', 'check_skills,check_nonexistent']);
      assert.strictEqual(res.status, 1, res.out);
      assert.match(res.out, /check_nonexistent/);
      assert.match(res.out, /unknown guard/i);
      assert.deepStrictEqual(tree(dir), before);
    } finally {
      teardown(dir);
    }
  });

  it('--add-guards without a value is rejected without writing', () => {
    const dir = withoutGuards(install(createTmpProject(AGENT_OS)), NOT_CHOSEN);
    try {
      const before = tree(dir);
      const res = cli(['update', dir, '--add-guards']);
      assert.strictEqual(res.status, 1, res.out);
      assert.deepStrictEqual(tree(dir), before);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 3: mirrors are refreshed, never recreated by update ────────────────

describe('item 3: update never creates a mirror', () => {
  it('a mirror the project deleted is not recreated and is reported as skipped', () => {
    const dir = install(createTmpProject(AGENT_OS));
    try {
      fs.rmSync(path.join(dir, CURSOR_MIRROR));
      fs.rmSync(path.join(dir, '.cursor'), { recursive: true });
      fs.rmSync(path.join(dir, '.windsurfrules'));
      const result = quietly(() => updateHarness(dir));
      assert.ok(!lexists(dir, CURSOR_MIRROR));
      assert.ok(!lexists(dir, '.cursor'), 'no empty directory left behind either');
      assert.ok(!lexists(dir, '.windsurfrules'));
      assert.ok(result.plan.mirrorsSkipped.includes(CURSOR_MIRROR));
      assert.ok(result.plan.mirrorsSkipped.includes('.windsurfrules'));
    } finally {
      teardown(dir);
    }
  });

  it('an existing mirror symlink is refreshed', () => {
    const dir = install(createTmpProject(AGENT_OS));
    try {
      fs.rmSync(path.join(dir, 'CLAUDE.md'));
      fs.symlinkSync('OLD_AGENTS.md', path.join(dir, 'CLAUDE.md'));
      quietly(() => updateHarness(dir));
      assert.strictEqual(fs.readlinkSync(path.join(dir, 'CLAUDE.md')), 'AGENTS.md');
    } finally {
      teardown(dir);
    }
  });

  it('a fresh install still creates every mirror', () => {
    const dir = install(createTmpProject(AGENT_OS));
    try {
      for (const mirror of ['CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', CURSOR_MIRROR,
        '.github/copilot-instructions.md', '.antigravity/rules.md']) {
        assert.ok(fs.lstatSync(path.join(dir, mirror)).isSymbolicLink(), mirror);
      }
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 4: .gitignore respects tracked paths ───────────────────────────────

const ignoreLines = (dir) => (exists(dir, '.gitignore') ? readText(dir, '.gitignore').split('\n') : []);
const TRACKED = {
  ...AGENT_OS,
  'CLAUDE.md': '# The project keeps its own copy\n',
  '.cursor/rules/project.mdc': '# project rules\n',
  '.agents/skills/clckernel_cli/SKILL.md': '# tracked skill\n',
};

describe('item 4: .gitignore never ignores what the project tracks', () => {
  it('install: tracked mirrors and skill get no entry and are reported; untracked ones are added', () => {
    const dir = gitRepo(TRACKED);
    try {
      commitAll(dir);
      const { plan } = quietly(() => generateHarness(dir, autoDetectStack(dir)));
      const lines = ignoreLines(dir);
      for (const entry of ['CLAUDE.md', '.cursor/', '.agents/skills/clckernel_cli/']) {
        assert.ok(!lines.includes(entry), `${entry} is tracked and must not be ignored`);
        assert.ok(plan.trackedNotIgnored.includes(entry), entry);
      }
      for (const entry of ['GEMINI.md', '.cursorrules', '*.clckernel-new', 'sdds/*']) {
        assert.ok(lines.includes(entry), `${entry} is not tracked and must be ignored`);
      }
    } finally {
      teardown(dir);
    }
  });

  it('update: same rule', () => {
    const dir = gitRepo(TRACKED);
    try {
      commitAll(dir);
      const result = quietly(() => updateHarness(dir));
      const lines = ignoreLines(dir);
      for (const entry of ['CLAUDE.md', '.cursor/', '.agents/skills/clckernel_cli/']) {
        assert.ok(!lines.includes(entry), entry);
        assert.ok(result.plan.trackedNotIgnored.includes(entry), entry);
      }
      assert.ok(lines.includes('GEMINI.md'));
    } finally {
      teardown(dir);
    }
  });

  it('outside a git repository every entry is added as before', () => {
    const dir = createTmpProject(TRACKED);
    try {
      const { plan } = quietly(() => generateHarness(dir, autoDetectStack(dir)));
      const lines = ignoreLines(dir);
      for (const entry of ['CLAUDE.md', '.cursor/', '.agents/skills/clckernel_cli/', 'GEMINI.md']) {
        assert.ok(lines.includes(entry), entry);
      }
      assert.deepStrictEqual(plan.trackedNotIgnored, []);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 5: infrastructure follows the installed guards ─────────────────────

describe('item 5: infrastructure is installed when an installed guard needs it', () => {
  it('check_custom works after update although _changes.js and yaml.js were missing', () => {
    const dir = gitRepo(AGENT_OS);
    try {
      install(dir);
      withoutGuards(dir, ['check_skills']);
      for (const helper of ['_changes.js', 'yaml.js']) {
        fs.rmSync(path.join(dir, 'tools', helper));
        const registry = registryOf(dir);
        registry.files = registry.files.filter((f) => f.path !== `tools/${helper}`);
        write(dir, REGISTRY, JSON.stringify(registry, null, 2) + '\n');
      }
      commitAll(dir);
      quietly(() => updateHarness(dir));
      assert.ok(exists(dir, 'tools/_changes.js'));
      assert.ok(exists(dir, 'tools/yaml.js'));
      const res = spawnSync(process.execPath, ['tools/check_custom.js'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 0, `${res.stdout}${res.stderr}`);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 6: --dry-run shows the new sections and writes nothing ─────────────

describe('item 6: --dry-run reports available guards, skipped mirrors and tracked paths', () => {
  it('prints the three sections and leaves the repository untouched', () => {
    const dir = gitRepo(TRACKED);
    try {
      commitAll(dir, 'project');
      install(dir);
      withoutGuards(dir, NOT_CHOSEN);
      fs.rmSync(path.join(dir, '.windsurfrules'));
      commitAll(dir);
      const before = tree(dir);
      const res = cli(['update', dir, '--dry-run']);
      assert.strictEqual(res.status, 0, res.out);
      assert.match(res.out, /available, not installed/i);
      assert.match(res.out, /check_skills/);
      assert.match(res.out, /--add-guards/);
      assert.match(res.out, /not present \(skipped\)/i);
      assert.match(res.out, /\.windsurfrules/);
      assert.match(res.out, /tracked, not ignored/i);
      assert.match(res.out, /\.agents\/skills\/clckernel_cli\//);
      assert.deepStrictEqual(tree(dir), before, 'no file, link or directory created or changed');
      assert.strictEqual(git(dir, 'status', '--porcelain'), '');
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 8: the kernel's own skill obeys the kernel's HITL rule ─────────────

const KERNEL_SKILL = '.agents/skills/clckernel_cli/SKILL.md';
const HITL_SECTION_RE = /^## Human checkpoint\n[\s\S]*?(?=^## |(?![\s\S]))/m;

/** Runs the installed check_hitl with the kernel skill staged as changed. */
function hitlOnStagedKernelSkill(dir) {
  git(dir, 'add', '-f', KERNEL_SKILL);
  const res = spawnSync(process.execPath, ['tools/check_hitl.js'], { cwd: dir, encoding: 'utf-8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe('item 8: check_hitl does not exempt the kernel skill', () => {
  it('the installed kernel skill passes check_hitl when it changes', () => {
    const dir = install(gitRepo(AGENT_OS));
    try {
      assert.match(readText(dir, KERNEL_SKILL), HITL_SECTION_RE, 'the skill declares a Human checkpoint section');
      const res = hitlOnStagedKernelSkill(dir);
      assert.strictEqual(res.status, 0, res.out);
      assert.match(res.out, /"skipped": false/, 'the kernel skill is evaluated, not skipped');
    } finally {
      teardown(dir);
    }
  });

  it('the kernel skill without its HITL section fails check_hitl', () => {
    const dir = install(gitRepo(AGENT_OS));
    try {
      write(dir, KERNEL_SKILL, readText(dir, KERNEL_SKILL).replace(HITL_SECTION_RE, ''));
      const res = hitlOnStagedKernelSkill(dir);
      assert.strictEqual(res.status, 1, res.out);
      assert.match(res.out, /clckernel_cli\/SKILL\.md/);
    } finally {
      teardown(dir);
    }
  });
});
