#!/usr/bin/env node
/**
 * Red -> Green TDD Verifier — twin of verify_tdd.py for every non-Python stack:
 * JS/TS (vitest / jest / node:test), Go (go test), Rust (cargo test), Ruby
 * (RSpec / Minitest through bundler) and PHP (Pest / PHPUnit).
 *
 * Proves that a change to production code ships with tests that FAIL without
 * the change (red) and PASS with it (green).
 *
 * Two trees are compared:
 *   - something staged:  BASE = HEAD,   CANDIDATE = the index (staged content)
 *   - nothing staged:    BASE = HEAD~1, CANDIDATE = HEAD
 * Both trees are materialized from git into temporary directories (the index
 * with `git checkout-index`, commits with `git archive | tar -x`), so the
 * working copy is never evaluated and the caller's index/HEAD/worktree are
 * never touched. The project's installed dependencies are linked into each
 * tree (read-only use; nothing is installed) and only the links are removed:
 * node_modules (JS), vendor/ (PHP: autoload.php, composer/ and bin/ copied so
 * Composer resolves the app from the tree, the packages symlinked), .bundle/
 * and vendor/bundle (Ruby). Cargo builds into a temporary CARGO_TARGET_DIR,
 * never the project's target/; Go uses its global module cache.
 *
 * Each changed file belongs to a language and a project root. A .go / .rs /
 * .rb / .php file belongs to its language when an ancestor (inside the
 * repository) holds go.mod / Cargo.toml / Gemfile / composer.json, the nearest
 * one being its root; without one it is out of scope. A JS/TS file (or one
 * listed in tdd.code) belongs to the nearest ancestor holding a package.json,
 * else the repository root. Files are grouped by (language, root) and each
 * group is verified on its own, with cwd = that root in the temporary tree. A
 * group whose code changed without a changed test in the same group fails.
 * With a single group the result is the same as a whole-repository run.
 *
 * The project config (.clckernel.yaml) widens or narrows what counts as
 * production code: a file matching `tdd.code` is code whatever its language
 * (e.g. Python tools tested by JS tests), a file matching `tdd.ignore` never
 * is. A JS/TS file matching `tdd.code` is handed to verify_tdd.py when it is
 * installed next to this file (it is the code of the Python suite).
 *
 * Self-contained: uses only Node.js built-ins. Commands run with argument
 * arrays, never through a shell (except .cmd/.bat shims on Windows).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { changedFiles, listFiles, pureRenames, projectConfig, globMatcher } = require('./_changes');

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

// The other-language verifier: when it is installed next to this one, a JS/TS
// file listed in tdd.code is its code (e.g. JS scripts tested by pytest).
const SIBLING_VERIFIER = 'verify_tdd.py';

/**
 * What counts as code beyond JS/TS (tdd.code), what never does (tdd.ignore),
 * and which JS/TS files are handed to the sibling verifier: those matching
 * tdd.code when verify_tdd.py is installed next to this file. Listing a JS/TS
 * file in tdd.code has no other purpose, and verify_tdd.py already counts it
 * as code, so each file has exactly one owner.
 * @param {string} repo - Repository root (where the config lives)
 * @returns {{ extra: (rel: string) => boolean, ignore: (rel: string) => boolean, handed: (rel: string) => boolean }}
 */
function codeRules(repo) {
  const config = projectConfig(repo);
  const extra = globMatcher(config ? config.tdd.code : []);
  const sibling = fs.existsSync(path.join(__dirname, SIBLING_VERIFIER));
  return {
    extra,
    ignore: globMatcher(config ? config.tdd.ignore : []),
    handed: sibling ? (rel) => JS_EXTENSIONS.includes(path.posix.extname(rel)) && extra(rel) : () => false,
  };
}

const NO_RULES = { extra: () => false, ignore: () => false, handed: () => false };

/** True for a file the verifier looks at: JS/TS, or listed in tdd.code (minus handed files). */
function inScope(rel, rules) {
  if (rules.handed(rel)) return false;
  return JS_EXTENSIONS.includes(path.posix.extname(rel)) || rules.extra(rel);
}

/** Absolute path of an executable on PATH (PATHEXT on Windows), or null. */
function onPath(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, cmd + ext);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        if (fs.statSync(file).isFile()) return file;
      } catch { /* not here */ }
    }
  }
  return null;
}

function missingTool(name, label, hint) {
  return { name, error: `${label} is not on PATH: red->green cannot be verified. ${hint}` };
}

