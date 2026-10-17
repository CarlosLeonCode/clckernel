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

module.exports = { createTmpProject, teardown, git, createGitRepo, stageFiles };
