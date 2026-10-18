/**
 * Snapshot helpers shared by the diff-based guards (twin of _changes.py).
 *
 * A guard evaluates exactly the snapshot being verified:
 *   - 'staged':      something is staged (a pre-commit) -> the index
 *   - 'last-commit': nothing staged (a manual run)      -> HEAD, diffed against HEAD~1
 *                    (a root commit lists every file of HEAD)
 *   - null:          no git repository / git unavailable
 * File content always comes from that snapshot, never from the working copy.
 *
 * Files the harness installed itself are listed in tools/.clckernel-managed.json
 * (written by `clckernel` install/update). changedFiles drops every listed path,
 * so no guard evaluates the harness's own code. Without a registry (e.g. the
 * clckernel repository, where tools/ is source code) nothing is excluded.
 *
 * Self-contained: uses only Node.js built-ins. Git runs with argument arrays,
 * never through a shell; paths are read NUL-separated (-z), so spaces and
 * non-ASCII names survive.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BINARY_PROBE_BYTES = 8000;
const MANAGED_REGISTRY = 'tools/.clckernel-managed.json';
const MAX_BUFFER = 512 * 1024 * 1024;

/** Runs git in dir; stdout Buffer on success, null on any failure. */
function git(dir, args) {
  const res = spawnSync('git', args, { cwd: dir, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error || res.status !== 0) return null;
  return res.stdout;
}

function splitNul(buffer) {
  return buffer.toString('utf-8').split('\0').filter(Boolean);
}

function hasCommit(dir, rev) {
  return git(dir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]) !== null;
}

/**
 * Lists the files added, copied, modified or renamed in the snapshot.
 * @param {string} dir - Directory inside the repository
 * @param {{ extensions?: string[] }} [options] - Keep only paths ending in one of these
 * @returns {{ mode: 'staged'|'last-commit'|null, files: string[] }}
 */
function changedFiles(dir, { extensions } = {}) {
  const cwd = dir || process.cwd();
  const anyStaged = git(cwd, ['diff', '--cached', '--name-only', '-z']);
  if (anyStaged === null) return { mode: null, files: [] };

  let mode;
  let out;
  if (anyStaged.length > 0) {
    mode = 'staged';
    out = git(cwd, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  } else if (!hasCommit(cwd, 'HEAD')) {
    // No commits and nothing staged: the index holds nothing to evaluate.
    return { mode: 'staged', files: [] };
  } else {
    mode = 'last-commit';
    out = hasCommit(cwd, 'HEAD~1')
      ? git(cwd, ['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD~1', 'HEAD'])
      : git(cwd, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', 'HEAD']);
  }
  if (out === null) return { mode: null, files: [] };

  const managed = managedFiles(cwd, mode);
  let files = splitNul(out).filter(f => !managed.has(f));
  if (Array.isArray(extensions) && extensions.length > 0) {
    files = files.filter(f => extensions.some(ext => f.endsWith(ext)));
  }
  return { mode, files };
}

/**
 * New paths of the PURE renames in the snapshot: files whose content is
 * identical to a file removed in the same change (same blob, git R100). The
 * pair compared is the one changedFiles uses: HEAD -> index when staged,
 * HEAD~1 -> HEAD in last-commit mode; a root commit (or an index with no HEAD)
 * has no renames. A rename with any content change is not listed.
 * @param {string} dir - Directory inside the repository
 * @param {'staged'|'last-commit'|null} mode - Snapshot (from changedFiles)
 * @returns {Set<string>}
 */
function pureRenames(dir, mode) {
  const cwd = dir || process.cwd();
  const raw = ['--raw', '-z', '--no-abbrev', '-M', '--diff-filter=R'];
  let out = null;
  if (mode === 'staged' && hasCommit(cwd, 'HEAD')) {
    out = git(cwd, ['diff', '--cached', ...raw, 'HEAD']);
  } else if (mode === 'last-commit' && hasCommit(cwd, 'HEAD~1')) {
    out = git(cwd, ['diff', ...raw, 'HEAD~1', 'HEAD']);
  }
  const renamed = new Set();
  if (out === null) return renamed;
  // Each record: ":<src mode> <dst mode> <src blob> <dst blob> R<score>" NUL old NUL new NUL.
  const parts = splitNul(out);
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const fields = parts[i].replace(/^:/, '').split(' ');
    if (fields.length === 5 && fields[2] === fields[3]) renamed.add(parts[i + 2]);
  }
  return renamed;
}

/**
 * Paths listed in the harness registry: read from the snapshot being evaluated,
 * falling back to the working copy at the repository root. A missing or
 * malformed registry excludes nothing.
 * @returns {Set<string>}
 */
function managedFiles(cwd, mode) {
  let text = readFile(cwd, MANAGED_REGISTRY, mode);
  if (text === null && mode !== null) {
    const top = git(cwd, ['rev-parse', '--show-toplevel']);
    text = readFile(top ? top.toString('utf-8').trim() : cwd, MANAGED_REGISTRY, null);
  }
  if (text === null) return new Set();
  try {
    const data = JSON.parse(text);
    // Older installs wrote a list of paths; current ones { kernelVersion, files: [{ path, sha256 }] }.
    if (Array.isArray(data)) return new Set(data.filter(f => typeof f === 'string'));
    if (data && Array.isArray(data.files)) {
      const paths = data.files.map(f => f && f.path).filter(f => typeof f === 'string');
      return new Set([...paths, MANAGED_REGISTRY]);
    }
  } catch {
    // Malformed registry: exclude nothing.
  }
  return new Set();
}

/** Object name of a path in the snapshot (paths are relative to the repo root). */
function objectName(file, mode) {
  return mode === 'staged' ? `:0:${file}` : `HEAD:${file}`;
}

/**
 * Reads a file from the snapshot.
 * With mode null (no git) the working copy is the only source there is.
 * @returns {string|null} UTF-8 content; null when missing or binary
 */
function readFile(dir, file, mode) {
  const cwd = dir || process.cwd();
  let buffer;
  if (mode === null || mode === undefined) {
    try {
      buffer = fs.readFileSync(path.join(cwd, file));
    } catch {
      return null;
    }
  } else {
    buffer = git(cwd, ['cat-file', 'blob', objectName(file, mode)]);
    if (buffer === null) return null;
  }
  if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) return null;
  return buffer.toString('utf-8');
}

