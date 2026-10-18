#!/usr/bin/env node
/**
 * Builds src/known-hashes.json (sdds/safe-update, decision 3): the sha256 of
 * every version the kernel ever shipped of each file it installs into a
 * project (tools/* and the clckernel_cli skill), read from the git history,
 * deleted files included, plus the current working-tree bytes.
 *
 * `clckernel update` overwrites a file without a registry hash only when its
 * bytes match one of these: an old intact install updates silently, a locally
 * edited one is protected. Run it after changing anything under tools/ or the
 * skill: `node scripts/build-known-hashes.js` (a test fails until you do).
 *
 * Keys are the paths the file has in a consumer project. Files of the skill's
 * old name (clc_forge_cli) are also recorded under clckernel_cli, since older
 * releases installed the same bytes in both directories.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'known-hashes.json');
const SKILL = '.agents/skills/clckernel_cli/';
const LEGACY_SKILL = '.agents/skills/clc_forge_cli/';
const SOURCES = ['tools/', SKILL, LEGACY_SKILL];

function git(args, encoding = 'utf-8') {
  const res = spawnSync('git', args, { cwd: ROOT, encoding, maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Path the file takes in a consumer project, or null when the kernel does not install it. */
function consumerPath(repoPath) {
  if (repoPath.startsWith('tools/guards/')) return null;
  if (repoPath.startsWith(LEGACY_SKILL)) return SKILL + repoPath.slice(LEGACY_SKILL.length);
  return SOURCES.some((s) => repoPath.startsWith(s)) ? repoPath : null;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

function build() {
  const table = new Map();
  const add = (repoPath, bytes) => {
    const key = consumerPath(repoPath);
    if (!key) return;
    if (!table.has(key)) table.set(key, new Set());
    table.get(key).add(sha256(bytes));
  };

  // Every path that ever existed under the sources, deleted ones included.
  const everPaths = new Set(
    git(['log', '--all', '--format=', '--name-only', '--', ...SOURCES]).split('\n').filter(Boolean)
  );
  for (const repoPath of everPaths) {
    const blobs = new Set();
    for (const commit of git(['log', '--all', '--format=%H', '--', repoPath]).split('\n').filter(Boolean)) {
      const res = spawnSync('git', ['rev-parse', '-q', '--verify', `${commit}:${repoPath}`], { cwd: ROOT, encoding: 'utf-8' });
      if (res.status === 0) blobs.add(res.stdout.trim());
    }
    for (const blob of blobs) add(repoPath, git(['cat-file', 'blob', blob], null));
  }
  // The working tree: what this checkout is about to publish.
  for (const source of SOURCES) {
    for (const repoPath of walk(path.join(ROOT, source))) add(repoPath, fs.readFileSync(path.join(ROOT, repoPath)));
  }

  const sorted = {};
  for (const key of [...table.keys()].sort()) sorted[key] = [...table.get(key)].sort();
  return sorted;
}

if (require.main === module) {
  const table = build();
  fs.writeFileSync(OUT, JSON.stringify(table, null, 2) + '\n', 'utf-8');
  const versions = Object.values(table).reduce((n, list) => n + list.length, 0);
  console.log(`known-hashes: ${Object.keys(table).length} paths, ${versions} versions -> ${path.relative(ROOT, OUT)}`);
}

module.exports = { build, consumerPath };
