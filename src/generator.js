/**
 * CLC Kernel — Universal Provisioning Engine
 * Manifest-driven tool installation and dynamic pre-commit hook generation.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readProjectConfig, globMatcher } = require('./config.js');
const { createIO, runWithIO, activeIO, currentIO, registeredPaths, MANAGED_REGISTRY } = require('./io');

/**
 * Shell condition that decides at commit time whether an external tool runs.
 * Adapters declare it as `availableIf`; a tool without one falls back to
 * `command -v <extCLI or first word of the command>`. A compound condition
 * (&&, ||, ;, |) is grouped in braces so the redirect silences all of it —
 * `{ ...; }` is valid in both POSIX sh (husky hooks) and bash.
 * @param {object} tool - External tool descriptor
 * @returns {string}
 */
function availabilityCondition(tool) {
  const cond = (tool.availableIf || `command -v ${tool.extCLI || tool.command.split(/\s+/)[0]}`).trim();
  return /&&|\|\||;|\|/.test(cond) ? `{ ${cond}; }` : cond;
}

/**
 * Hook line for an external tool: run it when available (a failure aborts
 * the commit under `set -e`), otherwise say it was skipped instead of
 * omitting it silently.
 * @param {object} tool - External tool descriptor
 * @returns {string}
 */
function guardedCommand(tool, managed = []) {
  return `if ${availabilityCondition(tool)} >/dev/null 2>&1; then ${withManagedExcludes(tool, managed)}; ` +
    `else echo "clckernel: ${tool.name} not available, skipped"; fi`;
}

/**
 * Appends the harness's own files to a whole-project linter's exclusions.
 * A tool opts in with `excludeManaged: { flag, extensions }` (e.g. ruff's
 * --extend-exclude for .py); without managed files of those extensions the
 * command is unchanged.
 * @param {object} tool - External tool descriptor
 * @param {string[]} managed - Paths listed in the registry
 * @returns {string}
 */
function withManagedExcludes(tool, managed) {
  if (!tool.excludeManaged) return tool.command;
  const { flag, extensions } = tool.excludeManaged;
  const files = managed.filter(f => extensions.some(ext => f.endsWith(ext)));
  return files.length > 0 ? `${tool.command} ${flag} ${files.join(',')}` : tool.command;
}

/**
 * Reads the registry written by the last install/update (either format); []
 * when absent or malformed.
 * @param {string} targetDir - Target project root
 * @returns {string[]}
 */
function readManagedRegistry(targetDir) {
  return registeredPaths(targetDir);
}

/**
 * The sorted paths of every file this run installs into tools/, the registry
 * included: whole-project linters in the hook exclude them.
 * @param {string[]} toolFiles - File names installed into tools/
 * @returns {string[]}
 */
function managedToolPaths(toolFiles) {
  return [...new Set([...toolFiles.map(f => `tools/${f}`), MANAGED_REGISTRY])].sort();
}

/**
 * Writes the registry (sdds/safe-update, decision 2): every kernel-owned file
 * whose bytes are the kernel's after this run (tools/*, the hook, the skill),
 * with its sha256. Protected files are left out: their content is the
 * project's. The snapshot helpers (_changes.js/.py) drop these paths, and the
 * registry itself, from the files a guard evaluates.
 * @param {object} io - Active io session
 * @param {string} targetDir - Target project root
 */
