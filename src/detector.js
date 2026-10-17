/**
 * CLC Kernel — Universal Auto-Discovery Engine
 * Inspects repository signatures to auto-match the right polyglot Stack Adapter
 * (Next.js, FastAPI, Django, Astro, Rails, Go, Rust, Laravel).
 */

const fs = require('fs');
const path = require('path');

const NextjsAdapter = require('./adapters/nextjs');
const FastApiAdapter = require('./adapters/fastapi');
const DjangoAdapter = require('./adapters/django');
const AstroAdapter = require('./adapters/astro');
const RailsAdapter = require('./adapters/rails');
const GoAdapter = require('./adapters/go');
const RustAdapter = require('./adapters/rust');
const LaravelAdapter = require('./adapters/laravel');
const AgentOSAdapter = require('./adapters/agent-os');
const { TechnologyDetector } = require('./technologies/detector');

const adapters = [
  new AgentOSAdapter(),
  new NextjsAdapter(),
  new FastApiAdapter(),
  new DjangoAdapter(),
  new AstroAdapter(),
  new RailsAdapter(),
  new GoAdapter(),
  new RustAdapter(),
  new LaravelAdapter()
];

/**
 * Builds the project config for a given adapter, exactly as auto-detection
 * does for a matched adapter. A null adapter yields the generic config.
 * Used by autoDetectStack and by the "Elegir otro stack" prompt, so a stack
 * chosen by hand provisions exactly what a detected one would.
 * @param {string} targetDir - Project root
 * @param {object|null} adapter - One of `adapters`, or null for generic
 * @returns {object} Project config
 */
function buildStackConfig(targetDir, adapter) {
  // Phase-1 technologies (Celery, Redis, PostgreSQL, Docker)
  const techDetector = new TechnologyDetector();
  const detectedTechs = techDetector.detect(targetDir);
  const techTools = techDetector.getToolsForTech(detectedTechs);
  const gitHooks = fs.existsSync(path.join(targetDir, '.husky')) ? 'husky' : 'githooks';

  if (!adapter) {
    // No adapter: report the stack as unknown instead of guessing one; the
    // generator installs a generic, stack-agnostic harness.
    return {
      projectType: 'unknown',
      framework: 'unknown',
      styling: 'none',
      uiLibrary: 'none',
      testRunner: 'unknown',
      gitHooks,
      orm: 'none',
      adapter: null,
      techTools
    };
  }

  return {
    projectType: adapter.projectType,
    framework: adapter.name,
    styling: adapter.projectType === 'frontend' ? 'Tailwind CSS v4' : 'N/A',
    uiLibrary: adapter.projectType === 'frontend' ? 'Component Primitives' : 'N/A',
    testRunner: adapter.testRunner,
    gitHooks,
    orm: 'Framework Native',
    adapter,
    techTools
  };
}

/** Ecosystem of each code adapter: one directory gets at most one part per ecosystem. */
const ECOSYSTEMS = {
  'Next.js (App Router)': 'node',
  'Astro Framework': 'node',
  'FastAPI Framework': 'python',
  'Django Framework': 'python',
  'Ruby on Rails': 'ruby',
  'Go (Golang)': 'go',
  'Rust Engine': 'rust',
  'PHP / Laravel': 'php',
};

/** Conventional part locations: a literal dir or `dir/*` (one level below dir). */
const CONVENTIONAL_PART_DIRS = [
  'frontend', 'backend', 'web', 'api', 'server', 'client', 'apps/*', 'services/*', 'packages/*',
];

/** Directories never inspected as parts. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build']);

/** Maximum depth of a part below the root (`apps/web` is 2). */
const MAX_PART_DEPTH = 2;

/**
 * Part dirs go into the hook inside quotes; only plain relative names are
 * accepted so no quoting or expansion can ever be involved.
 */
const SAFE_PART_DIR = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Workspace patterns declared by the root: package.json `workspaces` (array
 * or `{ packages }`) and pnpm-workspace.yaml `packages:` entries.
 * @param {string} targetDir - Project root
 * @returns {string[]}
 */
