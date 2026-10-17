/**
 * CLC Kernel — Universal Provisioning Engine
 * Manifest-driven tool installation and dynamic pre-commit hook generation.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveConfig } = require('./config.js');

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

/** Registry of the files the harness installed into tools/ (paths relative to the project root). */
const MANAGED_REGISTRY = 'tools/.clckernel-managed.json';

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
 * Reads the registry written by the last install/update; [] when absent or malformed.
 * @param {string} targetDir - Target project root
 * @returns {string[]}
 */
function readManagedRegistry(targetDir) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(targetDir, MANAGED_REGISTRY), 'utf-8'));
    return Array.isArray(list) ? list.filter(f => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Writes the registry: the sorted list of every file this run installed into
 * tools/, the registry itself included. The snapshot helpers (_changes.js/.py)
 * drop these paths from the files a guard evaluates.
 * @param {string} targetDir - Target project root
 * @param {string[]} toolFiles - File names written into tools/
 * @returns {string[]} The registered paths
 */
function writeManagedRegistry(targetDir, toolFiles) {
  const paths = [...new Set([...toolFiles.map(f => `tools/${f}`), MANAGED_REGISTRY])].sort();
  fs.mkdirSync(path.join(targetDir, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, MANAGED_REGISTRY), JSON.stringify(paths, null, 2) + '\n', 'utf-8');
  return paths;
}

/**
 * Builds the single tool manifest used both to copy guards into tools/ and to
 * generate the pre-commit hook, so every installed guard is also executed.
 * Technology tools (Celery, Redis, PostgreSQL, Docker) are inserted right
 * before check_custom, keeping the user-defined rules last; when the adapter
 * has no check_custom they are appended.
 * @param {object} adapter - Adapter with getTools()
 * @param {Array} [techTools] - Tools for detected technologies
 * @returns {Array} Merged tool manifest
 */
function buildToolManifest(adapter, techTools = []) {
  const frameworkTools = adapter.getTools();
  const checkCustomIdx = frameworkTools.findIndex(t => t.name === 'check_custom');
  if (checkCustomIdx < 0) return [...frameworkTools, ...techTools];
  return [
    ...frameworkTools.slice(0, checkCustomIdx),
    ...techTools,
    ...frameworkTools.slice(checkCustomIdx),
  ];
}

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
  if (current && current !== GITHOOKS_DIR) {
    console.warn(
      `Warning: core.hooksPath is already set to "${current}" (another hook manager?); it was left unchanged.\n` +
        `  To run the CLC Kernel hooks instead run: git config core.hooksPath ${GITHOOKS_DIR}`
    );
    return false;
  }

  return runGit(targetDir, ['config', 'core.hooksPath', GITHOOKS_DIR]).ok;
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
 * @param {string} targetDir - Target project root
 * @param {boolean} isFront - Frontend project (may use Husky)
 * @param {string[]} commands - Hook body lines
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
  lines.push(...commands);

  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(hookFile, lines.join('\n') + '\n', 'utf-8');
  try { fs.chmodSync(hookFile, '755'); } catch (e) {}

  const active = useHusky ? true : configureHooksPath(targetDir);
  return { file: path.posix.join(useHusky ? '.husky' : GITHOOKS_DIR, 'pre-commit'), active };
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
    .filter(tool => tool.command)
    .map(tool => (tool.language === 'external' ? guardedCommand(tool, managed) : tool.command));
  return writeHook(targetDir, adapter.projectType === 'frontend', commands, `Running CLC Kernel ${adapter.name} Safeguards...`);
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
    const dest = path.join(targetDir, 'tools', file);
    fs.copyFileSync(src, dest);
    try { fs.chmodSync(dest, '755'); } catch (e) {}
    written.push(file);
  }
  return written;
}

/** Shared modules the diff-based guards import from their own directory, by guard language. */
const SNAPSHOT_HELPERS = { '.js': '_changes.js', '.py': '_changes.py' };

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
  fs.mkdirSync(path.join(targetDir, 'tools'), { recursive: true });

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
    const destFile = path.join(targetDir, 'tools', tool.path);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      try { fs.chmodSync(destFile, '755'); } catch (e) {}
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
  const toolsDest = path.join(targetDir, 'tools');
  fs.mkdirSync(toolsDest, { recursive: true });
  fs.copyFileSync(yamlSrc, path.join(toolsDest, 'yaml.js'));
  return ['yaml.js'];
}

/**
 * Copies the snapshot helper each installed guard imports as a sibling:
 * _changes.js when any JS file was copied into tools/, _changes.py when any
 * Python file was (technology guards can bring Python guards to a Node
 * stack). A stack without Python tools stays free of Python files. The `_`
 * prefix keeps the helpers out of the audit orchestrators' guard discovery.
 *
 * @param {string} targetDir - Target project root
 * @param {string[]} copiedFiles - tools/ file names copied for this project
 * @returns {string[]} File names written into tools/
 */