function writeManagedRegistry(io, targetDir) {
  const { version } = require('../package.json');
  const registry = { kernelVersion: version, files: io.managedEntries() };
  io.writeFile(path.join(targetDir, MANAGED_REGISTRY), JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Builds the single tool manifest used both to copy guards into tools/ and to
 * generate the pre-commit hook, so every installed guard is also executed.
 * Technology tools (Celery, Redis, PostgreSQL, Docker) are inserted right
 * before check_custom, keeping the user-defined rules last; when the adapter
 * has no check_custom they are appended.
 * The adapter receives the project root, so an adapter may add guards whose
 * structure is present.
 * @param {object} adapter - Adapter with getTools(targetDir?)
 * @param {Array} [techTools] - Tools for detected technologies
 * @param {string} [targetDir] - Project root
 * @returns {Array} Merged tool manifest
 */
function buildToolManifest(adapter, techTools = [], targetDir) {
  const frameworkTools = adapter.getTools(targetDir);
  const checkCustomIdx = frameworkTools.findIndex(t => t.name === 'check_custom');
  if (checkCustomIdx < 0) return [...frameworkTools, ...techTools];
  return [
    ...frameworkTools.slice(0, checkCustomIdx),
    ...techTools,
    ...frameworkTools.slice(checkCustomIdx),
  ];
}

/** A guard is a manifest entry the kernel copies into tools/ (not an external CLI). */
function isGuard(tool) {
  return tool.language !== 'external' && !!tool.path;
}

/**
 * The manifest an install or update works with (sdds/update-no-additions,
 * decision 1). A fresh install keeps every guard. An update keeps only the
 * guards the project has: those in the hashed registry plus those present in
 * tools/ (a protected or project-owned file with a kernel guard's name is
 * still installed); an old path-list registry, or none, means present files
 * only. `addGuards` (names, or 'all') opts more in. Every other guard is
 * recorded as available. Non-guard entries (external CLIs) are kept.
 * @param {object} io - Active io session
 * @param {Array} tools - Tool manifest
 * @param {string[]|'all'} [addGuards] - Guards to add on update
 * @returns {Array} The manifest to install and run in the hook
 */
function selectGuards(io, tools, addGuards) {
  if (io.mode !== 'update') return tools;
  const addAll = addGuards === 'all';
  const add = new Set(Array.isArray(addGuards) ? addGuards : []);
  const registered = new Set(io.registry.format === 'hashed' ? io.registry.paths : []);
  return tools.filter(tool => {
    if (!isGuard(tool)) return true;
    const rel = `tools/${tool.path}`;
    if (addAll || add.has(tool.name) || registered.has(rel) || io.exists(rel)) return true;
    io.noteAvailable(tool.name);
    return false;
  });
}

/** Fallback files as guard descriptors (audit orchestrators excluded). */
function fallbackGuards(projectType) {
  const files = projectType === 'unknown' ? GENERIC_FALLBACK_FILES : LEGACY_FALLBACK_FILES;
  return files
    .filter(file => !/^audit\./.test(file))
    .map(file => ({ name: path.basename(file, path.extname(file)), language: path.extname(file).slice(1), path: file }));
}

/**
 * Names of the guards the stack's manifest offers (what --add-guards
 * accepts), in manifest order, once each.
 * @param {string} targetDir - Project root
 * @param {object} config - Detected config
 * @returns {string[]}
 */
function manifestGuardNames(targetDir, config) {
  const cfg = config || {};
  let guards;
  if (Array.isArray(cfg.parts) && cfg.parts.length > 0) {
    guards = buildPartsManifest(cfg.parts, cfg.techTools || [], targetDir).guards.filter(isGuard);
  } else if (cfg.adapter) {
    guards = buildToolManifest(cfg.adapter, cfg.techTools || [], targetDir).filter(isGuard);
  } else {
    guards = fallbackGuards(cfg.projectType);
  }
  return [...new Set(guards.map(tool => tool.name))];
}

/**
 * Guard block every hook starts with (sdds/unified-discovery): the hook runs
 * no guard itself. It calls the audit orchestrators with --hook, and they
 * discover and run every guard once — the kernel guards installed for the
 * project and the project guards (top-level tools/ guards the kernel does not
 * own, and tools/guards/*) — exactly the set `clckernel audit` runs. Each
 * orchestrator runs when it is installed (a Python stack needs no node); one
 * that is missing hands its guards to the other, and with neither the commit
 * fails. A failing guard or a crashing orchestrator aborts the commit under
 * `set -e`. POSIX sh-safe.
 */
const ORCHESTRATOR_BLOCK = [
  '# Guards: the audit orchestrators run every guard in tools/ once (kernel and project guards).',
  '[ -f tools/audit.js ] || [ -f tools/audit.py ] || { echo "clckernel: no audit orchestrator in tools/" >&2; exit 1; }',
  'if [ -f tools/audit.js ]; then node tools/audit.js --hook; fi',
  'if [ -f tools/audit.py ]; then python3 tools/audit.py --hook; fi',
];

/** Value core.hooksPath takes when the harness owns the repo's hooks. */
const GITHOOKS_DIR = '.githooks';

function runGit(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: !res.error && res.status === 0, out: (res.stdout || '').trim() };
}

/**
 * Points core.hooksPath at .githooks only when it is safe to do so:
 * (a) targetDir is the root of its git repository, and (b) the current value
 * is empty or already .githooks. Anything else (another hook manager such as
 * Husky, a monorepo subdirectory, no repository at all) is left untouched and
 * the manual command is printed instead.
 * @param {string} targetDir - Target project root
 * @returns {boolean} true when core.hooksPath is (now) .githooks
 */
function configureHooksPath(targetDir) {
  const toplevel = runGit(targetDir, ['rev-parse', '--show-toplevel']);
  if (!toplevel.ok || !toplevel.out) {
    console.warn(
      `Warning: ${targetDir} is not inside a git repository; core.hooksPath was not set.\n` +
        `  After \`git init\`, enable the hooks with: git config core.hooksPath ${GITHOOKS_DIR}`
    );
    return false;
  }

  const root = fs.realpathSync(toplevel.out);
  if (root !== fs.realpathSync(targetDir)) {
    const rel = path.join(path.relative(root, fs.realpathSync(targetDir)), GITHOOKS_DIR);
    console.warn(
      `Warning: ${targetDir} is not the root of its git repository (${root}); core.hooksPath was not set.\n` +
        `  To use these hooks for the whole repository run: git -C "${root}" config core.hooksPath ${rel}`
    );
    return false;
  }

  const current = runGit(targetDir, ['config', '--get', 'core.hooksPath']).out;
  if (current === GITHOOKS_DIR) return true;
  if (current) {
    console.warn(
      `Warning: core.hooksPath is already set to "${current}" (another hook manager?); it was left unchanged.\n` +
        `  To run the CLC Kernel hooks instead run: git config core.hooksPath ${GITHOOKS_DIR}`
    );
    return false;
  }

  return currentIO(targetDir).gitConfig(targetDir, 'core.hooksPath', GITHOOKS_DIR);
}

/** core.hooksPath values that mean Husky (v9: .husky/_, older: .husky) runs the hooks. */
const HUSKY_HOOKS_PATHS = new Set(['.husky', '.husky/_']);

/** True when Husky is the active hook manager of the repository at targetDir. */
function huskyActive(targetDir) {
  const current = runGit(targetDir, ['config', '--get', 'core.hooksPath']).out.replace(/\/+$/, '');
  return HUSKY_HOOKS_PATHS.has(current);
}

/**
 * Writes the pre-commit hook where git will run it: .husky/pre-commit only when
 * Husky is active for a frontend project; otherwise .githooks/pre-commit, with
 * core.hooksPath set through configureHooksPath (and its safety checks).
 * The orchestrator block (every guard) comes first, then the external tools.
 * @param {string} targetDir - Target project root
 * @param {boolean} isFront - Frontend project (may use Husky)
 * @param {string[]} commands - External tool lines
 * @param {string} banner - Text echoed when the hook starts
 * @returns {{ file: string, active: boolean }} Hook path relative to targetDir,
 *   and whether git runs it
 */
function writeHook(targetDir, isFront, commands, banner) {
  const useHusky = isFront && huskyActive(targetDir);
  const hookDir = path.join(targetDir, useHusky ? '.husky' : GITHOOKS_DIR);
  const hookFile = path.join(hookDir, 'pre-commit');

  const lines = [];
  if (useHusky) {
    lines.push('#!/usr/bin/env sh');
    // The husky bootstrap only exists with older Husky installs. Source it only
    // then, so a generated hook never points at a missing file.
    if (fs.existsSync(path.join(hookDir, '_', 'husky.sh'))) {
      lines.push('. "$(dirname -- "$0")/_/husky.sh"');
    }
  } else {
    lines.push('#!/usr/bin/env bash');
  }
  // Fail closed: any failing guard aborts the commit, not just the last one.
  lines.push('set -e');
  lines.push(`echo "${banner}"`);
  lines.push('');
  lines.push(...ORCHESTRATOR_BLOCK);
  lines.push(...commands);

  // Generated per project: overwritten only when it still matches the
  // registry's hash (sdds/safe-update, decision 3).
  const file = path.posix.join(useHusky ? '.husky' : GITHOOKS_DIR, 'pre-commit');
  const status = currentIO(targetDir).writeManaged(file, lines.join('\n') + '\n', { mode: '755' });

  const active = useHusky ? true : configureHooksPath(targetDir);
  return { file, active, status };
}

/**
 * Generates a pre-commit hook dynamically from the adapter's tool manifest.
 * The hook goes to .husky/pre-commit only for a frontend project whose
 * core.hooksPath already points at Husky; everything else uses .githooks.
 *
 * External CLIs (language === 'external', e.g. tsc, ruff, cargo) are wrapped in
 * a runtime availability check (see guardedCommand): the hook runs them when
 * the project has them at commit time and prints a "skipped" notice otherwise,
 * so installing a tool later needs no `clckernel update`.
 *
 * @param {object} adapter - Adapter with getTools() and projectType
 * @param {string} targetDir - Target project root
 * @param {Array} [tools] - Resolved tool manifest (see buildToolManifest).
 *   Defaults to adapter.getTools() when omitted.
 * @param {string[]} [managed] - Registered harness files (see writeManagedRegistry);
 *   defaults to the registry on disk
 * @returns {{ file: string, active: boolean }} The hook written and whether git runs it
 */
function generateHookFromManifest(adapter, targetDir, tools = adapter.getTools(), managed = readManagedRegistry(targetDir)) {
  const commands = tools
    .filter(tool => tool.command && tool.language === 'external')
    .map(tool => guardedCommand(tool, managed));
  return writeHook(targetDir, adapter.projectType === 'frontend', commands, `Running CLC Kernel ${adapter.name} Safeguards...`);
}

/** Single-quoted shell word (part dirs are already restricted to safe names). */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Hook line for an external tool of a part (sdds/fullstack-monorepo,
 * decision 4): it runs inside the part's dir, in a subshell so the cd does
 * not leak. A failing tool fails the subshell, and with it the hook under
 * `set -e`; a missing one prints a skip notice naming the dir.
 * @param {object} tool - External tool descriptor
 * @param {string} dir - Part dir relative to the root ('.' for the root)
 * @param {string[]} managed - Registered harness files (root-relative)
 * @returns {string}
 */
function partGuardedCommand(tool, dir, managed = []) {
  // Exclusions are relative to where the tool runs: only harness files inside the part apply.
  const local = dir === '.' ? managed : managed
    .filter(f => f.startsWith(`${dir}/`))
    .map(f => f.slice(dir.length + 1));
  const skip = `else echo "clckernel: ${tool.name} (${dir}) not available, skipped"; fi`;
  const bin = dir === '.' ? null : nodeBinOf(tool);
  if (bin) return `( cd ${shellQuote(dir)} && ${hoistedNodeBody(tool, bin, dir, local)} ${skip} )`;
  const body = `if ${availabilityCondition(tool)} >/dev/null 2>&1; then ${withManagedExcludes(tool, local)}; ${skip}`;
  return dir === '.' ? body : `( cd ${shellQuote(dir)} && ${body} )`;
}

/**
 * Name of the node_modules binary a Node-based external tool runs: its
 * availableIf is `[ -x node_modules/.bin/<bin> ]` and its command `npx <bin> ...`.
 * @param {object} tool - External tool descriptor
 * @returns {string|null}
 */
function nodeBinOf(tool) {
  const match = /^\[ -x node_modules\/\.bin\/([\w.@-]+) \]$/.exec((tool.availableIf || '').trim());
  if (!match) return null;
  return new RegExp(`^npx ${match[1].replace(/[.]/g, '\\.')}(\\s|$)`).test(tool.command) ? match[1] : null;
}

/**
 * `if/elif` branches of a part's Node tool (sdds/monorepo-gaps, gap 1): the
 * part's own node_modules/.bin/<bin> first, then the one hoisted to the
 * repository root by npm/yarn/pnpm workspaces. The branch runs the binary it
 * found (not npx), with cwd = the part dir. The caller appends the else/fi.
 * @param {object} tool - External tool descriptor (see nodeBinOf)
 * @param {string} bin - Binary name
 * @param {string} dir - Part dir relative to the root (not '.')
 * @param {string[]} local - Managed files relative to the part dir
 * @returns {string}
 */
function hoistedNodeBody(tool, bin, dir, local) {
  const args = withManagedExcludes(tool, local).slice(`npx ${bin}`.length);
  const up = dir.split('/').filter(Boolean).map(() => '..').join('/');
  return [`node_modules/.bin/${bin}`, `${up}/node_modules/.bin/${bin}`]
    .map((exe, i) => `${i === 0 ? 'if' : 'elif'} [ -x ${exe} ]; then ${exe}${args};`)
    .join(' ');
}

/**
 * Tool manifest of a multi-part repo (sdds/fullstack-monorepo, decision 3):
 * the guards of every part, once each (by file), with the technology tools
 * before the user-defined rules (check_custom), then each part's external
 * tools tagged with the part dir.
 * @param {Array<{dir: string, adapter: object}>} parts - config.parts
 * @param {Array} techTools - Tools for detected technologies
 * @param {string} targetDir - Project root
 * @returns {{ guards: Array, externals: Array<{tool: object, dir: string}> }}
 */
function buildPartsManifest(parts, techTools, targetDir) {
  const guards = [];
  const custom = [];
  const externals = [];
  const seen = new Set();
  const add = (list, tool) => {
    const key = tool.path || `${tool.name}:${tool.command}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(tool);
  };
  for (const part of parts) {
    for (const tool of part.adapter.getTools(path.join(targetDir, part.dir))) {
      if (tool.language === 'external') {
        const key = `${part.dir}\0${tool.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          externals.push({ tool, dir: part.dir });
        }
      } else {
        add(tool.name === 'check_custom' ? custom : guards, tool);
      }
    }
  }
  for (const tool of techTools) add(guards, tool);
  return { guards: [...guards, ...custom], externals };
}