/** Sum of the first capture group of every match of re in text; null without a match. */
function sumMatches(text, re) {
  let total = null;
  for (const m of text.matchAll(re)) total = (total || 0) + Number(m[1]);
  return total;
}

/** Symlink src into dest unless dest exists or src does not; returns the link or null. */
function linkIfMissing(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
  return dest;
}

const RUBY_LOADER = 'ARGV.dup.tap { ARGV.clear }.each { |f| require File.expand_path(f) }';

/**
 * Non-JS language profiles. Paths given to classify are relative to the
 * project root; it returns 'test', 'support', 'code' or null (out of scope).
 * runner(ctx) returns { name, steps, env?, count } or { name, error }, where
 * ctx = { repo, root, tree (CANDIDATE root dir), tests (root-relative), tmp }.
 * A step with `local` runs a path relative to the tree it runs in.
 */
const PROFILES = [
  {
    lang: 'go',
    marker: 'go.mod',
    exts: ['.go'],
    classify(rel) {
      const parts = rel.split('/');
      if (parts.includes('vendor')) return null;
      if (rel.endsWith('_test.go')) return 'test';
      if (parts.slice(0, -1).includes('testdata')) return 'support';
      return 'code';
    },
    runner({ tests }) {
      const go = onPath('go');
      if (!go) return missingTool('go test', 'go', 'Install Go (https://go.dev/dl/).');
      const pkgs = [...new Set(tests.map((t) => {
        const dir = path.posix.dirname(t);
        return dir === '.' ? '.' : `./${dir}`;
      }))];
      return {
        name: 'go test',
        steps: [{ command: go, args: ['test', '-v', '-count=1', ...pkgs] }],
        count: (out) => (out.match(/^\s*--- PASS:/gm) || []).length,
      };
    },
  },
  {
    lang: 'rust',
    marker: 'Cargo.toml',
    exts: ['.rs'],
    classify(rel) {
      const parts = rel.split('/');
      if (parts[0] === 'tests') {
        const target = parts.length === 2 || (parts.length === 3 && parts[2] === 'main.rs');
        return target ? 'test' : 'support';
      }
      return parts[0] === 'src' ? 'code' : null;
    },
    runner({ tests, tmp }) {
      const cargo = onPath('cargo');
      if (!cargo) return missingTool('cargo test', 'cargo', 'Install Rust with rustup (https://rustup.rs).');
      const targets = [...new Set(tests.map((t) => {
        const parts = t.split('/');
        return parts.length === 2 ? path.posix.basename(t, '.rs') : parts[1];
      }))];
      return {
        name: 'cargo test',
        // One target dir per tree, outside it: with a shared one, cargo's
        // freshness check (dep-info mtimes of the other tree's sources) would
        // reuse the green build for the red run.
        env: (cwd) => ({ CARGO_TARGET_DIR: path.join(tmp, 'cargo-target', path.relative(tmp, cwd).replace(/[\\/]/g, '_')) }),
        steps: [{ command: cargo, args: ['test', ...targets.flatMap((t) => ['--test', t])] }],
        count: (out) => sumMatches(out, /^running (\d+) tests?$/gm),
      };
    },
  },
  {
    lang: 'ruby',
    marker: 'Gemfile',
    exts: ['.rb'],
    classify(rel) {
      const parts = rel.split('/');
      if (parts[0] === 'spec') return rel.endsWith('_spec.rb') ? 'test' : 'support';
      if (parts[0] === 'test') return rel.endsWith('_test.rb') ? 'test' : 'support';
      return parts[0] === 'app' || parts[0] === 'lib' ? 'code' : null;
    },
    link(repo, tree, root) {
      return [
        linkIfMissing(path.join(repo, root, '.bundle'), path.join(tree, '.bundle')),
        linkIfMissing(path.join(repo, root, 'vendor', 'bundle'), path.join(tree, 'vendor', 'bundle')),
      ];
    },
    runner({ repo, root, tree, tests }) {
      const specs = tests.filter((t) => t.endsWith('_spec.rb'));
      const minitests = tests.filter((t) => !t.endsWith('_spec.rb'));
      const name = [specs.length ? 'rspec' : null, minitests.length ? 'minitest' : null].filter(Boolean).join('+');
      const bundle = onPath('bundle');
      if (!bundle) return missingTool(name, 'bundle', 'Install Bundler (`gem install bundler`) and run `bundle install`.');
      if (specs.length > 0) {
        const lock = [path.join(tree, 'Gemfile.lock'), path.join(repo, root, 'Gemfile.lock')].find((f) => fs.existsSync(f));
        const text = lock ? fs.readFileSync(lock, 'utf-8') : '';
        if (!/^ {4}rspec-core \(/m.test(text)) {
          return {
            name,
            error: 'Spec files changed but rspec-core is not in Gemfile.lock: red->green cannot be verified. ' +
              'Add rspec to the Gemfile and run `bundle install`.',
          };
        }
      }
      const steps = [];
      if (specs.length > 0) steps.push({ command: bundle, args: ['exec', 'rspec', ...specs] });
      if (minitests.length > 0) {
        steps.push({ command: bundle, args: ['exec', 'ruby', '-Ilib', '-Itest', '-e', RUBY_LOADER, ...minitests] });
      }
      return {
        name,
        env: (cwd) => ({ BUNDLE_GEMFILE: path.join(cwd, 'Gemfile') }),
        steps,
        count: (out) => {
          const examples = sumMatches(out, /(\d+) examples?, \d+ failures?/g);
          const runs = sumMatches(out, /(\d+) runs?, \d+ assertions?/g);
          return examples === null && runs === null ? null : (examples || 0) + (runs || 0);
        },
      };
    },
  },
  {
    lang: 'php',
    marker: 'composer.json',
    exts: ['.php'],
    classify(rel) {
      const parts = rel.split('/');
      if (parts[0] === 'tests') return rel.endsWith('Test.php') ? 'test' : 'support';
      return parts[0] === 'app' || parts[0] === 'src' ? 'code' : null;
    },
    link(repo, tree, root) {
      return linkVendor(path.join(repo, root, 'vendor'), path.join(tree, 'vendor'));
    },
    runner({ tree, tests }) {
      const bin = ['pest', 'phpunit'].find((b) => fs.existsSync(path.join(tree, 'vendor', 'bin', b)));
      if (!bin) {
        return {
          name: 'phpunit',
          error: 'vendor/bin/phpunit (or vendor/bin/pest) is missing: red->green cannot be verified. ' +
            'Install the dependencies with `composer install`.',
        };
      }
      const command = path.join('vendor', 'bin', bin);
      // PHPUnit 9 accepts a single test path; Pest takes them all.
      const steps = bin === 'pest'
        ? [{ command, local: true, args: tests }]
        : tests.map((t) => ({ command, local: true, args: [t] }));
      return { name: bin, steps, count: phpTestCount };
    },
  },
];

/** Tests PHPUnit / Pest ran: "OK (N tests", "Tests: N, ..." or Pest's "Tests: ... N passed". */
function phpTestCount(out) {
  let total = null;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/OK \((\d+) tests?/) || line.match(/Tests:.*?(\d+) passed/) || line.match(/Tests: (\d+),/);
    if (m) total = (total || 0) + Number(m[1]);
  }
  return total;
}

