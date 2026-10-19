/**
 * Shared test utilities for CLC Forge test suite.
 * Provides temp directory creation, project scaffolding, and teardown.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Create a temporary project directory with the given file structure.
 * Returns the path to the temp directory.
 *
 * @param {Record<string, string>} files - Map of relative paths to file contents.
 * @returns {string} Path to the created temp directory.
 */
function createTmpProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-forge-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(dir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  return dir;
}

/**
 * Recursively remove a temporary directory.
 *
 * @param {string} dir - Path to remove.
 */
function teardown(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Runs git in dir and fails the test on a non-zero exit. */
function git(dir, ...args) {
  const { spawnSync } = require('child_process');
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

/**
 * Temporary git repository: `committed` files land in an initial commit,
 * `staged` files are then written and staged (the snapshot a pre-commit sees).
 *
 * @param {Record<string, string>} committed - Files of the initial commit.
 * @param {Record<string, string>} [staged] - Files written and staged afterwards.
 * @returns {string} Path to the repository.
 */
function createGitRepo(committed = {}, staged = {}) {
  const dir = createTmpProject(committed);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (Object.keys(committed).length > 0) {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--no-verify', '-m', 'initial');
  }
  stageFiles(dir, staged);
  return dir;
}

/** Writes the files into dir and stages them. */
function stageFiles(dir, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(dir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    git(dir, 'add', '--', rel);
  }
}

/**
 * Paths a registry lists, in either format: the older list of paths or the
 * hashed { kernelVersion, files: [{ path, sha256 }] } (sdds/safe-update).
 * @param {string[]|object} registry - Parsed tools/.clckernel-managed.json
 * @returns {string[]}
 */
function registryPaths(registry) {
  return Array.isArray(registry) ? registry : registry.files.map((f) => f.path);
}

/**
 * `files` plus a hashed registry vouching for them: an older install whose
 * kernel files are intact, so update may overwrite them (sdds/safe-update).
 * @param {Record<string, string>} files - Kernel files of the older install
 * @returns {Record<string, string>}
 */
function withRegistry(files) {
  const crypto = require('crypto');
  const entries = Object.entries(files).map(([p, content]) => ({
    path: p,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  }));
  return { ...files, 'tools/.clckernel-managed.json': JSON.stringify({ kernelVersion: '0.0.0', files: entries }) };
}

/**
 * Guards the pre-commit hook runs (sdds/unified-discovery): the hook calls
 * the installed audit orchestrators with --hook, and their discovery decides.
 * Returns the labels the orchestrators in dir/tools plan (e.g.
 * 'check_hitl.js', 'guards/x.py'), each orchestrator's plan once.
 * @param {string} dir - Project root
 * @returns {string[]}
 */
function plannedGuards(dir) {
  const { spawnSync } = require('child_process');
  const tools = path.join(dir, 'tools');
  const labels = [];
  if (fs.existsSync(path.join(tools, 'audit.js'))) {
    const script = 'console.log(JSON.stringify(require(process.argv[1]).planGuards(require("path").dirname(process.argv[1])).map((e) => e.label)))';
    const res = spawnSync(process.execPath, ['-e', script, path.join(tools, 'audit.js')], { encoding: 'utf-8' });
    if (res.status !== 0) throw new Error(`audit.js planGuards failed: ${res.stderr}`);
    labels.push(...JSON.parse(res.stdout));
  }
  if (fs.existsSync(path.join(tools, 'audit.py'))) {
    const script = [
      'import importlib.util, json, pathlib, sys',
      'p = pathlib.Path(sys.argv[1])',
      'spec = importlib.util.spec_from_file_location("audit_under_test", str(p))',
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'print(json.dumps([e["label"] for e in m.plan_guards(p.parent)]))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', script, path.join(tools, 'audit.py')], { encoding: 'utf-8' });
    if (res.status !== 0) throw new Error(`audit.py plan_guards failed: ${res.stderr}`);
    labels.push(...JSON.parse(res.stdout));
  }
  return labels;
}

/** The two orchestrator lines every generated hook carries (sdds/unified-discovery). */
const HOOK_ORCHESTRATOR_LINES = [
  'if [ -f tools/audit.js ]; then node tools/audit.js --hook; fi',
  'if [ -f tools/audit.py ]; then python3 tools/audit.py --hook; fi',
];

/**
 * True when the generated hook at dir/hookRel runs the guard file (e.g.
 * 'check_hitl.js'): it calls the orchestrators and their discovery plans it.
 * @param {string} dir - Project root
 * @param {string} file - Guard file name under tools/
 * @param {string} [hookRel] - Hook path relative to dir
 * @returns {boolean}
 */
function hookRunsGuard(dir, file, hookRel = path.join('.githooks', 'pre-commit')) {
  const lines = fs.readFileSync(path.join(dir, hookRel), 'utf-8').split('\n');
  if (!HOOK_ORCHESTRATOR_LINES.every((line) => lines.includes(line))) return false;
  return plannedGuards(dir).includes(file);
}

module.exports = {
  createTmpProject, teardown, git, createGitRepo, stageFiles, registryPaths, withRegistry,
  plannedGuards, hookRunsGuard, HOOK_ORCHESTRATOR_LINES,
};