/**
 * Writes the hook of a multi-part repo: every guard once from the root, then
 * each part's external tools in its dir. The hook goes to .husky only when a
 * part is frontend and Husky is active (same rule as a single stack).
 * @param {object} config - Multi-part config
 * @param {string} targetDir - Project root
 * @param {{ guards: Array, externals: Array }} manifest - From buildPartsManifest
 * @param {string[]} managed - Registered harness files
 * @returns {{ file: string, active: boolean }}
 */
function generatePartsHook(config, targetDir, manifest, managed) {
  const commands = manifest.externals.map(({ tool, dir }) => partGuardedCommand(tool, dir, managed));
  const isFront = config.parts.some(p => p.adapter.projectType === 'frontend');
  const names = [...new Set(config.parts.map(p => p.adapter.name))].join(' + ');
  return writeHook(targetDir, isFront, commands, `Running CLC Kernel ${names} Safeguards...`);
}

/** Audit orchestrator that discovers guards of each language. */
const ORCHESTRATORS = { '.js': 'audit.js', '.py': 'audit.py' };

/**
 * Copies one audit orchestrator per guard language installed in tools/:
 * audit.js discovers only .js guards and audit.py only .py ones, so a mixed
 * set (e.g. Next.js + docker_guard.py) gets both. With no guards at all,
 * audit.js is installed: Node is the one runtime known to exist.
 * @param {string} targetDir - Target project root
 * @param {string[]} copiedFiles - tools/ file names copied for this project
 * @returns {string[]} File names written into tools/
 */