function installSnapshotHelpers(targetDir, copiedFiles) {
  const toolsDest = path.join(targetDir, 'tools');
  const helpers = new Set(copiedFiles.map(f => SNAPSHOT_HELPERS[path.extname(f)]).filter(Boolean));
  const written = [];
  for (const file of helpers) {
    const src = path.join(__dirname, '..', 'tools', file);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(toolsDest, { recursive: true });
    fs.copyFileSync(src, path.join(toolsDest, file));
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
 * @returns {{ installed: string[], written: string[] }} Names of the guards copied
 *   (orchestrators excluded), and every file name written into tools/
 */
function installFallbackTools(targetDir, projectType) {
  const sourceToolsDir = path.join(__dirname, '..', 'tools');
  const fallbackFiles = projectType === 'unknown' ? GENERIC_FALLBACK_FILES : LEGACY_FALLBACK_FILES;

  const installed = new Set();
  const written = [];
  fallbackFiles.forEach(file => {
    const srcFile = path.join(sourceToolsDir, file);
    const destFile = path.join(targetDir, 'tools', file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      try { fs.chmodSync(destFile, '755'); } catch (e) {}
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
 * Generates a minimal generic pre-commit hook when no adapter is available.
 * @param {string} targetDir - Target project root
 * @param {string} projectType - 'frontend', 'backend' or 'unknown'
 * @returns {{ file: string, active: boolean }} The hook written and whether git runs it
 */
function generateFallbackHook(targetDir, projectType) {
  const isFront = projectType === 'frontend';
  // Node is the one runtime known to exist for frontend and unknown stacks.
  const secretScan = isFront || projectType === 'unknown' ? 'node tools/scan_secrets.js' : 'python3 tools/scan_secrets.py';
  return writeHook(targetDir, isFront, [secretScan], 'Running CLC Kernel Safeguards...');
}

/**
 * Extended-schema keys that route a config through the config-driven path
 * (design §1.4). `rules` intentionally excluded: a rules-only YAML keeps the
 * legacy adapter/fallback path (check_custom reads rules at audit time).
 */
const EXTENDED_CONFIG_KEYS = [
  'active_guards',
  'phases',
  'gate_mode',
  'severities',
  'layers',
  'scope',
  'exclude_paths',
];

/** True when the object carries extended-schema keys (a config-path config). */
function isExtendedConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  return EXTENDED_CONFIG_KEYS.some((k) => Object.prototype.hasOwnProperty.call(config, k));
}

/**
 * Config-driven path (Slice A, minimal A-03 integration): resolve the raw
 * config (or reuse an already-resolved one marked by index.js/A-05) and emit
 * the resolved harness metadata to `.clckernel.resolved.json`
 * (deterministic: stable key order, 2-space JSON).
 * Full layout/tools/hook materialization is the A-04 work unit; here only
 * the metadata flows out.
 * @param {string} targetDir - Target project root
 * @param {object} configOrNull - Raw or resolved extended config
 * @returns {object} The resolved config (metadata written to disk)
 */
function generateConfigPathHarness(targetDir, configOrNull) {
  const alreadyResolved =
    configOrNull.__clcKernelConfigPath === true ||
    configOrNull.__clcForgeConfigPath === true || // legacy marker, still honored
    Array.isArray(configOrNull.__catalog);
  const resolved = alreadyResolved ? configOrNull : resolveConfig(configOrNull, {});

  const metadata = {
    activeGuards: resolved.activeGuards,
    phases: resolved.phases,
    gateMode: resolved.gateMode,
    effectiveSeverities: resolved.effectiveSeverities,
    layers: resolved.layers,
    scope: resolved.scope,
    excludePaths: resolved.excludePaths,
    rules: resolved.rules || [],
    framework: resolved.framework,
    projectType: resolved.projectType,
    testRunner: resolved.testRunner,
    __catalog: resolved.__catalog,
  };

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, '.clckernel.resolved.json'),
    JSON.stringify(metadata, null, 2) + '\n',
    'utf-8'
  );
  return resolved;
}

/**
 * Generate a harness for a target project.
 * When the optional `configOrNull` is null (or an adapter-detected config
 * without extended-schema keys) the legacy path runs UNCHANGED. A config
 * carrying extended-schema keys (or the `__clcKernelConfigPath` marker set
 * by index.js) routes to the config-driven path — which for A-03 emits the
 * resolved metadata; full materialization lands in A-04.
 */
function generateHarness(targetDir, configOrNull) {
  if (configOrNull && (configOrNull.__clcKernelConfigPath === true || configOrNull.__clcForgeConfigPath === true || isExtendedConfig(configOrNull))) {
    return generateConfigPathHarness(targetDir, configOrNull);
  }
  // Legacy path: a null/absent config falls back to generic provisioning
  // (byte-identical for every existing caller, which always passes a full
  // detected config — defaults only kick in for a bare null).
  const config = configOrNull || {};

  // Step 1: Provision directories + AGENTS.md
  if (config.adapter) {
    config.adapter.provision(targetDir, config);
  } else {
    // Fallback: create directory structure + AGENTS.md
    const isFront = config.projectType === 'frontend';
    // Unknown stack: a Generic AGENTS.md with no stack-specific rules.
    const isGeneric = config.projectType === 'unknown';
    const frameworkLabel = isGeneric ? 'Generic' : (config.framework || 'Generic');
    const testRunner = isGeneric ? "the project's test runner" : (config.testRunner || 'npm test');

    fs.mkdirSync(path.join(targetDir, 'docs', 'Journal'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'docs', 'Architecture'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'docs', 'Development'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'sdds'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'tools'), { recursive: true });

    const { ensureGitignoreEntries } = require('./gitignore');
    ensureGitignoreEntries(targetDir);
    fs.writeFileSync(path.join(targetDir, 'sdds', '.gitkeep'), '', 'utf-8');

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

## 3. Universal Command Interface (All LLMs & Agents)
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
    // Guard: never overwrite an existing project-customized AGENTS.md.
    // This prevents clckernel update from replacing Laila MOS invariants
    // (carousel format, one-question-onboarding, dynamic calendar, immutability).
    if (!fs.existsSync(path.join(targetDir, 'AGENTS.md'))) {
      fs.writeFileSync(path.join(targetDir, 'AGENTS.md'), agentsContent, 'utf-8');
    }

  }

  // Steps 2-3: Install tools and generate the pre-commit hook from the same
  // manifest, so every guard copied into tools/ is also run by the hook.
  // The registry of everything written into tools/ is recorded before the hook
  // is generated, so whole-project linters can exclude those files.
  let installedGuards;
  let hook;
  if (config.adapter) {
    const manifest = buildToolManifest(config.adapter, config.techTools || []);
    const { installed, written } = installToolsFromManifest(targetDir, manifest, config);
    installedGuards = installed;
    const managed = writeManagedRegistry(targetDir, written);
    hook = generateHookFromManifest(config.adapter, targetDir, manifest, managed);
  } else {
    const { installed, written } = installFallbackTools(targetDir, config.projectType);
    installedGuards = installed;
    writeManagedRegistry(targetDir, written);
    hook = generateFallbackHook(targetDir, config.projectType);
  }

  // Step 4: Install LLM Conversational CLI & Agent Context
  installAgenticCLI(targetDir);

  return { installedGuards, hook };
}

/**
 * Instala la CLI Conversacional (SKILL.md) y genera los symlinks universales
 * para que todos los LLMs (Cursor, Claude, Gemini) absorban el AGENTS.md.
 */
function installAgenticCLI(targetDir) {
  // 1. Crear el Directorio de Skills
  const skillDir = path.join(targetDir, '.agents', 'skills', 'clckernel_cli');
  const skillRefDir = path.join(skillDir, 'reference');
  fs.mkdirSync(skillRefDir, { recursive: true });

  // 2. Inyectar el SKILL.md Maestro y Playbooks de Referencia
  const bundledSkillDir = path.join(__dirname, '..', '.agents', 'skills', 'clckernel_cli');
  const bundledSkillFile = path.join(bundledSkillDir, 'SKILL.md');
  const bundledRefDir = path.join(bundledSkillDir, 'reference');

  if (fs.existsSync(bundledSkillFile)) {
    fs.copyFileSync(bundledSkillFile, path.join(skillDir, 'SKILL.md'));
  }

  if (fs.existsSync(bundledRefDir)) {
    const playbooks = fs.readdirSync(bundledRefDir);
    for (const pb of playbooks) {
      const srcPb = path.join(bundledRefDir, pb);
      if (fs.statSync(srcPb).isFile()) {
        fs.copyFileSync(srcPb, path.join(skillRefDir, pb));
      }
    }
  }

  // 3. Crear Symlinks Dinámicos al AGENTS.md (El Single Source of Truth)
  const sourceFile = 'AGENTS.md';
  const symlinks = [
    'CLAUDE.md',                               // Cursor / Claude Desktop / Windsurf
    'GEMINI.md',                               // Gemini / Project IDX
    '.cursorrules',                            // Cursor legacy
    '.cursor/rules/clckernel_context.mdc',     // Cursor modern (MDC)
    '.github/copilot-instructions.md',         // GitHub Copilot
    '.antigravity/rules.md'                    // Antigravity (Local Agent)
  ];

  symlinks.forEach(link => {
    const linkPath = path.join(targetDir, link);
    const linkDir = path.dirname(linkPath);

    if (!fs.existsSync(linkDir)) {
      fs.mkdirSync(linkDir, { recursive: true });
    }

    const relPath = path.relative(linkDir, path.join(targetDir, sourceFile));

    try {
      // Only replace an existing symlink (a stale mirror needs refreshing).
      // A regular file belongs to the consumer: unlinking it would destroy
      // their own rules, so leave it in place instead.
      let existing = null;
      try {
        existing = fs.lstatSync(linkPath);
      } catch (err) {}

      if (existing) {
        if (!existing.isSymbolicLink()) return;
        fs.unlinkSync(linkPath);
      }

      fs.symlinkSync(relPath, linkPath, 'file');
    } catch (e) {
      // Ignorar fallos de permisos o symlinks existentes
    }
  });
}

module.exports = { generateHarness, generateHookFromManifest, buildToolManifest, configureHooksPath };
