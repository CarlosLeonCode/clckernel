/**
 * CLC Forge — Universal Provisioning Engine
 * Manifest-driven tool installation and dynamic pre-commit hook generation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveConfig } = require('./config.js');

/**
 * Generates a pre-commit hook dynamically from the adapter's tool manifest.
 * Frontend projects use .husky; backend projects use .githooks.
 * @param {object} adapter - Adapter with getTools() and projectType
 * @param {string} targetDir - Target project root
 */
function generateHookFromManifest(adapter, targetDir) {
  const tools = adapter.getTools();
  const isFront = adapter.projectType === 'frontend';

  const hookDir = isFront
    ? path.join(targetDir, '.husky')
    : path.join(targetDir, '.githooks');
  const hookFile = path.join(hookDir, 'pre-commit');

  const lines = [];
  if (isFront) {
    lines.push('#!/usr/bin/env sh');
    lines.push('. "$(dirname -- "$0")/_/husky.sh"');
    lines.push('');
  } else {
    lines.push('#!/usr/bin/env bash');
    lines.push(`echo "Running CLC Kernel ${adapter.name} Safeguards..."`);
    lines.push('');
  }

  tools.forEach(tool => {
    if (!tool.command) return;
    lines.push(tool.command);
  });

  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(hookFile, lines.join('\n'), 'utf-8');
  try { fs.chmodSync(hookFile, '755'); } catch (e) {}

  if (!isFront) {
    try {
      execSync('git config core.hooksPath .githooks', { cwd: targetDir, stdio: 'ignore' });
    } catch (e) {}
  }
}

/**
 * Installs tools from an adapter's manifest into the target tools/ directory.
 * Only copies tools with valid descriptors. External CLIs are skipped (no file to copy).
 * Always copies the audit orchestrator for the project type.
 * @param {string} targetDir - Target project root
 * @param {Array} manifest - Tool manifest from adapter.getTools()
 * @param {object} config - Project config (projectType, framework, testRunner)
 */
function installToolsFromManifest(targetDir, manifest, config) {
  const sourceToolsDir = path.join(__dirname, '..', 'tools');
  const isFront = config.projectType === 'frontend';

  // Validate descriptors: skip + warn tools missing required fields
  const validTools = manifest.filter(tool => {
    if (!tool.name || !tool.language || !tool.command) {
      console.warn(`Warning: tool "${tool.name || '(unnamed)'}" skipped - missing name, language, or command`);
      return false;
    }
    return true;
  });

  // Always copy the audit orchestrator for the right language
  const orchestrator = isFront ? 'audit.js' : 'audit.py';
  const orchestratorSrc = path.join(sourceToolsDir, orchestrator);
  const orchestratorDest = path.join(targetDir, 'tools', orchestrator);
  if (fs.existsSync(orchestratorSrc)) {
    fs.copyFileSync(orchestratorSrc, orchestratorDest);
    try { fs.chmodSync(orchestratorDest, '755'); } catch (e) {}
  }

  // Copy only custom tools with valid paths (skip external CLIs and empty paths)
  validTools.forEach(tool => {
    if (tool.language === 'external' || !tool.path) return;
    const srcFile = path.join(sourceToolsDir, tool.path);
    const destFile = path.join(targetDir, 'tools', tool.path);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      try { fs.chmodSync(destFile, '755'); } catch (e) {}
    } else {
      console.warn(`Warning: tool "${tool.path}" declared by adapter but not found in bundled tools/. Skipping.`);
    }
  });

  // check_custom.js requires the shared YAML parser (../src/yaml.js),
  // so the generated project must ship it too.
  if (validTools.some(tool => tool.path === 'check_custom.js')) {
    installYamlModule(targetDir, sourceToolsDir);
  }
}

/**
 * Copies the zero-dependency YAML parser into a generated project's src/.
 * Required by tools/check_custom.js (require('../src/yaml.js')).
 * @param {string} targetDir - Target project root
 * @param {string} sourceToolsDir - Bundled tools/ directory of this package
 */
function installYamlModule(targetDir, sourceToolsDir) {
  const yamlSrc = path.join(sourceToolsDir, '..', 'src', 'yaml.js');
  if (!fs.existsSync(yamlSrc)) return;
  const yamlDest = path.join(targetDir, 'src', 'yaml.js');
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  fs.copyFileSync(yamlSrc, yamlDest);
}

/**
 * Installs a minimal fallback tool set when no adapter is provided.
 * Copies audit.js, audit.py, scan_secrets.js, scan_secrets.py.
 * @param {string} targetDir - Target project root
 */
function installFallbackTools(targetDir) {
  const sourceToolsDir = path.join(__dirname, '..', 'tools');
  const fallbackFiles = [
    'audit.js', 'audit.py',
    'scan_secrets.js', 'scan_secrets.py',
    'check_custom.js', 'check_custom.py',
    'check_responsive.js', 'check_seo.js',
    'check_db_efficiency.py'
  ];

  fallbackFiles.forEach(file => {
    const srcFile = path.join(sourceToolsDir, file);
    const destFile = path.join(targetDir, 'tools', file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      try { fs.chmodSync(destFile, '755'); } catch (e) {}
    }
  });

  if (fallbackFiles.includes('check_custom.js')) {
    installYamlModule(targetDir, sourceToolsDir);
  }
}

