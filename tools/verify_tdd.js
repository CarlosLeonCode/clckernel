#!/usr/bin/env node
/**
 * Red -> Green TDD Verifier (vitest / jest / node:test) — twin of verify_tdd.py.
 *
 * Proves that a change to JS/TS production code ships with tests that
 * FAIL without the change (red) and PASS with it (green).
 *
 * Two trees are compared:
 *   - something staged:  BASE = HEAD,   CANDIDATE = the index (staged content)
 *   - nothing staged:    BASE = HEAD~1, CANDIDATE = HEAD
 * Both trees are materialized from git into temporary directories (the index
 * with `git checkout-index`, commits with `git archive | tar -x`), so the
 * working copy is never evaluated and the caller's index/HEAD/worktree are
 * never touched. The project's node_modules is symlinked into each tree
 * (read-only use; nothing is installed) and only the link is removed.
 *
 * Self-contained: uses only Node.js built-ins. Commands run with argument
 * arrays, never through a shell.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { changedFiles } = require('./_changes');

const NAME = 'verify_tdd';
const DEFAULT_TIMEOUT = 300;
const OUTPUT_TAIL_LINES = 40;
const MAX_BUFFER = 512 * 1024 * 1024;
const JS_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];
const NODE_TEST_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const TEST_DIRS = new Set(['test', 'tests']);
const TEST_SUFFIX_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// Collected test-support files: overlaid on BASE, never passed to the runner.
const SUPPORT_NAME_RE = /(\.config\.[^/]+$)|(^(vitest|jest)\.setup\.[^/]+$)/;
// Variables that tie git to the caller's repository (set inside hooks); the
// tests run in a detached tree and must not inherit them.
const CALLER_GIT_ENV = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
];

class GitError extends Error {}

function git(repo, args, options = {}) {
  const res = spawnSync('git', args, { cwd: repo, maxBuffer: MAX_BUFFER, ...options });
  if (res.error || res.status !== 0) {
    const detail = res.error ? res.error.message : String(res.stderr || '').trim();
    throw new GitError(`git ${args.join(' ')} failed: ${detail}`);
  }
  return res.stdout;
}

function revExists(repo, rev) {
  try {
    git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Pick BASE/CANDIDATE and list the changed files (deletions ignored). */
function resolveTrees(repo) {
  const changes = changedFiles(repo);
  if (changes.mode === null) throw new GitError('could not list the changed files');
  const hasHead = revExists(repo, 'HEAD');

  if (changes.mode === 'staged') {
    if (!hasHead && changes.files.length === 0) return null; // no commits and nothing staged
    return { mode: 'staged', base: hasHead ? 'HEAD' : null, candidate: null, changed: changes.files };
  }
  const base = revExists(repo, 'HEAD~1') ? 'HEAD~1' : null;
  return { mode: 'manual', base, candidate: 'HEAD', changed: changes.files };
}

/**
 * test:    *.test.* / *.spec.*, or any file under __tests__/ (jest convention)
 * support: *.config.*, vitest/jest.setup.*, anything under a fixtures/ dir of a
 *          test dir, and helpers under test/ or tests/ without a test suffix
 * code:    everything else
 */
function classify(changed) {
  const tests = [];
  const support = [];
  const code = [];
  for (const rel of changed) {
    if (!JS_EXTENSIONS.includes(path.posix.extname(rel))) continue;
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    const dirs = parts.slice(0, -1);
    const testDirIdx = dirs.findIndex((d) => TEST_DIRS.has(d) || d === '__tests__');
    const inFixtures = testDirIdx >= 0 && dirs.slice(testDirIdx + 1).includes('fixtures');
    if (SUPPORT_NAME_RE.test(name) || inFixtures) {
      support.push(rel);
    } else if (TEST_SUFFIX_RE.test(name) || dirs.includes('__tests__')) {
      tests.push(rel);
    } else if (testDirIdx >= 0) {
      support.push(rel);
    } else {
      code.push(rel);
    }
  }
  return { tests, support, code };
}