function installOrchestrators(targetDir, copiedFiles) {
  const wanted = new Set(copiedFiles.map(f => ORCHESTRATORS[path.extname(f)]).filter(Boolean));
  if (wanted.size === 0) wanted.add('audit.js');
  const written = [];
  for (const file of wanted) {
    const src = path.join(__dirname, '..', 'tools', file);
    if (!fs.existsSync(src)) continue;
    currentIO(targetDir).copyManaged(src, `tools/${file}`, { mode: '755' });
    written.push(file);
  }
  return written;
}

/**
 * Shared modules the diff-based guards import from their own directory, by
 * guard language: the snapshot helper and the config reader it uses
 * (sdds/config-foundation), so a config added after install works without
 * `clckernel update`.
 */
const SNAPSHOT_HELPERS = { '.js': ['_changes.js', '_config.js', 'yaml.js'], '.py': ['_changes.py', '_config.py', '_yaml.py'] };

/**
 * Installs tools from an adapter's manifest into the target tools/ directory.
 * Only copies tools with valid descriptors. External CLIs are skipped (no file to copy).
 * Copies the audit orchestrator(s) matching the installed guards' languages.
 * @param {string} targetDir - Target project root
 * @param {Array} manifest - Tool manifest from adapter.getTools()
 * @param {object} config - Project config (projectType, framework, testRunner)
 * @returns {{ installed: string[], written: string[] }} Names of the guards copied,
 *   and every file name written into tools/
 */
