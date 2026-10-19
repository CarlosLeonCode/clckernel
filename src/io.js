/**
 * CLC Kernel — Single write point for install and update (sdds/safe-update).
 *
 * Every write the harness makes in a project goes through an `io` session:
 * files, copies, symlinks, moves, removals, .gitignore and git config. A real
 * session applies each operation and records it; a dry-run session only
 * records it, so the same code path yields the plan `--dry-run` prints.
 *
 * Files the kernel owns (tools/*, the pre-commit hook, the clckernel_cli
 * skill) are written with `writeManaged`, which applies the ownership rule:
 *
 *   missing                                   -> write
 *   identical to the new content              -> nothing
 *   sha256 equals the registry's hash, or any
 *   version the kernel published (known-hashes) -> overwrite
 *   anything else                              -> keep it, write <file>.clckernel-new
 *
 * The registry (tools/.clckernel-managed.json) records, per owned file, the
 * sha256 of what the kernel last wrote: { kernelVersion, files: [{ path, sha256 }] }.
 * The older format (a sorted array of paths) is still read; it carries no hashes.
 *
 * Paths the project config lists in `update.exclude` are never written,
 * moved, linked or removed: each is recorded as excluded and left as it is.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const MANAGED_REGISTRY = 'tools/.clckernel-managed.json';
const NEW_SUFFIX = '.clckernel-new';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const toPosix = (p) => p.split(path.sep).join('/');

/** sha256 of every published version of each kernel file (scripts/build-known-hashes.js). */
function loadKnownHashes() {
  try {
    return require('./known-hashes.json');
  } catch {
    return {};
  }
}

/**
 * Reads the registry in either format.
 * @param {string} root - Project root
 * @returns {{ format: 'none'|'list'|'hashed', paths: string[], hashes: Map<string, string> }}
 */
function readRegistry(root) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(root, MANAGED_REGISTRY), 'utf-8'));
  } catch {
    return { format: 'none', paths: [], hashes: new Map() };
  }
  if (Array.isArray(data)) {
    return { format: 'list', paths: data.filter((f) => typeof f === 'string'), hashes: new Map() };
  }
  const files = data && Array.isArray(data.files) ? data.files : [];
  const hashes = new Map();
  for (const f of files) {
    if (f && typeof f.path === 'string' && typeof f.sha256 === 'string') hashes.set(f.path, f.sha256);
  }
  return { format: 'hashed', paths: [...hashes.keys()], hashes };
}

/**
 * Registered paths in either format, the registry itself included (the
 * snapshot helpers and whole-project linters exclude them).
 * @param {string} root - Project root
 * @returns {string[]}
 */
function registeredPaths(root) {
  const { format, paths } = readRegistry(root);
  return format === 'none' ? [] : [...new Set([...paths, MANAGED_REGISTRY])].sort();
}

/**
 * Creates an io session for one install/update of `root`.
 * @param {object} options
 * @param {string} options.root - Project root
 * @param {boolean} [options.dryRun] - Record only, never write
 * @param {object} [options.knownHashes] - { path: [sha256] } (defaults to src/known-hashes.json)
 * @param {'install'|'update'} [options.mode] - An update never adds guards or
 *   mirrors the project does not have (sdds/update-no-additions)
 * @param {(rel: string) => boolean} [options.exclude] - Root-relative POSIX
 *   paths never touched (the config's update.exclude)
 */