/** Write a tree into dest: the index when rev is null, else a commit. */
function materialize(repo, rev, dest) {
  if (rev === null) {
    // Honors GIT_INDEX_FILE inherited from a hook (e.g. `git commit -a`).
    git(repo, ['checkout-index', '-a', `--prefix=${dest}${path.sep}`]);
    return;
  }
  const archive = git(repo, ['archive', '--format=tar', rev]);
  const res = spawnSync('tar', ['-x', '-f', '-', '-C', dest], { input: archive, maxBuffer: MAX_BUFFER });
  if (res.error || res.status !== 0) {
    const detail = res.error ? res.error.message : String(res.stderr || '').trim();
    throw new GitError(`extracting ${rev} with tar failed: ${detail}`);
  }
}

/** Symlink the project's node_modules into a tree; returns the link path or null. */
function linkNodeModules(repo, tree) {
  const target = path.join(repo, 'node_modules');
  const link = path.join(tree, 'node_modules');
  if (!fs.existsSync(target) || fs.existsSync(link)) return null;
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  return link;
}

function overlay(srcRoot, destRoot, files) {
  for (const rel of files) {
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(srcRoot, rel), dest);
  }
}

function timeoutMs() {
  const value = Number(process.env.CLC_TDD_TIMEOUT);
  return (Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT) * 1000;
}

function tail(text) {
  return text.split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join('\n');
}

