/**
 * tools/verify_tdd.js must prove red→green for JS/TS changes (vitest, jest or
 * node:test), evaluated on the staged content (or HEAD~1 → HEAD when nothing
 * is staged), never on the working copy. Twin of verify_tdd_red_green.test.js.
 * Each scenario builds a throwaway git repo with a tiny Node package.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const verifyTdd = path.join(ROOT, 'tools', 'verify_tdd.js');

const BASE_SUM = 'exports.add = (a, b) => a + b;\n';
const MUL_SUM = `${BASE_SUM}exports.mul = (a, b) => a * b;\n`;
const BROKEN_MUL_SUM = `${BASE_SUM}exports.mul = (a, b) => a + b;\n`;
const TEST_HEADER = "const { test } = require('node:test');\nconst assert = require('node:assert');\n" +
  "const sum = require('../lib/sum');\n";
const BASE_TEST = `${TEST_HEADER}\ntest('add', () => {\n  assert.strictEqual(sum.add(2, 3), 5);\n});\n`;
const MUL_TEST = `${BASE_TEST}\ntest('mul', () => {\n  assert.strictEqual(sum.mul(2, 3), 6);\n});\n`;

/** Stand-in for vitest/jest: drops the runner-specific flags and runs node --test. */
const FAKE_RUNNER = (label) => `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
console.log('FAKE-${label} ' + args.join(' '));
const files = args.filter((a) => a !== 'run' && a !== '--runTestsByPath');
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
`;

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function write(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Repo with one base commit: lib/sum.js + test/sum.test.js; node_modules is ignored. */
function createRepo({ devDependencies } = {}) {
  const pkg = { name: 'calc', version: '1.0.0', private: true };
  if (devDependencies) pkg.devDependencies = devDependencies;
  const dir = createTmpProject({
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    '.gitignore': 'node_modules/\n',
    'lib/sum.js': BASE_SUM,
    'test/sum.test.js': BASE_TEST,
    'node_modules/marker.txt': 'installed dependencies live here\n',
  });
  for (const bin of Object.keys(devDependencies || {})) {
    const file = path.join(dir, 'node_modules', '.bin', bin);
    write(dir, path.join('node_modules', '.bin', bin), FAKE_RUNNER(bin.toUpperCase()));
    fs.chmodSync(file, 0o755);
  }
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** Write files and stage them. */
function stage(dir, files) {
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git(dir, 'add', ...Object.keys(files));
}

function run(dir) {
  const res = spawnSync(process.execPath, [verifyTdd, dir], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, CLC_TDD_TIMEOUT: '60' },
  });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    assert.fail(`verify_tdd.js printed no JSON (status ${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  return { status: res.status, result: parsed, raw: `${res.stdout}\n${res.stderr}` };
}

function assertOutcome(res, status, fragment) {
  assert.strictEqual(res.status, status, `expected exit ${status}, got ${res.status}:\n${res.raw}`);
  assert.strictEqual(res.result.exitCode, status);
  assert.strictEqual(res.result.name, 'verify_tdd');
  assert.match(res.result.data.message, fragment, res.raw);
}

function withRepo(options, fn) {
  if (typeof options === 'function') [options, fn] = [{}, options];
  const dir = createRepo(options);
  try {
    fn(dir);
  } finally {
    teardown(dir);
  }
}

function repoState(dir) {
  return {
    cached: git(dir, 'diff', '--cached', '--name-only'),
    cachedPatch: git(dir, 'diff', '--cached'),
    status: git(dir, 'status', '--porcelain'),
    head: git(dir, 'rev-parse', 'HEAD'),
    stash: git(dir, 'stash', 'list'),
  };
}

describe('verify_tdd.js red→green (node:test)', () => {
  it('passes a real TDD change: test fails on HEAD and passes on the staged code', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': MUL_SUM, 'test/sum.test.js': MUL_TEST });
      const res = run(dir);
      assertOutcome(res, 0, /red.*green verified/i);
      assert.strictEqual(res.result.data.mode, 'staged');
      assert.strictEqual(res.result.data.runner, 'node:test');
      assert.deepStrictEqual(res.result.data.changed_tests, ['test/sum.test.js']);
      assert.deepStrictEqual(res.result.data.changed_code, ['lib/sum.js']);
    });
  });

  it('fails when the changed tests already pass without the change', () => {
    withRepo((dir) => {
      const alreadyGreen = `${BASE_TEST}\ntest('add zero', () => {\n  assert.strictEqual(sum.add(0, 0), 0);\n});\n`;
      stage(dir, { 'lib/sum.js': MUL_SUM, 'test/sum.test.js': alreadyGreen });
      assertOutcome(run(dir), 1, /pass without the change/i);
    });
  });

  it('fails when production code changes without any test change', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': MUL_SUM });
      assertOutcome(run(dir), 1, /no test evidence/i);
    });
  });

  it('does not count test helpers or fixtures as test evidence', () => {
    withRepo((dir) => {
      stage(dir, {
        'lib/sum.js': MUL_SUM,
        'test/helpers.js': 'module.exports = {};\n',
        'test/fixtures/data.test.js': 'module.exports = 1;\n',
        'vitest.config.js': 'module.exports = {};\n',
      });
      const res = run(dir);
      assertOutcome(res, 1, /no test evidence/i);
      assert.deepStrictEqual(res.result.data.changed_support.sort(),
        ['test/fixtures/data.test.js', 'test/helpers.js', 'vitest.config.js']);
    });
  });

  it('fails when the changed tests do not pass with the change', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': BROKEN_MUL_SUM, 'test/sum.test.js': MUL_TEST });
      assertOutcome(run(dir), 1, /do not pass with the change/i);
    });
  });

  it('passes with a warning when only tests change', () => {
    withRepo((dir) => {
      const extra = `${BASE_TEST}\ntest('add negative', () => {\n  assert.strictEqual(sum.add(-1, 1), 0);\n});\n`;
      stage(dir, { 'test/sum.test.js': extra });
      const res = run(dir);
      assertOutcome(res, 0, /only tests changed/i);
      assert.ok(res.result.data.warning, 'a characterization-only change must carry a warning');
    });
  });

  it('passes when no JS/TS production code changed', () => {
    withRepo((dir) => {
      stage(dir, { 'README.md': '# calc\n' });
      assertOutcome(run(dir), 0, /no JS\/TS production code changed/i);
    });
  });

  it('accepts a missing module on BASE as red (new module)', () => {
    withRepo((dir) => {
      stage(dir, {
        'lib/strings.js': 'exports.shout = (s) => s.toUpperCase();\n',
        'test/strings.test.js': "const { test } = require('node:test');\nconst assert = require('node:assert');\n" +
          "const { shout } = require('../lib/strings');\n\ntest('shout', () => {\n  assert.strictEqual(shout('a'), 'A');\n});\n",
      });
      assertOutcome(run(dir), 0, /red.*green verified/i);
    });
  });

  it('evaluates the staged code, not the working copy, and leaves the repo state untouched', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': BROKEN_MUL_SUM, 'test/sum.test.js': MUL_TEST });
      // Working copy is fixed but not staged: the commit would still ship the bug.
      write(dir, 'lib/sum.js', MUL_SUM);

      const before = repoState(dir);
      assertOutcome(run(dir), 1, /do not pass with the change/i);
      assert.deepStrictEqual(repoState(dir), before, 'the guard must not mutate index, HEAD, worktree or stash');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'lib/sum.js'), 'utf-8'), MUL_SUM);
    });
  });

  it('keeps the project node_modules intact after linking it into the temporary trees', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': MUL_SUM, 'test/sum.test.js': MUL_TEST });
      assertOutcome(run(dir), 0, /red.*green verified/i);
      const marker = path.join(dir, 'node_modules', 'marker.txt');
      assert.ok(fs.existsSync(marker), 'node_modules (the symlink target) must survive the cleanup');
      assert.ok(!fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink());
    });
  });

  it('evaluates HEAD~1 → HEAD when nothing is staged', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': MUL_SUM, 'test/sum.test.js': MUL_TEST });
      git(dir, 'commit', '-q', '-m', 'tdd change');
      const res = run(dir);
      assertOutcome(res, 0, /red.*green verified/i);
      assert.strictEqual(res.result.data.mode, 'manual');
      assert.strictEqual(res.result.data.base, 'HEAD~1');

      stage(dir, { 'lib/sum.js': `${MUL_SUM}exports.sub = (a, b) => a - b;\n` });
      git(dir, 'commit', '-q', '-m', 'untested change');
      assertOutcome(run(dir), 1, /no test evidence/i);
    });
  });

  it('fails when the green run executes no test at all', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': MUL_SUM, 'test/mul.test.js': "require('../lib/sum');\n" });
      assertOutcome(run(dir), 1, /no tests? (ran|executed)/i);
    });
  });

  it('fails TypeScript tests without vitest or jest', () => {
    withRepo((dir) => {
      stage(dir, { 'lib/sum.js': MUL_SUM, 'test/sum.test.ts': MUL_TEST });
      assertOutcome(run(dir), 1, /no runner for TypeScript tests/i);
    });
  });

  it('skips outside a git repository', () => {
    const dir = createTmpProject({ 'lib/sum.js': BASE_SUM });
    try {
      const res = run(dir);
      assert.strictEqual(res.status, 0);
      assert.strictEqual(res.result.skipped, true);
    } finally {
      teardown(dir);
    }
  });
});

describe('verify_tdd.js runner detection', () => {
  for (const [runner, flag] of [['vitest', 'run'], ['jest', '--runTestsByPath']]) {
    it(`runs the changed tests with node_modules/.bin/${runner} when it is a dependency`, () => {
      withRepo({ devDependencies: { [runner]: '1.0.0' } }, (dir) => {
        stage(dir, { 'lib/sum.js': MUL_SUM, 'test/sum.test.js': MUL_TEST });
        const res = run(dir);
        assertOutcome(res, 0, /red.*green verified/i);
        assert.strictEqual(res.result.data.runner, runner);
        assert.match(res.result.data.green.output, new RegExp(`FAKE-${runner.toUpperCase()} ${flag} test/sum\\.test\\.js`));
      });
    });

    it(`detects a red ${runner} run (tests fail on BASE)`, () => {
      withRepo({ devDependencies: { [runner]: '1.0.0' } }, (dir) => {
        const alreadyGreen = `${BASE_TEST}\ntest('add zero', () => {\n  assert.strictEqual(sum.add(0, 0), 0);\n});\n`;
        stage(dir, { 'lib/sum.js': MUL_SUM, 'test/sum.test.js': alreadyGreen });
        assertOutcome(run(dir), 1, /pass without the change/i);
      });
    });
  }

  it('fails with an install hint when the declared runner is not installed', () => {
    withRepo((dir) => {
      stage(dir, {
        'package.json': `${JSON.stringify({ name: 'calc', devDependencies: { vitest: '1.0.0' } })}\n`,
        'lib/sum.js': MUL_SUM,
        'test/sum.test.js': MUL_TEST,
      });
      assertOutcome(run(dir), 1, /npm install/);
    });
  });
});

describe('verify_tdd.js ships with JS stacks', () => {
  const { autoDetectStack } = require('../src/detector');
  const { generateHarness } = require('../src/generator');
  const { discoverGuards } = require('../tools/audit');

  const stacks = [
    ['Next.js', require('../src/adapters/nextjs'), { 'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }) }, '.githooks'],
    ['Astro', require('../src/adapters/astro'), { 'package.json': JSON.stringify({ dependencies: { astro: '4.0.0' } }), 'astro.config.mjs': 'export default {}' }, '.githooks'],
    ['Agent-OS', require('../src/adapters/agent-os'), { 'package.json': JSON.stringify({ name: 'demo', keywords: ['agent-os'] }) }, '.githooks'],
  ];

  for (const [label, Adapter, files, hookDir] of stacks) {
    it(`${label} declares verify_tdd.js in getTools() before check_custom`, () => {
      const tools = new Adapter().getTools();
      const idx = tools.findIndex((t) => t.name === 'verify_tdd');
      assert.ok(idx >= 0, 'verify_tdd must be in the manifest');
      assert.strictEqual(tools[idx].language, 'js');
      assert.strictEqual(tools[idx].path, 'verify_tdd.js');
      assert.strictEqual(tools[idx].command, 'node tools/verify_tdd.js');
      const customIdx = tools.findIndex((t) => t.name === 'check_custom');
      if (customIdx >= 0) assert.ok(idx < customIdx, 'verify_tdd runs before check_custom');
    });

    it(`the generated ${label} harness copies verify_tdd.js and runs it in the hook`, () => {
      const dir = createTmpProject(files);
      try {
        generateHarness(dir, autoDetectStack(dir));
        assert.ok(fs.existsSync(path.join(dir, 'tools', 'verify_tdd.js')), 'tools/verify_tdd.js must be copied');
        assert.ok(fs.existsSync(path.join(dir, 'tools', '_changes.js')), 'its snapshot helper must be copied');
        const lines = fs.readFileSync(path.join(dir, hookDir, 'pre-commit'), 'utf-8').split('\n');
        assert.ok(lines.includes('node tools/verify_tdd.js'), `hook must run verify_tdd:\n${lines.join('\n')}`);
      } finally {
        teardown(dir);
      }
    });
  }

  it('audit.js discovers verify_* guards', () => {
    const dir = createTmpProject({ 'verify_tdd.js': 'module.exports = { check: () => ({}) };\n' });
    try {
      assert.deepStrictEqual(discoverGuards(dir).map((p) => path.basename(p)), ['verify_tdd.js']);
    } finally {
      teardown(dir);
    }
  });

  it('the catalog lists both verify_tdd variants', () => {
    const { SAFEGUARD_CATALOG: CATALOG } = require('../src/catalog');
    const entry = CATALOG.find((e) => e.name === 'verify_tdd');
    assert.deepStrictEqual(entry.file.split('+').sort(), ['verify_tdd.js', 'verify_tdd.py']);
    assert.ok(entry.labels.includes('verify_tdd.js'));
  });

  it("this repo's pre-commit hook runs verify_tdd.js before npm test", () => {
    const lines = fs.readFileSync(path.join(ROOT, '.githooks', 'pre-commit'), 'utf-8').split('\n');
    const verify = lines.indexOf('node tools/verify_tdd.js');
    assert.ok(verify >= 0, 'hook must run node tools/verify_tdd.js');
    assert.ok(verify < lines.indexOf('npm test'), 'verify_tdd.js runs before npm test');
  });
});
