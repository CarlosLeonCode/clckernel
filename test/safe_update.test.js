/**
 * sdds/safe-update: `update` (and a reinstall with --yes) never destroys
 * content the kernel cannot prove is its own and intact; --dry-run writes
 * nothing. One test group per item of the TDD plan.
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
const { updateHarness } = require('../src/updater');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const REGISTRY = 'tools/.clckernel-managed.json';
const SKILL_MD = '.agents/skills/clckernel_cli/SKILL.md';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel));
const readText = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const bundled = (rel) => fs.readFileSync(path.join(ROOT, rel));
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
const cli = (args, cwd) => {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: cwd || ROOT, encoding: 'utf-8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

const AGENT_OS = {
  'skills/research/SKILL.md': '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n',
  'playbooks/onboarding.md': '# Onboarding\n\n## Human checkpoint\nConfirm each step with the operator.\n',
};
const FASTAPI = { 'requirements.txt': 'fastapi\n', 'main.py': 'app = None\n' };

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

/** Every path under dir (files, dirs, links) except .git, for "nothing was created" checks. */
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

/** Installed project with a hashed registry. */
function installed(files, { repo = false } = {}) {
  const dir = repo ? gitRepo(files) : createTmpProject(files);
  quietly(() => generateHarness(dir, autoDetectStack(dir)));
  return dir;
}

function registryOf(dir) {
  return JSON.parse(readText(dir, REGISTRY));
}

function setRegistryHash(dir, rel, hash) {
  const registry = registryOf(dir);
  const entry = registry.files.find((f) => f.path === rel);
  if (entry) entry.sha256 = hash;
  else registry.files.push({ path: rel, sha256: hash });
  write(dir, REGISTRY, JSON.stringify(registry, null, 2) + '\n');
}

// ── Item 1: a locally edited managed file is protected ──────────────────────