/**
 * True when the path exists in the snapshot (the working copy when mode is null).
 * @returns {boolean}
 */
function exists(dir, file, mode) {
  const cwd = dir || process.cwd();
  if (mode === null || mode === undefined) return fs.existsSync(path.join(cwd, file));
  return git(cwd, ['cat-file', '-e', objectName(file, mode)]) !== null;
}

/**
 * Lists every file of the snapshot, for whole-repository facts (e.g. a name
 * that must be unique, a link target that must exist): the index in staged
 * mode, HEAD in last-commit mode. Paths are relative to the repository root
 * and sorted; nothing is excluded. With mode null (no git) nothing is listed.
 * @param {string} dir - Directory inside the repository
 * @param {'staged'|'last-commit'|null} mode - Snapshot (from changedFiles)
 * @returns {string[]}
 */
function listFiles(dir, mode) {
  const cwd = dir || process.cwd();
  if (mode !== 'staged' && mode !== 'last-commit') return [];
  const out = mode === 'staged'
    ? git(cwd, ['ls-files', '-z', '--cached', '--full-name', '--', ':/'])
    : git(cwd, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', 'HEAD']);
  if (out === null) return [];
  return [...new Set(splitNul(out))].sort();
}

/**
 * Dependencies of the nearest package.json of a repository path, read from the
 * snapshot: the file's directory, then each parent up to the repository root
 * (a monorepo part's own package.json wins over the root one). Results are
 * memoized per directory in `cache` when one is passed.
 * @param {string} dir - Directory inside the repository
 * @param {string} file - Path relative to the repository root
 * @param {'staged'|'last-commit'|null} mode - Snapshot (from changedFiles)
 * @param {Map<string, object|null>} [cache] - Directory -> dependencies
 * @returns {object|null} dependencies + devDependencies; null without a package.json
 */
function nearestPackageDeps(dir, file, mode, cache = new Map()) {
  const visited = [];
  let current = path.posix.dirname(file);
  let deps = null;
  for (;;) {
    const key = current === '.' ? '' : current;
    if (cache.has(key)) {
      deps = cache.get(key);
      break;
    }
    visited.push(key);
    const raw = readFile(dir, key ? `${key}/package.json` : 'package.json', mode);
    if (raw !== null) {
      try {
        const pkg = JSON.parse(raw);
        deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      } catch {
        deps = {};
      }
      break;
    }
    if (!key) break;
    current = path.posix.dirname(key);
  }
  for (const key of visited) cache.set(key, deps);
  return deps;
}

module.exports = { changedFiles, pureRenames, readFile, exists, listFiles, nearestPackageDeps };
