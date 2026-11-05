/**
 * CLC Kernel — Universal Auto-Discovery Engine
 * Inspects repository signatures to auto-match the right polyglot Stack Adapter
 * (Next.js, FastAPI, Django, Astro, Rails, Go, Rust, Laravel), plus library
 * adapters for monorepo parts (TypeScript, JavaScript, Python, PHP, Ruby).
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
const TypeScriptLibraryAdapter = require('./adapters/typescript-library');
const JavaScriptLibraryAdapter = require('./adapters/javascript-library');
const PythonLibraryAdapter = require('./adapters/python-library');
const PhpLibraryAdapter = require('./adapters/php-library');
const RubyLibraryAdapter = require('./adapters/ruby-library');
const { TechnologyDetector } = require('./technologies/detector');

/**
 * Root-level detection options from .clckernel.yaml: the configured SQL
 * migration globs (sql_migrations.paths). An unreadable or invalid config
 * gives none; install and update report that config error themselves.
 * @param {string} targetDir - Project root
 * @returns {{ sqlMigrationPaths?: string[] }}
 */
function rootTechOptions(targetDir) {
  try {
    const { readProjectConfig } = require('./config');
    return { sqlMigrationPaths: readProjectConfig(targetDir).config.sql_migrations.paths };
  } catch {
    return {};
  }
}

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
 * Library adapters (sdds/monorepo-library-parts): tried only on part
 * subdirectories that no adapter above matched, in this order (TypeScript
 * before JavaScript, same `node` ecosystem). Never on the root, never offered
 * as a stack. Go and Rust need none: their adapters match plain modules/crates.
 */
const PART_ONLY_ADAPTERS = [
  new TypeScriptLibraryAdapter(),
  new JavaScriptLibraryAdapter(),
  new PythonLibraryAdapter(),
  new PhpLibraryAdapter(),
  new RubyLibraryAdapter(),
];

/** True for an adapter that only ever describes a part (a library adapter). */
function isPartOnly(adapter) {
  return PART_ONLY_ADAPTERS.some((a) => a.constructor === adapter.constructor);
}

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
  const detectedTechs = techDetector.detect(targetDir, rootTechOptions(targetDir));
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
  'TypeScript Library': 'node',
  'JavaScript Library': 'node',
  'Python Library': 'python',
  'PHP Library': 'php',
  'Ruby Library': 'ruby',
};

/**
 * Conventional part locations: a literal dir or `dir/*` (one level below dir).
 * `libs/*` is Nx's library dir. `crates/*` is not here on purpose: a Cargo
 * workspace root is one part (see rootCoversRustMembers).
 */
const CONVENTIONAL_PART_DIRS = [
  'frontend', 'backend', 'web', 'api', 'server', 'client', 'apps/*', 'services/*', 'packages/*', 'libs/*',
];

/** Directories never inspected as parts. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build']);

/** Maximum depth of a part below the root (`apps/web` is 2, `packages/scope/pkg` is 3). */
const MAX_PART_DEPTH = 3;

/** Package manifests: a `dir/**` walk stops descending at a dir holding one. */
const MANIFESTS = [
  'package.json', 'project.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'composer.json',
  'Gemfile', 'go.mod', 'Cargo.toml',
];

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
 * Module dirs of go.work `use` directives, single-line or block form.
 * @param {string} targetDir - Project root
 * @returns {string[]}
 */
function goWorkDirs(targetDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(targetDir, 'go.work'), 'utf-8');
  } catch {
    return [];
  }
  const dirs = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (inBlock) {
      if (line === ')') inBlock = false;
      else if (line) dirs.push(line);
      continue;
    }
    if (/^use\s*\($/.test(line)) inBlock = true;
    else if (/^use\s+\S+$/.test(line)) dirs.push(line.replace(/^use\s+/, ''));
  }
  return dirs.map((d) => d.replace(/^"(.*)"$/, '$1'));
}

/**
 * Workspace patterns declared by the root: package.json `workspaces` (array
 * or `{ packages }`), lerna.json `packages`, go.work `use` dirs and
 * pnpm-workspace.yaml `packages:` entries.
 * @param {string} targetDir - Project root
 * @returns {string[]}
 */