function workspacePatterns(targetDir) {
  const patterns = [];
  const pkg = readJson(path.join(targetDir, 'package.json'));
  const ws = pkg && pkg.workspaces;
  const list = Array.isArray(ws) ? ws : (ws && Array.isArray(ws.packages) ? ws.packages : []);
  patterns.push(...list.filter((p) => typeof p === 'string'));

  let yaml = '';
  try {
    yaml = fs.readFileSync(path.join(targetDir, 'pnpm-workspace.yaml'), 'utf-8');
  } catch {
    return patterns;
  }
  let inPackages = false;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (/^\S/.test(line)) {
      inPackages = /^packages\s*:\s*$/.test(line);
      continue;
    }
    const item = inPackages && line.match(/^\s+-\s+(['"]?)([^'"]+)\1\s*$/);
    if (item) patterns.push(item[2].trim());
  }
  return patterns;
}

/**
 * Directories a pattern names: a literal relative dir, or `dir/*` for every
 * subdirectory of dir. Other glob forms (`**`, `{a,b}`, negations) are
 * ignored: there is no glob engine here, on purpose.
 * @param {string} targetDir - Project root
 * @param {string} pattern - Workspace or conventional pattern
 * @returns {string[]} Relative dirs (posix separators)
 */
function expandPattern(targetDir, pattern) {
  const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  const star = clean.match(/^([^*?[\]{}!]+)\/\*$/);
  if (star) {
    const base = star[1];
    let entries;
    try {
      entries = fs.readdirSync(path.join(targetDir, base), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory()).map((e) => `${base}/${e.name}`);
  }
  return /[*?[\]{}!]/.test(clean) || !clean ? [] : [clean];
}

/** True when rel is a directory worth inspecting as a part. */
function isCandidateDir(targetDir, rel) {
  const segments = rel.split('/');
  if (segments.length > MAX_PART_DEPTH || !SAFE_PART_DIR.test(rel)) return false;
  if (segments.some((s) => SKIPPED_DIRS.has(s) || s === '.' || s === '..')) return false;
  try {
    return fs.lstatSync(path.join(targetDir, rel)).isDirectory();
  } catch {
    return false;
  }
}

/** Code adapters (never Agent-OS) matching dir, at most one per ecosystem, in list order. */
function codeAdaptersFor(dir) {
  const seen = new Set();
  const found = [];
  for (const adapter of adapters) {
    if (adapter.projectType === 'agent-os' || !adapter.detect(dir)) continue;
    const ecosystem = ECOSYSTEMS[adapter.name] || adapter.name;
    if (seen.has(ecosystem)) continue;
    seen.add(ecosystem);
    found.push(adapter);
  }
  return found;
}

/**
 * Code parts of a repository (sdds/fullstack-monorepo, decision 1): the root,
 * declared workspaces and conventional dirs, each tested against the code
 * adapters. Agent-OS is never a part. Root parts come first, then subdir
 * parts sorted by dir.
 * @param {string} targetDir - Project root
 * @returns {Array<{dir: string, adapter: object}>}
 */
function detectParts(targetDir) {
  const parts = codeAdaptersFor(targetDir).map((adapter) => ({ dir: '.', adapter }));
  const dirs = new Set();
  for (const pattern of [...workspacePatterns(targetDir), ...CONVENTIONAL_PART_DIRS]) {
    for (const rel of expandPattern(targetDir, pattern)) {
      if (isCandidateDir(targetDir, rel)) dirs.add(rel);
    }
  }
  for (const rel of [...dirs].sort()) {
    for (const adapter of codeAdaptersFor(path.join(targetDir, rel))) parts.push({ dir: rel, adapter });
  }
  return parts;
}

/** Technology tools detected in the root and every part dir, deduplicated by name. */
function partsTechTools(targetDir, parts) {
  const techDetector = new TechnologyDetector();
  const tools = [];
  const names = new Set();
  const dirs = ['.', ...parts.map((p) => p.dir)];
  for (const rel of [...new Set(dirs)]) {
    for (const tool of techDetector.getToolsForTech(techDetector.detect(path.join(targetDir, rel)))) {
      if (names.has(tool.name)) continue;
      names.add(tool.name);
      tools.push(tool);
    }
  }
  return tools;
}

/**
 * Config of a multi-part repository. `adapter` and `framework` are the first
 * part's, kept for code that reads one stack; `parts` drives provisioning.
 * projectType is 'monorepo' when no part sits at the root, else 'fullstack'.
 * @param {string} targetDir - Project root
 * @param {Array<{dir: string, adapter: object}>} parts - From detectParts
 * @returns {object} Project config
 */
function buildPartsConfig(targetDir, parts) {
  const hasFront = parts.some((p) => p.adapter.projectType === 'frontend');
  return {
    projectType: parts.some((p) => p.dir === '.') ? 'fullstack' : 'monorepo',
    // The first part's name, like `adapter`: code that reads one framework
    // keeps working; `parts` lists all of them.
    framework: parts[0].adapter.name,
    styling: hasFront ? 'Tailwind CSS v4' : 'N/A',
    uiLibrary: hasFront ? 'Component Primitives' : 'N/A',
    testRunner: parts.map((p) => `${p.adapter.testRunner} (${p.dir})`).join(', '),
    gitHooks: fs.existsSync(path.join(targetDir, '.husky')) ? 'husky' : 'githooks',
    orm: 'Framework Native',
    adapter: parts[0].adapter,
    parts: parts.map((p) => ({
      dir: p.dir,
      adapter: p.adapter,
      framework: p.adapter.name,
      projectType: p.adapter.projectType,
      testRunner: p.adapter.testRunner,
    })),
    techTools: partsTechTools(targetDir, parts),
  };
}

/**
 * Detects the project config. One code part at the root (or none) keeps the
 * single-stack config exactly as before: adapters are tried in list order,
 * except that a code stack beats Agent-OS (sdds/agent-os-generic, decision 1).
 * Several parts, or a part in a subdir, yield a multi-part config
 * (sdds/fullstack-monorepo).
 * @param {string} targetDir - Project root
 * @returns {object} Project config
 */
function autoDetectStack(targetDir) {
  const parts = detectParts(targetDir);
  if (parts.length > 1 || (parts.length === 1 && parts[0].dir !== '.')) {
    return buildPartsConfig(targetDir, parts);
  }
  const matched = adapters.filter((a) => a.detect(targetDir));
  const adapter = matched.find((a) => a.projectType !== 'agent-os') || matched[0] || null;
  return buildStackConfig(targetDir, adapter);
}

module.exports = { autoDetectStack, buildStackConfig, detectParts, adapters };