/**
 * The project's Composer vendor/ in a tree: a real directory where
 * autoload.php, composer/ and bin/ are copies (Composer derives the app's base
 * dir from their real path, so a symlink would load the app from the working
 * copy) and every package is a symlink. Returns the links created.
 */
function linkVendor(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return [];
  fs.mkdirSync(dest, { recursive: true });
  const links = [];
  for (const entry of fs.readdirSync(src)) {
    const from = path.join(src, entry);
    const to = path.join(dest, entry);
    if (['autoload.php', 'composer', 'bin'].includes(entry)) {
      fs.cpSync(from, to, { recursive: true, dereference: true });
    } else {
      fs.symlinkSync(from, to, process.platform === 'win32' ? 'junction' : (fs.statSync(from).isDirectory() ? 'dir' : 'file'));
      links.push(to);
    }
  }
  return links;
}

const PROFILE_BY_LANG = new Map(PROFILES.map((p) => [p.lang, p]));

/** Nearest ancestor dir of rel holding marker: '.' for the repository root, null for none. */
function nearestMarker(rel, files, marker) {
  const dirs = rel.split('/').slice(0, -1);
  for (let depth = dirs.length; depth >= 0; depth -= 1) {
    const root = dirs.slice(0, depth).join('/');
    if (files.has(root ? `${root}/${marker}` : marker)) return root || '.';
  }
  return null;
}

/**
 * Language and project root of a changed file, or null when the verifier does
 * not look at it. A non-JS file is in scope when its profile classifies it
 * (or tdd.code lists it) and it is not ignored code.
 * @returns {{ lang: string, root: string }|null}
 */