function installToolsFromManifest(targetDir, manifest, config) {
  const sourceToolsDir = path.join(__dirname, '..', 'tools');
  const isFront = config.projectType === 'frontend';

  // tools/ must exist before anything is copied into it. Provisioning a project
  // that has no tools/ yet used to throw ENOENT on the first copyFileSync.
  currentIO(targetDir).mkdir(path.join(targetDir, 'tools'));

  // Validate descriptors: skip + warn tools missing required fields
  const validTools = manifest.filter(tool => {
    if (!tool.name || !tool.language || !tool.command) {
      console.warn(`Warning: tool "${tool.name || '(unnamed)'}" skipped - missing name, language, or command`);
      return false;
    }
    return true;
  });

  // Copy only custom tools with valid paths (skip external CLIs and empty paths)
  const installed = [];
  const copiedPaths = [];
  validTools.forEach(tool => {
    if (tool.language === 'external' || !tool.path) return;
    const srcFile = path.join(sourceToolsDir, tool.path);
    if (fs.existsSync(srcFile)) {
      currentIO(targetDir).copyManaged(srcFile, `tools/${tool.path}`, { mode: '755' });
      installed.push(tool.name);
      copiedPaths.push(tool.path);
    } else {
      console.warn(`Warning: tool "${tool.path}" declared by adapter but not found in bundled tools/. Skipping.`);
    }
  });

  const written = [...copiedPaths, ...installOrchestrators(targetDir, copiedPaths)];

  // check_custom.js parses the project YAML config, so the generated project
  // must ship the parser alongside it.
  if (validTools.some(tool => tool.path === 'check_custom.js')) {
    written.push(...installYamlModule(targetDir));
  }
  written.push(...installSnapshotHelpers(targetDir, copiedPaths));
  return { installed, written };
}

/**
 * Copies the zero-dependency YAML parser into the target's tools/ directory.
 *
 * It deliberately does NOT go into the consumer's src/: that directory belongs
 * to the project, and writing there both pollutes it and silently overwrites a
 * consumer file that happens to be named yaml.js. tools/ is the directory the
 * harness provisions and owns.
 *
 * @param {string} targetDir - Target project root
 * @returns {string[]} File names written into tools/
 */
function installYamlModule(targetDir) {
  const yamlSrc = path.join(__dirname, '..', 'tools', 'yaml.js');
  if (!fs.existsSync(yamlSrc)) return [];
  currentIO(targetDir).copyManaged(yamlSrc, 'tools/yaml.js');
  return ['yaml.js'];
}

/**
 * Copies the snapshot helper each installed guard imports as a sibling:
 * _changes.js (with its config reader _config.js and yaml.js) when any JS file
 * was copied into tools/, _changes.py (with _config.py and _yaml.py) when any
 * Python file was (technology guards can bring Python guards to a Node
 * stack). A stack without Python tools stays free of Python files. The `_`
 * prefix keeps the helpers out of the audit orchestrators' guard discovery.
 *
 * @param {string} targetDir - Target project root
 * @param {string[]} copiedFiles - tools/ file names copied for this project
 * @returns {string[]} File names written into tools/
 */
function installSnapshotHelpers(targetDir, copiedFiles) {
  const helpers = new Set(copiedFiles.flatMap(f => SNAPSHOT_HELPERS[path.extname(f)] || []));
  const written = [];
  for (const file of helpers) {
    const src = path.join(__dirname, '..', 'tools', file);
    if (!fs.existsSync(src)) continue;
    currentIO(targetDir).copyManaged(src, `tools/${file}`);
    written.push(file);
  }
  return written;
}

/** Generic harness for an unknown stack: Node is guaranteed (the user ran npx). */
const GENERIC_FALLBACK_FILES = ['audit.js', 'scan_secrets.js'];

/** Legacy fallback set, used when a stack was forced (frontend/backend) without an adapter. */
const LEGACY_FALLBACK_FILES = [
  'audit.js', 'audit.py',
  'scan_secrets.js', 'scan_secrets.py',
  'check_custom.js', 'check_custom.py',
  'check_responsive.js', 'check_seo.js',
  'check_db_efficiency.py'
];

/**
 * Installs a minimal fallback tool set when no adapter is provided.
 * An unknown stack gets only the JS audit orchestrator and secret scan; a
 * forced frontend/backend type keeps the legacy set.
 * @param {string} targetDir - Target project root
 * @param {string} [projectType] - Detected or forced project type
 * @param {(file: string) => boolean} [keep] - Files to install (update: the selected guards)
 * @returns {{ installed: string[], written: string[] }} Names of the guards copied
 *   (orchestrators excluded), and every file name written into tools/
 */
function installFallbackTools(targetDir, projectType, keep = () => true) {
  const sourceToolsDir = path.join(__dirname, '..', 'tools');
  const fallbackFiles = (projectType === 'unknown' ? GENERIC_FALLBACK_FILES : LEGACY_FALLBACK_FILES).filter(keep);

  const installed = new Set();
  const written = [];
  fallbackFiles.forEach(file => {
    const srcFile = path.join(sourceToolsDir, file);
    if (fs.existsSync(srcFile)) {
      currentIO(targetDir).copyManaged(srcFile, `tools/${file}`, { mode: '755' });
      written.push(file);
      const name = path.basename(file, path.extname(file));
      if (name !== 'audit') installed.add(name);
    }
  });

  if (fallbackFiles.includes('check_custom.js')) {
    written.push(...installYamlModule(targetDir));
  }
  written.push(...installSnapshotHelpers(targetDir, fallbackFiles));
  return { installed: [...installed], written };
}

/**
 * Generates a minimal generic pre-commit hook when no adapter is available:
 * the orchestrators run the installed fallback guards.
 * @param {string} targetDir - Target project root
 * @param {string} projectType - 'frontend', 'backend' or 'unknown'
 * @returns {{ file: string, active: boolean }} The hook written and whether git runs it
 */