function createIO({ root, dryRun = false, knownHashes = loadKnownHashes(), mode: sessionMode = 'install', exclude = () => false } = {}) {
  const projectRoot = path.resolve(root);
  const registry = readRegistry(projectRoot);
  // Dry-run overlay: what the plan would have put on disk, so later reads in
  // the same run see it (e.g. .gitignore entries added twice).
  const overlay = new Map(); // abs -> { kind: 'file', bytes } | { kind: 'dir' } | { kind: 'link', target } | { kind: 'gone' }
  const decisions = new Map(); // rel -> { status, sha }
  const plan = {
    written: [], unchanged: [], protected: [], moved: [], removed: [], gitignore: [], gitConfig: [],
    // sdds/update-no-additions: what update left out on purpose.
    available: [], mirrorsSkipped: [], trackedNotIgnored: [],
    // sdds/config-foundation: paths the config's update.exclude keeps out.
    excluded: [],
  };

  const rel = (abs) => toPosix(path.relative(projectRoot, abs));
  const abs = (p) => (path.isAbsolute(p) ? p : path.join(projectRoot, p));
  const note = (list, value) => {
    if (!list.includes(value)) list.push(value);
  };
  /** True (and recorded) when the config excludes this absolute path. */
  const excluded = (p) => {
    const relPath = rel(p);
    if (!exclude(relPath)) return false;
    note(plan.excluded, relPath);
    return true;
  };

  function lstat(p) {
    const o = overlay.get(p);
    if (o) return o.kind === 'gone' ? null : o;
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return { kind: 'link', target: fs.readlinkSync(p) };
      if (st.isDirectory()) return { kind: 'dir' };
      if (st.isFile()) return { kind: 'file' };
      return { kind: 'other' };
    } catch {
      return null;
    }
  }

  function exists(p) {
    const o = overlay.get(abs(p));
    if (o) return o.kind !== 'gone';
    return fs.existsSync(abs(p));
  }

  function read(p) {
    const o = overlay.get(abs(p));
    if (o && o.kind === 'file') return o.bytes;
    if (o && o.kind === 'gone') return null;
    try {
      return fs.readFileSync(abs(p));
    } catch {
      return null;
    }
  }

  function mkdir(p) {
    if (excluded(abs(p))) return;
    ensureDir(abs(p));
  }

  function ensureDir(dir) {
    if (dryRun) {
      for (let d = dir; d.startsWith(projectRoot) && !exists(d); d = path.dirname(d)) overlay.set(d, { kind: 'dir' });
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
  }

  function put(dest, bytes, mode) {
    if (dryRun) {
      overlay.set(dest, { kind: 'file', bytes });
      return;
    }
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, bytes);
    if (mode) {
      try { fs.chmodSync(dest, mode); } catch {}
    }
  }

  /**
   * Writes a file the project owns the content of (AGENTS.md when absent,
   * sdds/.gitkeep, the registry, .clckernel.resolved.json): no ownership rule.
   * @returns {'written'|'unchanged'}
   */
  function writeFile(p, content, { mode } = {}) {
    const dest = abs(p);
    if (excluded(dest)) return 'excluded';
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf-8');
    const current = read(dest);
    if (current && current.equals(bytes)) {
      note(plan.unchanged, rel(dest));
      return 'unchanged';
    }
    put(dest, bytes, mode);
    note(plan.written, rel(dest));
    return 'written';
  }

  /**
   * Writes a kernel-owned file under the ownership rule.
   * @param {string} relPath - Path relative to the project root
   * @param {string|Buffer} content
   * @param {{ mode?: string }} [options]
   * @returns {'written'|'unchanged'|'protected'|'excluded'}
   */
  function writeManaged(relPath, content, { mode } = {}) {
    const relKey = toPosix(relPath);
    const dest = abs(relKey);
    if (excluded(dest)) return 'excluded';
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf-8');
    const sha = sha256(bytes);
    const prior = decisions.get(relKey);
    if (prior && prior.sha === sha) return prior.status;

    const stat = lstat(dest);
    const current = stat && stat.kind === 'file' ? read(dest) : null;
    let status;
    let reason = null;
    if (!stat) {
      status = 'written';
    } else if (current && current.equals(bytes)) {
      status = 'unchanged';
    } else if (current && prior && prior.status !== 'protected') {
      status = 'written'; // written earlier in this same run
    } else if (current && (registry.hashes.get(relKey) === sha256(current) ||
      (knownHashes[relKey] || []).includes(sha256(current)))) {
      status = 'written';
    } else {
      status = 'protected';
      if (!current) reason = 'not a regular file';
      else if (registry.paths.includes(relKey)) reason = 'modified locally';
      else reason = 'unknown to the kernel: edited locally, or a project file with the same name';
    }

    if (status === 'written') {
      put(dest, bytes, mode);
      plan.unchanged = plan.unchanged.filter((p) => p !== relKey);
      note(plan.written, relKey);
    } else if (status === 'unchanged') {
      if (!dryRun && mode) {
        try { fs.chmodSync(dest, mode); } catch {}
      }
      if (!plan.written.includes(relKey)) note(plan.unchanged, relKey);
    } else {
      const newPath = relKey + NEW_SUFFIX;
      put(abs(newPath), bytes, mode);
      if (!plan.protected.some((x) => x.path === relKey)) plan.protected.push({ path: relKey, newPath, reason });
    }
    decisions.set(relKey, { status, sha });
    return status;
  }

  /** writeManaged with the bytes of a bundled file. */
  function copyManaged(src, relPath, options) {
    return writeManaged(relPath, fs.readFileSync(src), options);
  }

  /** Creates a symlink at `p` pointing to `target` (the caller decided it is safe). */
  function symlink(target, p) {
    const dest = abs(p);
    if (excluded(dest)) return 'excluded';
    const stat = lstat(dest);
    if (stat && stat.kind === 'link' && stat.target === target) {
      note(plan.unchanged, rel(dest));
      return 'unchanged';
    }
    if (stat && stat.kind !== 'link') return 'skipped';
    if (dryRun) {
      overlay.set(dest, { kind: 'link', target });
    } else {
      if (stat) fs.unlinkSync(dest);
      fs.symlinkSync(target, dest, 'file');
    }
    note(plan.written, `${rel(dest)} -> ${target}`);
    return 'written';
  }

  /**
   * Creates or refreshes an AI IDE mirror (a symlink to AGENTS.md). An update
   * only refreshes mirrors that exist: one the project deleted is reported as
   * skipped and neither it nor its directory is created.
   * @returns {'written'|'unchanged'|'skipped'}
   */
  function mirror(target, p) {
    const dest = abs(p);
    if (excluded(dest)) return 'excluded';
    if (sessionMode === 'update' && !lstat(dest)) {
      note(plan.mirrorsSkipped, rel(dest));
      return 'skipped';
    }
    if (!exists(path.dirname(dest))) ensureDir(path.dirname(dest));
    return symlink(target, dest);
  }

  /** Records a guard of the manifest the project has not installed. */
  function noteAvailable(name) {
    note(plan.available, name);
  }

  /** Records a .gitignore entry left out because the project tracks that path. */
  function noteTrackedNotIgnored(entry) {
    note(plan.trackedNotIgnored, entry);
  }

  /** Removes a file, symlink or directory tree. */
  function remove(p) {
    const dest = abs(p);
    if (excluded(dest)) return 'excluded';
    if (dryRun) overlay.set(dest, { kind: 'gone' });
    else fs.rmSync(dest, { recursive: true, force: true });
    note(plan.removed, rel(dest));
  }

  /** Moves `from` to `to` (both inside the project). */
  function move(from, to) {
    const src = abs(from);
    const dest = abs(to);
    if (excluded(src) || excluded(dest)) return 'excluded';
    if (dryRun) {
      overlay.set(dest, { kind: 'file', bytes: read(src) });
      overlay.set(src, { kind: 'gone' });
    } else {
      ensureDir(path.dirname(dest));
      fs.renameSync(src, dest);
    }
    plan.moved.push({ from: rel(src), to: rel(dest) });
  }

  /** Rewrites .gitignore with `content`, recording the entries it adds. */
  function appendGitignore(p, content, entries) {
    const dest = abs(p);
    if (excluded(dest)) return 'excluded';
    put(dest, Buffer.from(content, 'utf-8'));
    for (const entry of entries) note(plan.gitignore, entry);
  }

  /** Sets a git config key in the repository at `cwd`. */
  function gitConfig(cwd, key, value) {
    plan.gitConfig.push({ key, value });
    if (dryRun) return true;
    const res = spawnSync('git', ['config', key, value], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return !res.error && res.status === 0;
  }

  /** Owned files whose current bytes are the kernel's (written or unchanged), for the registry. */
  function managedEntries() {
    return [...decisions.entries()]
      .filter(([, d]) => d.status !== 'protected')
      .map(([p, d]) => ({ path: p, sha256: d.sha }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  return {
    root: projectRoot,
    dryRun,
    mode: sessionMode,
    registry,
    exists,
    read,
    mkdir,
    writeFile,
    writeManaged,
    copyManaged,
    symlink,
    mirror,
    noteAvailable,
    noteTrackedNotIgnored,
    remove,
    move,
    appendGitignore,
    gitConfig,
    managedEntries,
    plan: () => plan,
  };
}

// The active session. Install and update run synchronously, so a stack is
// enough to hand the session to the adapters without threading it through
// every provision() signature.
const stack = [];

/** Runs fn with `io` as the active session. */
function runWithIO(io, fn) {
  stack.push(io);
  try {
    return fn();
  } finally {
    stack.pop();
  }
}

/** The active session, or null. */
function activeIO() {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** The active session, or a fresh real session for `root` when none is active. */
function currentIO(root) {
  if (stack.length > 0) return stack[stack.length - 1];
  return createIO({ root: root || process.cwd() });
}

module.exports = {
  MANAGED_REGISTRY,
  NEW_SUFFIX,
  createIO,
  runWithIO,
  activeIO,
  currentIO,
  readRegistry,
  registeredPaths,
  loadKnownHashes,
  sha256,
};