function workspacePatterns(targetDir) {
  const patterns = [];
  const pkg = readJson(path.join(targetDir, 'package.json'));
  const ws = pkg && pkg.workspaces;
  const list = Array.isArray(ws) ? ws : (ws && Array.isArray(ws.packages) ? ws.packages : []);
  patterns.push(...list.filter((p) => typeof p === 'string'));

  const lerna = readJson(path.join(targetDir, 'lerna.json'));
  if (lerna && Array.isArray(lerna.packages)) patterns.push(...lerna.packages.filter((p) => typeof p === 'string'));
  patterns.push(...goWorkDirs(targetDir));

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

/** Subdirectory names of a dir (none of SKIPPED_DIRS, no symlinks); [] when unreadable. */
function subdirs(abs) {
  try {
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIPPED_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** True when the dir holds a package manifest (see MANIFESTS) or a *.gemspec. */
function hasManifest(abs) {
  try {
    return fs.readdirSync(abs).some((name) => MANIFESTS.includes(name) || name.endsWith('.gemspec'));
  } catch {
    return false;
  }
}

/**
 * Directories a pattern names, without a glob engine (on purpose): literal
 * segments, `*` segments (every subdirectory, e.g. `dir/*` or `dir/*\/*`) and
 * a trailing `**` (every subdirectory below, stopping at a dir that holds a
 * manifest), never deeper than MAX_PART_DEPTH. Other glob forms (`pkg-*`,
 * `{a,b}`, negations) are ignored.
 * @param {string} targetDir - Project root
 * @param {string} pattern - Workspace or conventional pattern
 * @returns {string[]} Relative dirs (posix separators)
 */
function expandPattern(targetDir, pattern) {
  const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  const segments = clean.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..') || segments.some((seg, i) => (seg === '**' ? i !== segments.length - 1 : seg !== '*' && /[*?[\]{}!]/.test(seg)))) {
    return [];
  }
  let rels = [''];
  for (const seg of segments) {
    if (seg === '**') return rels.flatMap((rel) => walk(targetDir, rel));
    const next = [];
    for (const rel of rels) {
      const names = seg === '*' ? subdirs(path.join(targetDir, rel)) : [seg];
      next.push(...names.map((name) => (rel ? `${rel}/${name}` : name)));
    }
    rels = next.filter((rel) => rel.split('/').length <= MAX_PART_DEPTH);
  }
  return rels;
}

/** Every dir below rel (for a trailing `**`), up to MAX_PART_DEPTH, not descending past a manifest. */
function walk(targetDir, rel) {
  const found = [];
  const visit = (current) => {
    for (const name of subdirs(path.join(targetDir, current))) {
      const child = current ? `${current}/${name}` : name;
      if (child.split('/').length > MAX_PART_DEPTH) continue;
      found.push(child);
      if (!hasManifest(path.join(targetDir, child))) visit(child);
    }
  };
  visit(rel);
  return found;
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

/**
 * Code adapters (never Agent-OS) matching dir, at most one per ecosystem, in
 * list order. `candidates` defaults to the root-capable adapters.
 */
function codeAdaptersFor(dir, candidates = adapters) {
  const seen = new Set();
  const found = [];
  for (const adapter of candidates) {
    if (adapter.projectType === 'agent-os' || !adapter.detect(dir)) continue;
    const ecosystem = ECOSYSTEMS[adapter.name] || adapter.name;
    if (seen.has(ecosystem)) continue;
    seen.add(ecosystem);
    found.push(adapter);
  }
  return found;
}

/**
 * Adapters of a part subdir: the framework ones, or, when none matched, the
 * library ones (sdds/monorepo-library-parts), each per-dir via forDir.
 */
function partAdaptersFor(abs) {
  const frameworks = codeAdaptersFor(abs);
  const found = frameworks.length > 0 ? frameworks : codeAdaptersFor(abs, PART_ONLY_ADAPTERS);
  return found.map((adapter) => (typeof adapter.forDir === 'function' ? adapter.forDir(abs) : adapter));
}

/**
 * True when the root Cargo.toml declares a `[workspace]`: `cargo test` and
 * `cargo clippy` at the root already cover every member crate, so member
 * crates are not parts of their own (they would run twice).
 */
function rootCoversRustMembers(targetDir) {
  try {
    return /^\s*\[workspace\]\s*$/m.test(fs.readFileSync(path.join(targetDir, 'Cargo.toml'), 'utf-8'));
  } catch {
    return false;
  }
}

/**
 * Code parts of a repository (sdds/fullstack-monorepo, decision 1): the root,
 * declared workspaces and conventional dirs, each tested against the code
 * adapters. Agent-OS is never a part. Root parts come first, then subdir
 * parts sorted by dir.
 *
 * A subdir no framework adapter matches is tried against the library adapters
 * (sdds/monorepo-library-parts); library parts count on their own, so a
 * library-only monorepo is a monorepo. The root is never a library part, so a
 * repository without library subdirs is detected as before. An Agent-OS root
 * whose only parts are libraries stays Agent-OS.
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
  const rustWorkspace = parts.some((p) => ECOSYSTEMS[p.adapter.name] === 'rust') && rootCoversRustMembers(targetDir);
  for (const rel of [...dirs].sort()) {
    for (const adapter of partAdaptersFor(path.join(targetDir, rel))) {
      if (rustWorkspace && ECOSYSTEMS[adapter.name] === 'rust') continue;
      parts.push({ dir: rel, adapter });
    }
  }
  const kept = dropCoveredJavaScriptLibraries(parts);
  const librariesOnly = kept.length > 0 && kept.every((p) => isPartOnly(p.adapter));
  if (librariesOnly && agentOsRoot(targetDir)) return [];
  return kept;
}

/**
 * A JavaScript Library part has no tool of its own: it only brings the JS
 * guards. When another node part (Next.js, Astro, a TypeScript Library)
 * already installs them it adds nothing, so it is dropped; a Next.js root
 * with plain JS workspace packages stays single-stack, as before.
 */
function dropCoveredJavaScriptLibraries(parts) {
  const isJsLib = (p) => p.adapter.constructor === JavaScriptLibraryAdapter;
  const nodeCovered = parts.some((p) => !isJsLib(p) && ECOSYSTEMS[p.adapter.name] === 'node');
  return nodeCovered ? parts.filter((p) => !isJsLib(p)) : parts;
}

/** True when the Agent-OS adapter matches the root. */
function agentOsRoot(targetDir) {
  return adapters.some((a) => a.projectType === 'agent-os' && a.detect(targetDir));
}

/** Technology tools detected in the root and every part dir, deduplicated by name. */
function partsTechTools(targetDir, parts) {
  const techDetector = new TechnologyDetector();
  const tools = [];
  const dirs = ['.', ...parts.map((p) => p.dir)];
  for (const rel of [...new Set(dirs)]) {
    const options = rel === '.' ? rootTechOptions(targetDir) : {};
    for (const tool of techDetector.getToolsForTech(techDetector.detect(path.join(targetDir, rel), options))) {
      const known = tools.find((t) => t.name === tool.name);
      if (known) {
        for (const tech of tool.technologies || []) if (!known.technologies.includes(tech)) known.technologies.push(tech);
        continue;
      }
      tools.push({ ...tool, technologies: [...(tool.technologies || [])] });
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
  // The first framework part; a library part stands for the repo only when
  // every part is a library.
  const primary = parts.find((p) => !isPartOnly(p.adapter)) || parts[0];
  return {
    projectType: parts.some((p) => p.dir === '.') ? 'fullstack' : 'monorepo',
    // The primary part's name, like `adapter`: code that reads one
    // framework keeps working; `parts` lists all of them.
    framework: primary.adapter.name,
    styling: hasFront ? 'Tailwind CSS v4' : 'N/A',
    uiLibrary: hasFront ? 'Component Primitives' : 'N/A',
    testRunner: parts.map((p) => `${p.adapter.testRunner} (${p.dir})`).join(', '),
    gitHooks: fs.existsSync(path.join(targetDir, '.husky')) ? 'husky' : 'githooks',
    orm: 'Framework Native',
    adapter: primary.adapter,
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