function generateFallbackHook(targetDir, projectType) {
  return writeHook(targetDir, projectType === 'frontend', [], 'Running CLC Kernel Safeguards...');
}

/**
 * AGENTS.md of a multi-part repo (sdds/fullstack-monorepo, decision 6): one
 * law with a table of the parts and each part's stack rules grouped.
 * @param {object} config - Multi-part config
 * @returns {string}
 */
function partsAgentsMd(config) {
  const testRunner = "the part's test runner (see Parts)";
  const rows = config.parts.map(p => `| \`${p.dir}\` | ${p.adapter.name} | ${p.adapter.testRunner} |`).join('\n');
  const sections = config.parts.map((p, i) => `### 2.${i + 1} Core AI Safeguards — \`${p.dir}\` (${p.adapter.name})
${p.adapter.getSafeguards().map(s => `- ${s}`).join('\n')}`).join('\n\n');
  return `# CLC Kernel ${config.projectType.toUpperCase()} (${config.parts.length} parts) — AGENTS

This document is the **authoritative law** for AI agents working in this repository.
Forged by **CLC Kernel: The AI Agent Governance Engine**.

> **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (NO EXCEPTIONS)**
> Even when the user issues a direct or urgent fix request ("fix this bug", "fix this error", "quick fix"):
> YOU ARE STRICTLY FORBIDDEN from modifying source code directly without completing the full quality harness:
> 1. **Research & Root Cause Analysis:** Investigate tracebacks and inspect affected files before editing.
> 2. **TDD Verification (Red Phase):** Write a failing regression test first (${testRunner}).
> 3. **Clean Architecture Implementation (Green Phase):** Make the test pass maintaining layer isolation.
> 4. **Mandatory Educational Audit Gate:** Execute \`node tools/audit.js\` or \`python tools/audit.py\` and output the Educational Code Summary to stdout.
> NEVER declare success or skip verification commands for quick fixes.

## Parts
This repository has ${config.parts.length} code parts. The guards in \`tools/\` run once from the repository root; each part's external tools (linters, test runners) run inside the part's directory. A changed file's tests belong to the same part as the file.

| Directory | Stack | Test runner |
|---|---|---|
${rows}

## 1. The Loop (Every Task)
1. **Research** — Inspect codebase / docs before writing code.
2. **Plan** — Write an SDD under \`sdds/{change-name}/\`. SDDs live 100% locally and are gitignored.
3. **Test** (TDD) — Write failing test first (${testRunner}).
4. **Implement** — Make test pass.
5. **Verify & Audit** — Run \`node tools/audit.js\` or \`python tools/audit.py\`.
6. **DoD** — Lint, typecheck, tests, coverage, docs, memory.
7. **Commit** — Pre-commit hook runs automated guards.
8. **PR** — Generate PR body.

## 2. Core AI Safeguards (per part)

${sections}

${commandTable(testRunner)}`;
}

/**
 * The "Universal Command Interface" section shared by the generated AGENTS.md
 * files (fallback and multi-part). `clckernel update` looks for its rows.
 * @param {string} testRunner - Shown in the `clckernel test` row
 * @returns {string}
 */
function commandTable(testRunner) {
  return `## 3. Universal Command Interface (All LLMs & Agents)
When given a command matching \`clckernel <action>\` or \`/clckernel <action>\`, execute the deterministic state machine below:

| Command | Lifecycle Phase | Mandatory Execution Protocol |
|---|---|---|
| \`clckernel feature <name>\` | New Feature | 1. Research affected layers.<br>2. Author local spec in \`sdds/{name}/spec.md\`.<br>3. Present HIT review to user and wait for approval.<br>4. Write failing test (Red Phase).<br>5. Implement clean code (Green Phase).<br>6. Run \`node tools/audit.js\` (or \`audit.py\`). |
| \`clckernel fix <issue>\` | Bug Fix | 1. Investigate root cause (no code edits).<br>2. Reproduce with failing test (Red Phase).<br>3. Minimal surgical fix respecting Clean Arch (Green Phase).<br>4. Run audit gate without skipping. |
| \`clckernel test\` | Verification | Run test suite (\`${testRunner}\`) and verify clean pass (exit code 0). |
| \`clckernel audit\` | Verification | Run \`node tools/audit.js\` or \`python tools/audit.py\` and output the Educational Summary. |
| \`clckernel doctor\` | Diagnostics | Check git pre-commit hooks, IDE symlinks, and guard script integrity. |
| \`clckernel commit <message>\` | Version Control | Run full audit, verify tests pass, ensure no changes outside SDD scope, and commit with conventional commits (never add AI attribution). |
| \`clckernel guard create <name>\` | Safeguards | Scaffold a new guard script in the stack's native language in \`tools/guards/\`. |
| \`clckernel update\` | Maintenance | Non-destructive update: refresh core tools, playbooks & symlinks (preserves SDDs & custom guards). |
| \`clckernel start\` | Setup | Scan codebase, propose governance plan, and materialize \`.clckernel.yaml\`. |
`;
}

/**
 * Generate a harness for a target project from its detected stack
 * (`configOrNull`; null falls back to generic provisioning).
 * The project's .clckernel.yaml is read first (sdds/config-foundation): an
 * invalid one throws its ConfigError before anything is written. A caller
 * that already read it (update, the CLI) passes `options.projectConfig`.
 * @param {string} targetDir - Project root
 * @param {object|null} configOrNull - Detected stack config
 * @param {{ dryRun?: boolean, knownHashes?: object, addGuards?: string[]|'all',
 *   projectConfig?: { file: string|null, config: object, warnings: string[] } }} [options]
 */