/**
 * Generates a minimal generic pre-commit hook when no adapter is available.
 * @param {string} targetDir - Target project root
 * @param {string} projectType - 'frontend' or 'backend'
 */
function generateFallbackHook(targetDir, projectType) {
  const isFront = projectType === 'frontend';

  if (isFront) {
    const hookDir = path.join(targetDir, '.husky');
    fs.mkdirSync(hookDir, { recursive: true });
    const hookFile = path.join(hookDir, 'pre-commit');
    fs.writeFileSync(hookFile, `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

node tools/scan_secrets.js || true
`, 'utf-8');
    try { fs.chmodSync(hookFile, '755'); } catch (e) {}
  } else {
    const hookDir = path.join(targetDir, '.githooks');
    fs.mkdirSync(hookDir, { recursive: true });
    const hookFile = path.join(hookDir, 'pre-commit');
    fs.writeFileSync(hookFile, `#!/usr/bin/env bash
echo "Running CLC Kernel Safeguards..."
python3 tools/scan_secrets.py || true
`, 'utf-8');
    try { fs.chmodSync(hookFile, '755'); } catch (e) {}
    try {
      execSync('git config core.hooksPath .githooks', { cwd: targetDir, stdio: 'ignore' });
    } catch (e) {}
  }
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
 * the resolved harness metadata to `.clckernel.resolved.json` and
 * `.clc-forge.resolved.json` (deterministic: stable key order, 2-space JSON).
 * Full layout/tools/hook materialization is the A-04 work unit; here only
 * the metadata flows out.
 * @param {string} targetDir - Target project root
 * @param {object} configOrNull - Raw or resolved extended config
 * @returns {object} The resolved config (metadata written to disk)
 */
function generateConfigPathHarness(targetDir, configOrNull) {
  const alreadyResolved =
    configOrNull.__clcKernelConfigPath === true ||
    configOrNull.__clcForgeConfigPath === true ||
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
  fs.writeFileSync(
    path.join(targetDir, '.clc-forge.resolved.json'),
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

    fs.mkdirSync(path.join(targetDir, 'docs', 'Journal'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'docs', 'Architecture'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'docs', 'Development'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'sdds'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'tools'), { recursive: true });

    const gitignorePath = path.join(targetDir, '.gitignore');
    let gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (!gitignoreContent.includes('sdds/*')) {
      gitignoreContent += '\n\n# Local Spec-Driven Development (SDD) files\nsdds/*\n!sdds/.gitkeep\nopenspec/*\n!openspec/.gitkeep\n.ruff_cache/\n';
      fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
    }
    fs.writeFileSync(path.join(targetDir, 'sdds', '.gitkeep'), '', 'utf-8');

    const agentsContent = `# CLC Kernel ${config.framework || 'Generic'} (${(config.projectType || 'unknown').toUpperCase()}) — AGENTS

This document is the **authoritative law** for AI agents working in this repository.
Forged by **CLC Kernel: The AI Agent Governance Engine**.

> **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (UNBYPASSABLE)**
> Even when the user issues a direct or urgent fix request ("fix this bug", "fix this error", "quick fix"):
> YOU ARE STRICTLY FORBIDDEN from modifying source code directly without completing the full quality harness:
> 1. **Research & Root Cause Analysis:** Investigate tracebacks and inspect affected files before editing.
> 2. **TDD Verification (Red Phase):** Write a failing regression test first (${config.testRunner || 'npm test'}).
> 3. **Clean Architecture Implementation (Green Phase):** Make the test pass maintaining layer isolation.
> 4. **Mandatory Educational Audit Gate:** Execute \`node tools/audit.js\` or \`python tools/audit.py\` and output the Educational Code Summary to stdout.
> NEVER declare success or skip verification commands for quick fixes.

## 1. The Loop (Every Task)
1. **Research** — Inspect codebase / docs before writing code.
2. **Plan** — Write an SDD under \`sdds/{change-name}/\`. SDDs live 100% locally and are gitignored.
3. **Test** (TDD) — Write failing test first (${config.testRunner || 'npm test'}).
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
- Memory Guard (Engram / Graphify)` : `- Wait for Audit Gate
- Scope Guardrail
- Real TDD Validation (Red -> Green)
- Secret Leak Guard
- Clean Architecture AST Guard
- Database Efficiency & N+1 Performance Guard
- Database Migration Idempotency Guard
- Memory Guard (Engram / Graphify)`}

## 3. Universal Command Interface (All LLMs & Agents)
When given a command matching \`clckernel <action>\` or \`/clckernel <action>\`, execute the deterministic state machine below:

| Command | Lifecycle Phase | Mandatory Execution Protocol |
|---|---|---|
| \`clckernel feature <name>\` | New Feature | 1. Research affected layers.<br>2. Author local spec in \`sdds/{name}/spec.md\`.<br>3. Present HIT review to user and wait for approval.<br>4. Write failing test (Red Phase).<br>5. Implement clean code (Green Phase).<br>6. Run \`node tools/audit.js\` (or \`audit.py\`). |
| \`clckernel fix <issue>\` | Bug Fix | 1. Investigate root cause (no code edits).<br>2. Reproduce with failing test (Red Phase).<br>3. Minimal surgical fix respecting Clean Arch (Green Phase).<br>4. Run audit gate without skipping. |
| \`clckernel test\` | Verification | Run test suite (\`${config.testRunner || 'npm test'}\`) and verify clean pass (exit code 0). |
| \`clckernel audit\` | Verification | Run \`node tools/audit.js\` or \`python tools/audit.py\` and output the Educational Summary. |
| \`clckernel doctor\` | Diagnostics | Check git pre-commit hooks, IDE symlinks, and AST engine integrity. |
| \`clckernel commit <message>\` | Version Control | Run full audit, verify tests pass, ensure no changes outside SDD scope, and commit with conventional commits (never add AI attribution). |
| \`clckernel guard create <name>\` | Safeguards | Scaffold a new AST guard in the stack's native language in \`tools/guards/\`. |
| \`clckernel update\` | Maintenance | Non-destructive update: refresh core tools, playbooks & symlinks (preserves SDDs & custom guards). |
| \`clckernel start\` | Setup | Scan codebase, propose governance plan, and materialize \`.clckernel.yaml\`. |
`;
    fs.writeFileSync(path.join(targetDir, 'AGENTS.md'), agentsContent, 'utf-8');
  }

  // Step 2: Install tools (manifest-driven or fallback)
  if (config.adapter) {
    const frameworkTools = config.adapter.getTools();
    const techTools = config.techTools || [];

    // Merge order: [frameworkTools prefix, ...techTools, check_custom + suffix]
    // Split around check_custom to insert tech tools before it
    const checkCustomIdx = frameworkTools.findIndex(t => t.name === 'check_custom');
    const mergedManifest = checkCustomIdx >= 0
      ? [
          ...frameworkTools.slice(0, checkCustomIdx),
          ...techTools,
          ...frameworkTools.slice(checkCustomIdx)
        ]
      : [
          ...frameworkTools,
          ...techTools
        ];

    installToolsFromManifest(targetDir, mergedManifest, config);
  } else {
    installFallbackTools(targetDir);
  }

  // Step 3: Generate pre-commit hook (manifest-driven or fallback)
  if (config.adapter) {
    generateHookFromManifest(config.adapter, targetDir);
  } else {
    generateFallbackHook(targetDir, config.projectType);
  }

  // Step 4: Install LLM Conversational CLI & Agent Context
  installAgenticCLI(targetDir);
}