function locate(rel, files, rules) {
  const ext = path.posix.extname(rel);
  for (const profile of PROFILES) {
    if (!profile.exts.includes(ext)) continue;
    const root = nearestMarker(rel, files, profile.marker);
    if (root === null) continue;
    return profileKind(profile, rel, root, rules) ? { lang: profile.lang, root } : null;
  }
  if (inScope(rel, rules)) return { lang: 'js', root: projectRoot(rel, files) };
  return null;
}

/** 'test' / 'support' / 'code' of a non-JS file in its root, or null. */
function profileKind(profile, rel, root, rules) {
  let kind = profile.classify(relative(rel, root));
  if (kind === null && rules.extra(rel)) kind = 'code';
  if (kind === 'code' && rules.ignore(rel)) return null;
  return kind;
}

function revExists(repo, rev) {
  try {
    git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick BASE/CANDIDATE and list the changed files (deletions ignored). Pure
 * renames (identical content moved to a new path) are not changes to verify:
 * they are listed apart in `renamed` and count neither as code nor as tests.
 */
function resolveTrees(repo, rules = NO_RULES) {
  const all = changedFiles(repo);
  if (all.mode === null) throw new GitError('could not list the changed files');
  const pure = pureRenames(repo, all.mode);
  const files = new Set(listFiles(repo, all.mode));
  const changes = { mode: all.mode, files: all.files.filter((f) => !pure.has(f)) };
  const renamed = all.files.filter((f) => pure.has(f) && locate(f, files, rules) !== null);
  const hasHead = revExists(repo, 'HEAD');

  if (changes.mode === 'staged') {
    if (!hasHead && changes.files.length === 0) return null; // no commits and nothing staged
    return { mode: 'staged', base: hasHead ? 'HEAD' : null, candidate: null, changed: changes.files, renamed, snapshot: changes.mode, files };
  }
  const base = revExists(repo, 'HEAD~1') ? 'HEAD~1' : null;
  return { mode: 'manual', base, candidate: 'HEAD', changed: changes.files, renamed, snapshot: changes.mode, files };
}

/** Nearest ancestor dir of rel holding a package.json; '.' for the repository root. */
function projectRoot(rel, files) {
  const dirs = rel.split('/').slice(0, -1);
  for (let depth = dirs.length; depth > 0; depth -= 1) {
    const root = dirs.slice(0, depth).join('/');
    if (files.has(`${root}/package.json`)) return root;
  }
  return '.';
}

/**
 * Changed in-scope files grouped by (language, project root), first seen
 * first: a Map of key -> { lang, root, files }.
 */
function byRoot(repo, trees, rules = NO_RULES) {
  const files = trees.files || new Set(listFiles(repo, trees.snapshot));
  const roots = new Map();
  for (const rel of trees.changed) {
    const where = locate(rel, files, rules);
    if (where === null) continue;
    const key = `${where.lang}:${where.root}`;
    if (!roots.has(key)) roots.set(key, { ...where, files: [] });
    roots.get(key).files.push(rel);
  }
  return roots;
}

/** classify for a group: the JS rules, or the group's language profile. */
function classifyGroup(group, rules = NO_RULES) {
  if (group.lang === 'js') return classify(group.files, rules);
  const profile = PROFILE_BY_LANG.get(group.lang);
  const out = { tests: [], support: [], code: [] };
  const lists = { test: out.tests, support: out.support, code: out.code };
  for (const rel of group.files) {
    const kind = profileKind(profile, rel, group.root, rules);
    if (kind) lists[kind].push(rel);
  }
  return out;
}

/** Label of a group in messages: its root for JS (as before), "root (lang)" otherwise. */
function groupLabel(group) {
  return group.lang === 'js' ? group.root : `${group.root} (${group.lang})`;
}

function relative(rel, root) {
  return root === '.' ? rel : rel.slice(root.length + 1);
}

/**
 * test:    *.test.* / *.spec.*, or any file under __tests__/ (jest convention)
 * support: *.config.*, vitest/jest.setup.*, anything under a fixtures/ dir of a
 *          test dir, and helpers under test/ or tests/ without a test suffix
 * code:    everything else, plus any file matching tdd.code; a file matching
 *          tdd.ignore is never code
 */
function classify(changed, rules = NO_RULES) {
  const tests = [];
  const support = [];
  const code = [];
  for (const rel of changed) {
    if (!inScope(rel, rules)) continue;
    if (rules.extra(rel)) {
      if (!rules.ignore(rel)) code.push(rel);
      continue;
    }
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
    } else if (!rules.ignore(rel)) {
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

/**
 * Symlink the project's node_modules into a tree; returns the link path or null.
 * For a project root below the repository root, its own node_modules is used
 * when installed, else the repository root's (hoisted workspaces).
 */
function linkNodeModules(repo, tree, root = '.') {
  const own = path.join(repo, root, 'node_modules');
  const target = root !== '.' && !fs.existsSync(own) ? path.join(repo, 'node_modules') : own;
  const link = path.join(tree, root, 'node_modules');
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

/**
 * Run the runner's commands in tree, stopping at the first that does not exit
 * 0; the result carries the last exit code, the output tail and, for runners
 * that count, the number of tests executed.
 */
function runTests(tree, runner) {
  const env = { ...process.env, NODE_ENV: 'test' };
  for (const key of CALLER_GIT_ENV) delete env[key];
  // Set when the verifier itself runs under node --test; a child that inherits
  // it skips running its files ("run() is being called recursively").
  delete env.NODE_TEST_CONTEXT;
  if (runner.env) Object.assign(env, runner.env(tree));
  const steps = runner.steps || [{ command: runner.command, args: runner.args }];
  let output = '';
  let res = null;
  let timedOut = false;
  for (const step of steps) {
    const command = step.local ? path.join(tree, step.command) : step.command;
    res = spawnSync(command, step.args, {
      cwd: tree, env, timeout: timeoutMs(), maxBuffer: MAX_BUFFER, encoding: 'utf-8',
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    });
    output += `${res.stdout || ''}${res.stderr || ''}`;
    timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
    if (res.error && !timedOut) output += res.error.message;
    if (res.error || res.status !== 0) break;
  }
  const result = {
    exit_code: timedOut || res.error ? null : res.status,
    timed_out: timedOut,
    output: tail(output),
  };
  if (runner.name === 'node:test') result.tests = nodeTestCount(output, tree, runner.files);
  else if (runner.count) result.tests = runner.count(output);
  return result;
}

function runLabel(runner, run) {
  if (run.timed_out) return 'timed out';
  return `${runner.name} exit ${run.exit_code}`;
}

function result(exitCode, data, skipped = false) {
  return { exitCode, skipped, name: NAME, data };
}

/** Materialize CANDIDATE and BASE into tmp, with the repository root's node_modules linked. */
function materializeTrees(repo, trees, tmp, links) {
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
  return { candidateDir, baseDir };
}

/**
 * Green on CANDIDATE, then red on BASE + the changed tests, inside one project
 * root, with the runner of the group's language.
 */
function redGreen(repo, candidateRoot, baseRoot, root, groups, data, links, lang = 'js', tmp = null) {
  const runFiles = groups.tests.map((f) => relative(f, root));
  const overlayFiles = groups.tests.concat(groups.support).map((f) => relative(f, root));
  const candidateDir = path.join(candidateRoot, root);
  const baseDir = path.join(baseRoot, root);
  if (root !== '.') fs.mkdirSync(baseDir, { recursive: true });
  let runner;
  if (lang === 'js') {
    if (root !== '.') {
      for (const dir of [candidateRoot, baseRoot]) {
        const link = linkNodeModules(repo, dir, root);
        if (link) links.push(link);
      }
    }
    runner = detectRunner(candidateDir, runFiles);
  } else {
    const profile = PROFILE_BY_LANG.get(lang);
    for (const dir of [candidateDir, baseDir]) {
      if (profile.link) links.push(...[].concat(profile.link(repo, dir, root)).filter(Boolean));
    }
    runner = profile.runner({ repo, root, tree: candidateDir, tests: runFiles, tmp });
  }
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
  if ((runner.name === 'node:test' || runner.count) && !(green.tests > 0)) {
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
}

/**
 * Runs fn(candidateDir, baseDir, links) over freshly materialized trees and
 * cleans up: the links first (never their targets; rmSync does not follow
 * symlinks either, this only makes the intent explicit), then the trees.
 */
function withTrees(repo, trees, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-verify-tdd-'));
  const links = [];
  try {
    const { candidateDir, baseDir } = materializeTrees(repo, trees, tmp, links);
    return fn(candidateDir, baseDir, links, tmp);
  } finally {
    for (const link of links) {
      try { fs.unlinkSync(link); } catch { /* already gone */ }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function verify(repo, trees, groups, data, root = '.', lang = 'js') {
  return withTrees(repo, trees, (candidateDir, baseDir, links, tmp) =>
    redGreen(repo, candidateDir, baseDir, root, groups, data, links, lang, tmp));
}

/** Outcome decided without running tests, or null when red/green must run. */
function precheck(groups, data) {
  if (groups.code.length === 0) {
    if (groups.tests.length > 0) {
      data.message = 'Only tests changed: characterization tests allowed.';
      data.warning = 'No production code changed, so red->green was not verified.';
    } else if (data.pure_renames && data.pure_renames.length > 0) {
      data.message = 'Only pure renames: nothing to verify.';
    } else {
      data.message = 'No production code changed: nothing to verify.';
    }
    return result(0, data);
  }
  if (groups.tests.length === 0) {
    data.message =
      `No test evidence: ${groups.code.length} production code file(s) changed ` +
      'without any changed test file.';
    return result(1, data);
  }
  return null;
}

/** Several groups (language, root): each passes on its own, or the change fails. */
function verifyRoots(repo, trees, roots, data, rules = NO_RULES) {
  const entries = [...roots.values()].map((group) => {
    const { root, lang } = group;
    const groups = classifyGroup(group, rules);
    const gdata = {
      root, language: lang, changed_tests: groups.tests, changed_support: groups.support, changed_code: groups.code,
    };
    const outcome = precheck(groups, gdata);
    if (outcome && outcome.exitCode === 1) {
      gdata.message =
        `No test evidence: ${groups.code.length} production code file(s) changed in ${root} ` +
        `without any changed test file in ${root}.`;
    }
    return { root, lang, label: groupLabel(group), groups, gdata, outcome };
  });

  const pending = entries.filter((e) => e.outcome === null);
  if (pending.length > 0) {
    try {
      withTrees(repo, trees, (candidateDir, baseDir, links, tmp) => {
        for (const entry of pending) {
          entry.outcome = redGreen(
            repo, candidateDir, baseDir, entry.root, entry.groups, entry.gdata, links, entry.lang, tmp);
        }
      });
    } catch (err) {
      data.message = `Could not materialize the trees to verify: ${err.message}`;
      return result(1, data);
    }
  }

  data.groups = entries.map((e) => ({ ...e.gdata, exit_code: e.outcome.exitCode }));
  const labelled = entries.map((e, i) => ({ label: e.label, group: data.groups[i] }));
  const failed = labelled.filter((e) => e.group.exit_code !== 0);
  data.message = (failed.length > 0 ? failed : labelled).map((e) => `[${e.label}] ${e.group.message}`).join(' ');
  return result(failed.length > 0 ? 1 : 0, data);
}

/** Every group's tests / support / code, in the order the files changed. */
function classifyChanged(changed, roots, rules) {
  const kinds = new Map();
  for (const group of roots.values()) {
    const groups = classifyGroup(group, rules);
    for (const kind of ['tests', 'support', 'code']) for (const rel of groups[kind]) kinds.set(rel, kind);
  }
  const out = { tests: [], support: [], code: [] };
  for (const rel of changed) if (kinds.has(rel)) out[kinds.get(rel)].push(rel);
  return out;
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
  try {
    repo = git(dir, ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
  } catch {
    return result(0, { message: 'Not a git repository: nothing to verify' }, true);
  }
  // An invalid config throws here: never verify against a config we cannot read.
  const rules = codeRules(repo);
  let trees;
  try {
    trees = resolveTrees(repo, rules);
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    return result(0, { message: 'Not a git repository: nothing to verify' }, true);
  }
  if (trees === null) {
    return result(0, { message: 'No commits and nothing staged: nothing to verify' }, true);
  }

  const roots = byRoot(repo, trees, rules);
  const groups = classifyChanged(trees.changed, roots, rules);
  const data = {
    mode: trees.mode,
    base: trees.base || '(empty tree)',
    candidate: trees.candidate || '(index)',
    changed_tests: groups.tests,
    changed_support: groups.support,
    changed_code: groups.code,
  };
  if (trees.renamed.length > 0) data.pure_renames = trees.renamed;

  if (roots.size > 1) return verifyRoots(repo, trees, roots, data, rules);
  const only = roots.size === 1 ? [...roots.values()][0] : { root: '.', lang: 'js' };
  if (only.root !== '.') data.root = only.root;
  if (only.lang !== 'js') data.language = only.lang;

  const early = precheck(groups, data);
  if (early) return early;

  try {
    return verify(repo, trees, groups, data, only.root, only.lang);
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