function generateHarness(targetDir, configOrNull, options = {}) {
  let projectConfig = options.projectConfig;
  if (!projectConfig) {
    projectConfig = readProjectConfig(targetDir);
    for (const warning of projectConfig.warnings) console.warn(`Warning: ${warning}`);
  }
  const withConfig = { ...options, projectConfig };
  // One io session per install (sdds/safe-update): reuse the caller's (update)
  // or open one, real or dry-run.
  const active = activeIO();
  if (active) return generateHarnessWith(active, targetDir, configOrNull, withConfig);
  const io = createIO({
    root: targetDir,
    dryRun: !!options.dryRun,
    knownHashes: options.knownHashes,
    exclude: globMatcher(projectConfig.config.update.exclude),
  });
  const result = runWithIO(io, () => generateHarnessWith(io, targetDir, configOrNull, withConfig));
  if (result && typeof result === 'object' && !Array.isArray(result) && 'installedGuards' in result) {
    return { ...result, plan: io.plan() };
  }
  return result;
}

function generateHarnessWith(io, targetDir, configOrNull, options = {}) {
  // A null/absent config falls back to generic provisioning.
  const config = configOrNull || {};
  const { projectConfig } = options;

  const multiPart = Array.isArray(config.parts) && config.parts.length > 0;

  // Step 1: Provision directories + AGENTS.md
  if (multiPart) {
    // Directories and .gitignore as any adapter provisions them; the law file
    // is the multi-part one, never written over a project's own AGENTS.md.
    config.parts[0].adapter.provision(targetDir, { ...config, skipAgentsMd: true });
    if (!io.exists(path.join(targetDir, 'AGENTS.md'))) {
      io.writeFile(path.join(targetDir, 'AGENTS.md'), partsAgentsMd(config));
    }
  } else if (config.adapter) {
    config.adapter.provision(targetDir, config);
  } else {
    // Fallback: create directory structure + AGENTS.md
    const isFront = config.projectType === 'frontend';
    // Unknown stack: a Generic AGENTS.md with no stack-specific rules.
    const isGeneric = config.projectType === 'unknown';
    const frameworkLabel = isGeneric ? 'Generic' : (config.framework || 'Generic');
    const testRunner = isGeneric ? "the project's test runner" : (config.testRunner || 'npm test');

    io.mkdir(path.join(targetDir, 'docs', 'Journal'));
    io.mkdir(path.join(targetDir, 'docs', 'Architecture'));
    io.mkdir(path.join(targetDir, 'docs', 'Development'));
    io.mkdir(path.join(targetDir, 'sdds'));
    io.mkdir(path.join(targetDir, 'tools'));

    const { ensureGitignoreEntries } = require('./gitignore');
    ensureGitignoreEntries(targetDir);
    const gitkeep = path.join(targetDir, 'sdds', '.gitkeep');
    if (!io.exists(gitkeep)) io.writeFile(gitkeep, '');

    const agentsContent = `# CLC Kernel ${frameworkLabel} (${(config.projectType || 'unknown').toUpperCase()}) — AGENTS

This document is the **authoritative law** for AI agents working in this repository.
Forged by **CLC Kernel: The AI Agent Governance Engine**.

> **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (NO EXCEPTIONS)**
> Even when the user issues a direct or urgent fix request ("fix this bug", "fix this error", "quick fix"):
> YOU ARE STRICTLY FORBIDDEN from modifying source code directly without completing the full quality harness:
> 1. **Research & Root Cause Analysis:** Investigate tracebacks and inspect affected files before editing.
> 2. **TDD Verification (Red Phase):** Write a failing regression test first (${testRunner}).
> 3. **Clean Architecture Implementation (Green Phase):** Make the test pass maintaining layer isolation.
> 4. **Mandatory Educational Audit Gate:** Execute \`node tools/audit.js\` or \`python tools/audit.py\` and output the Educational Code Summary to stdout.
> NEVER declare success or skip verification commands for quick fixes.

## 1. The Loop (Every Task)
1. **Research** — Inspect codebase / docs before writing code.
2. **Plan** — Write an SDD under \`sdds/{change-name}/\`. SDDs live 100% locally and are gitignored.
3. **Test** (TDD) — Write failing test first (${testRunner}).
4. **Implement** — Make test pass.
5. **Verify & Audit** — Run \`node tools/audit.js\` or \`python tools/audit.py\`.
6. **DoD** — Lint, typecheck, tests, coverage, docs, memory.
7. **Commit** — Pre-commit hook runs automated guards.
8. **PR** — Generate PR body.

## 2. Core AI Safeguards
${isFront ? `- UI Component Reuse First (components/ui/ & semantic tokens)
- Responsive & Mobile-First Adaptability Guard
- SEO, GEO & Web Performance Guard
- Next.js Clean Architecture Guard
- Secret & Client Exposure Guard
- Accessibility & ARIA Guard (A11y)
- Zod API Contract Guard
- Next/Image & Tree-Shaking Guard
- Storybook Coverage Guard
- Educational Audit Gate
- Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)` : isGeneric ? `- Wait for Audit Gate
- Secret Leak Guard (tools/scan_secrets.js, run by the pre-commit hook)
- Scope protocol (agent-enforced; not checked by a guard)
- TDD protocol (agent-enforced; no verifier installed for this stack)
- Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)` : `- Wait for Audit Gate
- Scope protocol (agent-enforced; not checked by a guard)
- TDD protocol (agent-enforced; no verifier installed for this stack)
- Secret Leak Guard
- Clean Architecture protocol (agent-enforced; no layer guard installed for this stack)
- N+1 Heuristic (ORM-like calls inside loops, Python AST)
- Migration Reversibility protocol (agent-enforced; no migration guard installed for this stack)
- Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)`}

${commandTable(testRunner)}`;
    // Guard: never overwrite an existing project-customized AGENTS.md.
    // This prevents clckernel update from replacing project-specific
    // invariants the template cannot know about.
    if (!io.exists(path.join(targetDir, 'AGENTS.md'))) {
      io.writeFile(path.join(targetDir, 'AGENTS.md'), agentsContent);
    }

  }

  // Steps 2-3: Install tools and generate the pre-commit hook from the same
  // manifest, so every guard copied into tools/ is also run by the hook.
  // The registry of everything written into tools/ is recorded before the hook
  // is generated, so whole-project linters can exclude those files.
  let installedGuards;
  let hook;
  // On update only the guards the project has (plus --add-guards) are
  // installed and run (sdds/update-no-additions, decisions 1 and 4).
  const { addGuards } = options;
  if (multiPart) {
    const full = buildPartsManifest(config.parts, config.techTools || [], targetDir);
    const manifest = { ...full, guards: selectGuards(io, full.guards, addGuards) };
    const { installed, written } = installToolsFromManifest(targetDir, manifest.guards, config);
    installedGuards = installed;
    hook = generatePartsHook(config, targetDir, manifest, managedToolPaths(written));
  } else if (config.adapter) {
    const manifest = selectGuards(io, buildToolManifest(config.adapter, config.techTools || [], targetDir), addGuards);
    const { installed, written } = installToolsFromManifest(targetDir, manifest, config);
    installedGuards = installed;
    hook = generateHookFromManifest(config.adapter, targetDir, manifest, managedToolPaths(written));
  } else {
    const kept = new Set(selectGuards(io, fallbackGuards(config.projectType), addGuards).map(tool => tool.path));
    const keep = file => /^audit\./.test(file) || kept.has(file);
    const { installed } = installFallbackTools(targetDir, config.projectType, keep);
    installedGuards = installed;
    hook = generateFallbackHook(targetDir, config.projectType);
  }

  // Step 4: Install LLM Conversational CLI & Agent Context
  installAgenticCLI(targetDir, projectConfig.config.mirrors.list);

  // Step 5: Record what the kernel owns now, with hashes.
  writeManagedRegistry(io, targetDir);

  return { installedGuards, hook };
}