describe('item 1: a locally edited kernel file survives update', () => {
  it('tools/audit.js edited after install stays byte-identical; the new version lands in .clckernel-new', () => {
    const dir = installed(AGENT_OS);
    try {
      const edited = '// hardened by the project\n' + readText(dir, 'tools/audit.js');
      write(dir, 'tools/audit.js', edited);
      const result = quietly(() => updateHarness(dir));
      assert.strictEqual(readText(dir, 'tools/audit.js'), edited);
      assert.ok(read(dir, 'tools/audit.js.clckernel-new').equals(bundled('tools/audit.js')));
      assert.ok(result.plan.protected.some((p) => p.path === 'tools/audit.js' && p.newPath === 'tools/audit.js.clckernel-new'));
      assert.ok(!result.plan.written.includes('tools/audit.js'));
    } finally {
      teardown(dir);
    }
  });

  it('the CLI summary lists it as protected, with a visible warning, and exits 0', () => {
    const dir = installed(AGENT_OS);
    try {
      write(dir, 'tools/audit.js', '// mine\n');
      const res = cli(['update', dir]);
      assert.strictEqual(res.status, 0, res.out);
      assert.match(res.out, /Protected/);
      assert.match(res.out, /tools\/audit\.js\.clckernel-new/);
      assert.match(res.out, /Written|Unchanged/);
    } finally {
      teardown(dir);
    }
  });

  it('the consumer .gitignore ignores the *.clckernel-new review copies', () => {
    const dir = installed(AGENT_OS);
    try {
      assert.ok(readText(dir, '.gitignore').split('\n').includes('*.clckernel-new'));
    } finally {
      teardown(dir);
    }
  });

  it('protected files and their review copies stay out of the registry', () => {
    const dir = installed(AGENT_OS);
    try {
      write(dir, 'tools/audit.js', '// mine\n');
      quietly(() => updateHarness(dir));
      const paths = registryOf(dir).files.map((f) => f.path);
      assert.ok(!paths.includes('tools/audit.js'));
      assert.ok(!paths.some((p) => p.endsWith('.clckernel-new')));
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 2 (R5): a project file that only shares a kernel file's name ───────

describe('item 2: a project-owned tools/check_links.js in an Agent-OS survives', () => {
  it('unregistered and different: kept, .clckernel-new written, name collision reported', () => {
    const own = '#!/usr/bin/env node\n// project link checker, not the kernel one\nprocess.exit(0);\n';
    const dir = createTmpProject({ ...AGENT_OS, 'tools/check_links.js': own });
    try {
      const result = quietly(() => updateHarness(dir));
      assert.strictEqual(readText(dir, 'tools/check_links.js'), own);
      assert.ok(read(dir, 'tools/check_links.js.clckernel-new').equals(bundled('tools/check_links.js')));
      const entry = result.plan.protected.find((p) => p.path === 'tools/check_links.js');
      assert.ok(entry, JSON.stringify(result.plan.protected));
      assert.match(entry.reason, /unknown to the kernel/);
    } finally {
      teardown(dir);
    }
  });

  it('a first install with --yes protects it too', () => {
    const own = '// project guard with a kernel name\n';
    const dir = createTmpProject({ ...AGENT_OS, 'tools/check_links.js': own });
    try {
      const res = cli([dir, '--yes']);
      assert.strictEqual(res.status, 0, res.out);
      assert.strictEqual(readText(dir, 'tools/check_links.js'), own);
      assert.ok(exists(dir, 'tools/check_links.js.clckernel-new'));
      assert.match(res.out, /tools\/check_links\.js\.clckernel-new/);
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 3: an old intact install without a registry updates silently ───────

describe('item 3: an intact older install (no registry) is updated without .clckernel-new', () => {
  it('files equal to a published version (known-hashes) are overwritten', () => {
    const dir = installed(AGENT_OS);
    try {
      const oldAudit = '// clckernel audit.js as published by an older release\n';
      const oldSecrets = '// clckernel scan_secrets.js as published by an older release\n';
      write(dir, 'tools/audit.js', oldAudit);
      write(dir, 'tools/scan_secrets.js', oldSecrets);
      fs.rmSync(path.join(dir, REGISTRY));
      const knownHashes = {
        ...require('../src/known-hashes.json'),
        'tools/audit.js': [sha(Buffer.from(oldAudit))],
        'tools/scan_secrets.js': [sha(Buffer.from(oldSecrets))],
      };
      const result = quietly(() => updateHarness(dir, { knownHashes }));
      assert.ok(read(dir, 'tools/audit.js').equals(bundled('tools/audit.js')));
      assert.ok(read(dir, 'tools/scan_secrets.js').equals(bundled('tools/scan_secrets.js')));
      assert.deepStrictEqual(result.plan.protected, []);
      assert.ok(!exists(dir, 'tools/audit.js.clckernel-new'));
    } finally {
      teardown(dir);
    }
  });

  it('the shipped table holds deleted files from the history (the old domain guards)', () => {
    const table = require('../src/known-hashes.json');
    for (const file of ['check_domain_data.js', 'check_test_calendar_sync.js']) {
      const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy_guards', file));
      assert.ok((table[`tools/${file}`] || []).includes(sha(bytes)), `tools/${file}`);
    }
  });

  it('the table lists the current sha256 of every file under tools/ and the skill', () => {
    const table = require('../src/known-hashes.json');
    const stale = [];
    const walk = (rel) => {
      for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else if (!(table[child] || []).includes(sha(fs.readFileSync(path.join(ROOT, child))))) stale.push(child);
      }
    };
    walk('tools');
    walk('.agents/skills/clckernel_cli');
    assert.deepStrictEqual(stale, [], 'src/known-hashes.json is stale: run `node scripts/build-known-hashes.js`');
  });
});

// ── Item 4: registry hashes and the old registry format ─────────────────────

describe('item 4: the registry decides ownership and is migrated to the hashed format', () => {
  it('a file whose sha256 matches the registry is overwritten', () => {
    const dir = installed(AGENT_OS);
    try {
      const stale = '// what the kernel wrote last time\n';
      write(dir, 'tools/audit.js', stale);
      setRegistryHash(dir, 'tools/audit.js', sha(Buffer.from(stale)));
      const result = quietly(() => updateHarness(dir));
      assert.ok(read(dir, 'tools/audit.js').equals(bundled('tools/audit.js')));
      assert.ok(result.plan.written.includes('tools/audit.js'));
      assert.deepStrictEqual(result.plan.protected, []);
    } finally {
      teardown(dir);
    }
  });

  it('a fresh install writes { kernelVersion, files: [{ path, sha256 }] } covering tools, hook and skill', () => {
    const dir = installed(FASTAPI);
    try {
      const registry = registryOf(dir);
      assert.strictEqual(registry.kernelVersion, require('../package.json').version);
      const paths = registry.files.map((f) => f.path);
      assert.deepStrictEqual(paths, [...paths].sort());
      for (const rel of ['tools/audit.py', '.githooks/pre-commit', SKILL_MD, '.agents/skills/clckernel_cli/reference/update.md']) {
        const entry = registry.files.find((f) => f.path === rel);
        assert.ok(entry, `${rel} registered`);
        assert.strictEqual(entry.sha256, sha(read(dir, rel)), `${rel} hash`);
      }
    } finally {
      teardown(dir);
    }
  });

  it('an old list registry is read and rewritten in the new format', () => {
    const dir = installed(FASTAPI);
    try {
      const paths = registryOf(dir).files.map((f) => f.path).filter((p) => p.startsWith('tools/'));
      write(dir, REGISTRY, JSON.stringify([...paths, REGISTRY].sort(), null, 2) + '\n');
      quietly(() => updateHarness(dir));
      const registry = registryOf(dir);
      assert.ok(!Array.isArray(registry));
      assert.ok(registry.files.some((f) => f.path === 'tools/audit.py' && f.sha256 === sha(read(dir, 'tools/audit.py'))));
    } finally {
      teardown(dir);
    }
  });

  it('_changes.js and _changes.py exclude the paths of both registry formats', () => {
    for (const format of ['hashed', 'list']) {
      const dir = gitRepo({ 'README.md': '# r\n' });
      try {
        commitAll(dir, 'base');
        write(dir, 'tools/audit.js', '// kernel\n');
        write(dir, 'app.js', 'x\n');
        const registry = format === 'hashed'
          ? { kernelVersion: '0.0.0', files: [{ path: 'tools/audit.js', sha256: sha(Buffer.from('// kernel\n')) }] }
          : ['tools/.clckernel-managed.json', 'tools/audit.js'];
        write(dir, REGISTRY, JSON.stringify(registry));
        git(dir, 'add', '-A');
        const js = spawnSync(process.execPath, ['-e',
          `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(ROOT, 'tools', '_changes.js'))}).changedFiles(process.argv[1]).files))`, dir],
        { encoding: 'utf-8' });
        assert.strictEqual(js.status, 0, js.stderr);
        assert.deepStrictEqual(JSON.parse(js.stdout), ['app.js'], `js, ${format}`);
        const py = spawnSync('python3', ['-c',
          `import json,sys; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))}); import _changes as c; print(json.dumps(c.changed_files(sys.argv[1])["files"]))`, dir],
        { encoding: 'utf-8' });
        assert.strictEqual(py.status, 0, py.stderr);
        assert.deepStrictEqual(JSON.parse(py.stdout), ['app.js'], `py, ${format}`);
      } finally {
        teardown(dir);
      }
    }
  });
});

// ── Item 5: the hook is generated per project ───────────────────────────────

describe('item 5: the pre-commit hook', () => {
  it('a hand-edited hook is protected', () => {
    const dir = installed(FASTAPI, { repo: true });
    try {
      const edited = readText(dir, '.githooks/pre-commit') + 'echo "project step"\n';
      write(dir, '.githooks/pre-commit', edited);
      const result = quietly(() => updateHarness(dir));
      assert.strictEqual(readText(dir, '.githooks/pre-commit'), edited);
      assert.ok(exists(dir, '.githooks/pre-commit.clckernel-new'));
      assert.ok(result.plan.protected.some((p) => p.path === '.githooks/pre-commit'));
    } finally {
      teardown(dir);
    }
  });

  it('an intact generated hook (registry hash) is updated', () => {
    const dir = installed(FASTAPI, { repo: true });
    try {
      const current = readText(dir, '.githooks/pre-commit');
      const older = current.replace('set -e\n', 'set -e\n# generated by an older release\n');
      write(dir, '.githooks/pre-commit', older);
      setRegistryHash(dir, '.githooks/pre-commit', sha(Buffer.from(older)));
      const result = quietly(() => updateHarness(dir));
      assert.strictEqual(readText(dir, '.githooks/pre-commit'), current);
      assert.ok(!exists(dir, '.githooks/pre-commit.clckernel-new'));
      assert.ok(result.plan.written.includes('.githooks/pre-commit'));
    } finally {
      teardown(dir);
    }
  });

  it('without a registry hash, a hook that differs is protected', () => {
    const dir = installed(FASTAPI, { repo: true });
    try {
      write(dir, '.githooks/pre-commit', '#!/usr/bin/env bash\necho old\n');
      fs.rmSync(path.join(dir, REGISTRY));
      quietly(() => updateHarness(dir));
      assert.strictEqual(readText(dir, '.githooks/pre-commit'), '#!/usr/bin/env bash\necho old\n');
      assert.ok(exists(dir, '.githooks/pre-commit.clckernel-new'));
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 6: --dry-run writes nothing and plans what the real run does ───────

/** A committed install with drift: an edited tool, a stale registered tool, a legacy guard, missing .gitignore entries. */
function driftedRepo() {
  const dir = installed(AGENT_OS, { repo: true });
  write(dir, 'tools/check_hitl.js', '// edited by the project\n');
  const stale = '// stale kernel copy\n';
  write(dir, 'tools/scan_secrets.js', stale);
  setRegistryHash(dir, 'tools/scan_secrets.js', sha(Buffer.from(stale)));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'legacy_guards', 'check_domain_data.js'), path.join(dir, 'tools', 'check_domain_data.js'));
  fs.rmSync(path.join(dir, '.agents', 'skills', 'clckernel_cli', 'reference', 'update.md'));
  write(dir, '.gitignore', 'node_modules/\n');
  commitAll(dir, 'drifted install');
  git(dir, 'config', '--unset', 'core.hooksPath');
  return dir;
}

function copyRepo(dir) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-forge-test-copy-'));
  fs.cpSync(dir, copy, { recursive: true, verbatimSymlinks: true });
  return copy;
}

describe('item 6: --dry-run', () => {
  it('update --dry-run: clean git status, core.hooksPath unchanged, no file or directory created', () => {
    const dir = driftedRepo();
    try {
      const before = tree(dir);
      const res = cli(['update', dir, '--dry-run']);
      assert.strictEqual(res.status, 0, res.out);
      assert.strictEqual(git(dir, 'status', '--porcelain', '--ignored'), '');
      assert.deepStrictEqual(tree(dir), before);
      const hooksPath = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(hooksPath.stdout, '');
      assert.match(res.out, /would protect/i);
      assert.match(res.out, /tools\/check_hitl\.js/);
      assert.match(res.out, /would write/i);
      assert.match(res.out, /core\.hooksPath/);
    } finally {
      teardown(dir);
    }
  });

  it('the dry-run plan equals what a real run on a copy does', () => {
    const dir = driftedRepo();
    const copy = copyRepo(dir);
    try {
      const plannedRun = quietly(() => updateHarness(dir, { dryRun: true }));
      const doneRun = quietly(() => updateHarness(copy));
      const planned = plannedRun.plan;
      const done = doneRun.plan;
      assert.deepStrictEqual(planned, done);
      assert.ok(planned.protected.some((p) => p.path === 'tools/check_hitl.js'));
      assert.ok(planned.written.includes('tools/scan_secrets.js'));
      assert.ok(planned.written.includes('.agents/skills/clckernel_cli/reference/update.md'));
      // sdds/unified-discovery: a retired kernel guard is kept in place, never moved.
      assert.deepStrictEqual(planned.moved, []);
      assert.deepStrictEqual(plannedRun.retiredGuards, ['tools/check_domain_data.js']);
      assert.deepStrictEqual(doneRun.retiredGuards, plannedRun.retiredGuards);
      assert.ok(planned.gitignore.includes('*.clckernel-new'));
      assert.deepStrictEqual(planned.gitConfig, [{ key: 'core.hooksPath', value: '.githooks' }]);
      assert.strictEqual(git(dir, 'status', '--porcelain', '--ignored'), '');
    } finally {
      teardown(dir);
      teardown(copy);
    }
  });

  it('install --yes --dry-run writes nothing', () => {
    const dir = gitRepo(FASTAPI);
    try {
      commitAll(dir, 'app');
      const before = tree(dir);
      const res = cli([dir, '--yes', '--dry-run']);
      assert.strictEqual(res.status, 0, res.out);
      assert.deepStrictEqual(tree(dir), before);
      assert.strictEqual(git(dir, 'status', '--porcelain', '--ignored'), '');
      assert.match(res.out, /would write/i);
      assert.match(res.out, /tools\/audit\.py/);
    } finally {
      teardown(dir);
    }
  });

  it('update still rejects unknown flags', () => {
    const dir = createTmpProject(FASTAPI);
    try {
      const res = cli(['update', dir, '--force']);
      assert.strictEqual(res.status, 1, res.out);
      assert.ok(!exists(dir, 'tools'));
    } finally {
      teardown(dir);
    }
  });
});

// ── Item 7: one write point ─────────────────────────────────────────────────

describe('item 7: no direct fs write outside src/io.js in the install/update files', () => {
  const FILES = ['src/generator.js', 'src/updater.js', 'src/adapters/base.js', 'src/adapters/agent-os.js', 'src/gitignore.js'];
  const WRITE = /\bfs\.(writeFile|copyFile|symlink|rename|unlink|rm|rmdir|appendFile|mkdir|chmod|link|truncate|cp|mkdtemp)(Sync)?\s*\(/;
  const GIT_SET = /\[\s*'config'\s*,\s*'(?!--get)/;

  for (const file of FILES) {
    it(file, () => {
      const offenders = readText(ROOT, file).split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//') && (WRITE.test(line) || GIT_SET.test(line)));
      assert.deepStrictEqual(offenders, [], `${file} writes outside io`);
    });
  }
});

// ── Item 8: an old, locally hardened Agent-OS install ───────────────────────

describe('item 8: an old Agent-OS install with hardened kernel files and its own check_links.js', () => {
  const EDITED = ['tools/audit.js', 'tools/scan_secrets.js', 'tools/check_hitl.js', 'tools/check_symlinks.js', SKILL_MD, '.githooks/pre-commit'];

  function hardenedOldInstall() {
    const dir = installed(AGENT_OS, { repo: true });
    // An older install: list registry, no hashes.
    const list = registryOf(dir).files.map((f) => f.path).filter((p) => p.startsWith('tools/'));
    write(dir, REGISTRY, JSON.stringify([...list, REGISTRY].sort(), null, 2) + '\n');
    for (const rel of EDITED) write(dir, rel, readText(dir, rel) + '\n// hardened locally\n');
    write(dir, 'tools/check_links.js', '#!/usr/bin/env node\n// project link checker\nprocess.exit(0);\n');
    commitAll(dir, 'hardened old install');
    return dir;
  }

  it('update keeps every edited file byte-identical and writes their .clckernel-new', () => {
    const dir = hardenedOldInstall();
    try {
      const before = Object.fromEntries([...EDITED, 'tools/check_links.js'].map((rel) => [rel, read(dir, rel)]));
      const res = cli(['update', dir]);
      assert.strictEqual(res.status, 0, res.out);
      for (const [rel, bytes] of Object.entries(before)) {
        assert.ok(read(dir, rel).equals(bytes), `${rel} must be byte-identical`);
        assert.ok(exists(dir, `${rel}.clckernel-new`), `${rel}.clckernel-new`);
        assert.ok(res.out.includes(`${rel}.clckernel-new`), `summary lists ${rel}`);
      }
      const changed = git(dir, 'status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3));
      for (const rel of Object.keys(before)) assert.ok(!changed.includes(rel), `${rel} shows in git status`);
      assert.ok(!changed.some((p) => p.endsWith('.clckernel-new')), 'review copies are gitignored');
    } finally {
      teardown(dir);
    }
  });
});