function readPackageJson(tree) {
  try {
    return JSON.parse(fs.readFileSync(path.join(tree, 'package.json'), 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Choose the runner from the CANDIDATE package.json.
 * @returns {{ name: string, command: string|null, args: string[], error?: string }}
 */
function detectRunner(tree, tests) {
  const pkg = readPackageJson(tree);
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [name, args] of [['vitest', ['run']], ['jest', ['--runTestsByPath']]]) {
    if (!deps[name]) continue;
    const bin = path.join(tree, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
    if (!fs.existsSync(bin)) {
      return {
        name, command: null, args: [],
        error: `${name} is declared in package.json but node_modules/.bin/${name} is missing: ` +
          'red->green cannot be verified. Install the dependencies with `npm install`.',
      };
    }
    return { name, command: bin, args: [...args, ...tests] };
  }
  const tsTests = tests.filter((t) => !NODE_TEST_EXTENSIONS.includes(path.posix.extname(t)));
  if (tsTests.length > 0) {
    return {
      name: 'node:test', command: null, args: [],
      error: `No runner for TypeScript tests (${tsTests.join(', ')}): add vitest or jest to package.json.`,
    };
  }
  return { name: 'node:test', command: process.execPath, args: ['--test', ...tests], files: tests };
}

/**
 * Number of tests node:test executed, read from its report (spec reporter
 * "✔ name (1ms)" lines, or TAP "ok 1 - name" lines used by Node 18/20 when
 * not on a TTY). The "tests N" summary alone is not enough: a test file that
 * defines no test is itself reported as one passing test named after the
 * file, so results named after a run file are not counted. Skipped and todo
 * tests are not counted either.
 * @returns {number|null} null when the output carries no node:test summary
 */
function nodeTestCount(output, tree, files) {
  if (!/^\s*(?:ℹ|#)\s*tests\s+\d+\s*$/m.test(output)) return null;
  const roots = [tree];
  try { roots.push(fs.realpathSync(tree)); } catch { /* tree path is enough */ }
  const fileNames = new Set(files.flatMap((f) => [f, ...roots.map((root) => path.join(root, f))]));
  let count = 0;
  for (const line of output.split(/\r?\n/)) {
    if (/#\s*(SKIP|TODO)\b/i.test(line)) continue;
    const match = line.match(/^\s*[✔✖]\s+(.*?)\s+\([\d.]+m?s\)\s*$/) ||
      line.match(/^\s*(?:not )?ok \d+ - (.*?)\s*$/);
    if (match && !fileNames.has(match[1])) count += 1;
  }
  return count;
}

function runTests(tree, runner) {
  const env = { ...process.env, NODE_ENV: 'test' };
  for (const key of CALLER_GIT_ENV) delete env[key];
  // Set when the verifier itself runs under node --test; a child that inherits
  // it skips running its files ("run() is being called recursively").
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(runner.command, runner.args, {
    cwd: tree, env, timeout: timeoutMs(), maxBuffer: MAX_BUFFER, encoding: 'utf-8',
    shell: process.platform === 'win32' && runner.command.endsWith('.cmd'),
  });
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
  const result = {
    exit_code: timedOut || res.error ? null : res.status,
    timed_out: timedOut,
    output: tail(res.error && !timedOut ? `${output}${res.error.message}` : output),
  };
  if (runner.name === 'node:test') result.tests = nodeTestCount(output, tree, runner.files);
  return result;
}

function runLabel(runner, run) {
  if (run.timed_out) return 'timed out';
  return `${runner.name} exit ${run.exit_code}`;
}

function result(exitCode, data, skipped = false) {
  return { exitCode, skipped, name: NAME, data };
}

function verify(repo, trees, groups, data) {
  const runFiles = groups.tests;
  const overlayFiles = groups.tests.concat(groups.support);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-verify-tdd-'));
  const links = [];
  try {
    const candidateDir = path.join(tmp, 'candidate');
    const baseDir = path.join(tmp, 'base');
    fs.mkdirSync(candidateDir);
    fs.mkdirSync(baseDir);
    materialize(repo, trees.candidate, candidateDir);
    if (trees.base !== null) materialize(repo, trees.base, baseDir);
    for (const dir of [candidateDir, baseDir]) {
      const link = linkNodeModules(repo, dir);
      if (link) links.push(link);
    }

    const runner = detectRunner(candidateDir, runFiles);
    data.runner = runner.name;
    if (runner.error) {
      data.message = runner.error;
      return result(1, data);
    }

    const green = runTests(candidateDir, runner);
    data.green = green;
    if (green.exit_code !== 0) {
      data.message = `Changed tests do not pass with the change (${runLabel(runner, green)}).`;
      return result(1, data);
    }
    if (runner.name === 'node:test' && !(green.tests > 0)) {
      data.message = 'Changed tests do not pass with the change (no tests executed).';
      return result(1, data);
    }

    overlay(candidateDir, baseDir, overlayFiles);
    const red = runTests(baseDir, runner);
    data.red = red;
    if (red.exit_code !== null && red.exit_code !== 0) {
      data.message =
        `TDD red->green verified: ${runFiles.length} test file(s) fail without the change ` +
        'and pass with it.';
      return result(0, data);
    }
    if (red.exit_code === 0) {
      data.message = 'Changed tests pass without the change: they do not prove the new behavior.';
      return result(1, data);
    }
    data.message = `Red run on BASE did not fail cleanly (${runLabel(runner, red)}); see red output.`;
    return result(1, data);
  } finally {
    // Remove the links first (never their targets); rmSync does not follow
    // symlinks either, this only makes the intent explicit.
    for (const link of links) {
      try { fs.unlinkSync(link); } catch { /* already gone */ }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Verify red->green for the current change.
 * @param {string} [targetDir] - Directory inside the repository (default: cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 *   data includes mode, base, candidate, changed_tests, changed_support,
 *   changed_code, message and, when tests ran, runner and green/red results.
 */
function check(targetDir) {
  const dir = targetDir || process.cwd();
  let repo;
  let trees;
  try {
    repo = git(dir, ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
    trees = resolveTrees(repo);
  } catch {
    return result(0, { message: 'Not a git repository: nothing to verify' }, true);
  }
  if (trees === null) {
    return result(0, { message: 'No commits and nothing staged: nothing to verify' }, true);
  }

  const groups = classify(trees.changed);
  const data = {
    mode: trees.mode,
    base: trees.base || '(empty tree)',
    candidate: trees.candidate || '(index)',
    changed_tests: groups.tests,
    changed_support: groups.support,
    changed_code: groups.code,
  };

  if (groups.code.length === 0) {
    if (groups.tests.length > 0) {
      data.message = 'Only tests changed: characterization tests allowed.';
      data.warning = 'No production code changed, so red->green was not verified.';
    } else {
      data.message = 'No JS/TS production code changed: nothing to verify.';
    }
    return result(0, data);
  }

  if (groups.tests.length === 0) {
    data.message =
      `No test evidence: ${groups.code.length} JS/TS code file(s) changed ` +
      'without any changed test file.';
    return result(1, data);
  }

  try {
    return verify(repo, trees, groups, data);
  } catch (err) {
    data.message = `Could not materialize the trees to verify: ${err.message}`;
    return result(1, data);
  }
}

module.exports = { check };

if (require.main === module) {
  const res = check(process.argv[2]);
  console.log(JSON.stringify(res, null, 2));
  process.exitCode = res.exitCode;
}