/** AI IDE mirrors (symlinks to AGENTS.md) install creates when the config lists none. */
const DEFAULT_MIRRORS = [
  'CLAUDE.md',                               // Cursor / Claude Desktop / Windsurf
  'GEMINI.md',                               // Gemini / Project IDX
  '.cursorrules',                            // Cursor legacy
  '.cursor/rules/clckernel_context.mdc',     // Cursor modern (MDC)
  '.github/copilot-instructions.md',         // GitHub Copilot
  '.antigravity/rules.md'                    // Antigravity (Local Agent)
];

/**
 * Installs the conversational CLI skill (SKILL.md and its playbooks) and the
 * AI IDE mirrors of AGENTS.md: the config's mirrors.list, or DEFAULT_MIRRORS.
 * @param {string} targetDir - Project root
 * @param {string[]|null} [mirrors] - mirrors.list of the project config
 */
function installAgenticCLI(targetDir, mirrors) {
  const io = currentIO(targetDir);
  // 1. Crear el Directorio de Skills
  const skillRel = '.agents/skills/clckernel_cli';
  io.mkdir(path.join(targetDir, skillRel, 'reference'));

  // 2. Inyectar el SKILL.md Maestro y Playbooks de Referencia
  const bundledSkillDir = path.join(__dirname, '..', '.agents', 'skills', 'clckernel_cli');
  const bundledSkillFile = path.join(bundledSkillDir, 'SKILL.md');
  const bundledRefDir = path.join(bundledSkillDir, 'reference');

  if (fs.existsSync(bundledSkillFile)) {
    io.copyManaged(bundledSkillFile, `${skillRel}/SKILL.md`);
  }

  if (fs.existsSync(bundledRefDir)) {
    const playbooks = fs.readdirSync(bundledRefDir);
    for (const pb of playbooks) {
      const srcPb = path.join(bundledRefDir, pb);
      if (fs.statSync(srcPb).isFile()) {
        io.copyManaged(srcPb, `${skillRel}/reference/${pb}`);
      }
    }
  }

  // 3. Crear Symlinks Dinámicos al AGENTS.md (El Single Source of Truth)
  const sourceFile = 'AGENTS.md';
  const symlinks = Array.isArray(mirrors) ? mirrors : DEFAULT_MIRRORS;

  symlinks.forEach(link => {
    const linkPath = path.join(targetDir, link);
    const relPath = path.relative(path.dirname(linkPath), path.join(targetDir, sourceFile));

    try {
      // Only replace an existing symlink (a stale mirror needs refreshing).
      // A regular file belongs to the consumer: unlinking it would destroy
      // their own rules, so leave it in place instead. An update never
      // creates a mirror the project does not have (sdds/update-no-additions).
      io.mirror(relPath, linkPath);
    } catch (e) {
      // Ignorar fallos de permisos o symlinks existentes
    }
  });
}

module.exports = { generateHarness, generateHookFromManifest, buildToolManifest, configureHooksPath, manifestGuardNames };