/**
 * Instala la CLI Conversacional (SKILL.md) y genera los symlinks universales
 * para que todos los LLMs (Cursor, Claude, Gemini) absorban el AGENTS.md.
 */
function installAgenticCLI(targetDir) {
  // 1. Crear el Directorio de Skills
  const skillDir = path.join(targetDir, '.agents', 'skills', 'clckernel_cli');
  const legacySkillDir = path.join(targetDir, '.agents', 'skills', 'clc_forge_cli');
  const skillRefDir = path.join(skillDir, 'reference');
  const legacySkillRefDir = path.join(legacySkillDir, 'reference');
  fs.mkdirSync(skillRefDir, { recursive: true });
  fs.mkdirSync(legacySkillRefDir, { recursive: true });

  // 2. Inyectar el SKILL.md Maestro y Playbooks de Referencia
  const bundledSkillDir = path.join(__dirname, '..', '.agents', 'skills', 'clckernel_cli');
  const bundledSkillFile = path.join(bundledSkillDir, 'SKILL.md');
  const bundledRefDir = path.join(bundledSkillDir, 'reference');

  if (fs.existsSync(bundledSkillFile)) {
    fs.copyFileSync(bundledSkillFile, path.join(skillDir, 'SKILL.md'));
    fs.copyFileSync(bundledSkillFile, path.join(legacySkillDir, 'SKILL.md'));
  }

  if (fs.existsSync(bundledRefDir)) {
    const playbooks = fs.readdirSync(bundledRefDir);
    for (const pb of playbooks) {
      const srcPb = path.join(bundledRefDir, pb);
      if (fs.statSync(srcPb).isFile()) {
        fs.copyFileSync(srcPb, path.join(skillRefDir, pb));
        fs.copyFileSync(srcPb, path.join(legacySkillRefDir, pb));
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
    '.cursor/rules/clc_forge_context.mdc',     // Cursor backward compat
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
      try {
        if (fs.lstatSync(linkPath)) {
          fs.unlinkSync(linkPath);
        }
      } catch (err) {}
      fs.symlinkSync(relPath, linkPath, 'file');
    } catch (e) {
      // Ignorar fallos de permisos o symlinks existentes
    }
  });
}

module.exports = { generateHarness, generateHookFromManifest };
