/**
 * CLC Kernel — Agent-OS & Domain Workflows Stack Adapter
 * Supports agent operating systems: repositories of skills, playbooks, rules,
 * prompts, templates and data that AI agents run to carry out tasks.
 * The kernel holds no business-domain rules: the guards below hold for any
 * Agent-OS, and domain checks live in the project (tools/guards/), which the
 * pre-commit hook and the audit run like the kernel's own guards.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');
const { currentIO, registeredPaths } = require('../io');
const { FIRST_SESSION_SECTION } = require('../onboarding');

/** Skills the harness installs itself: never a detection signal. */
const HARNESS_SKILLS = new Set(['clckernel_cli', 'clc_forge_cli']);
const SKILL_ROOTS = ['skills', '.agents/skills', '.claude/skills'];
const MARKDOWN_SEARCH_DEPTH = 3;

/** Folders that make up an Agent-OS, described in AGENTS.md when present. */
const LAYER_FOLDERS = [
  { folder: 'skills', skills: true, text: 'one folder per skill with a `SKILL.md` whose frontmatter holds a unique lowercase `name` and a `description`; the agent loads a skill when its description matches the task.' },
  { folder: '.agents/skills', skills: true, text: 'skills in the shared agent layout (same `SKILL.md` contract as above).' },
  { folder: '.claude/skills', skills: true, text: 'skills in the Claude Code layout (same `SKILL.md` contract as above).' },
  { folder: 'playbooks', text: 'step-by-step procedures the agent runs for an operator; each declares its human checkpoint.' },
  { folder: 'rules', text: 'standing constraints (style, tone, policy) every run must respect.' },
  { folder: 'prompts', text: 'reusable prompt texts the skills and playbooks reference.' },
  { folder: 'templates', text: 'output skeletons; double-brace slots are allowed only here.' },
];

/** Paths listed in the harness registry (working copy, either format); empty when absent or malformed. */
function managedPaths(targetDir) {
  return new Set(registeredPaths(targetDir));
}

/** True when root/<name>/SKILL.md exists for a skill the harness did not install. */
function hasUserSkill(targetDir, root, managed = managedPaths(targetDir)) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(targetDir, root), { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(entry => {
    if (!entry.isDirectory() || HARNESS_SKILLS.has(entry.name)) return false;
    const rel = `${root}/${entry.name}/SKILL.md`;
    return !managed.has(rel) && fs.existsSync(path.join(targetDir, rel));
  });
}

/** True when dir holds a Markdown file within `depth` levels. */
function hasMarkdown(dir, depth = MARKDOWN_SEARCH_DEPTH) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(entry => (entry.isFile() && entry.name.endsWith('.md'))
    || (entry.isDirectory() && depth > 1 && hasMarkdown(path.join(dir, entry.name), depth - 1)));
}

/** Layer folders present in targetDir, in LAYER_FOLDERS order. */
function presentLayers(targetDir) {
  const managed = managedPaths(targetDir);
  return LAYER_FOLDERS.filter(layer => (layer.skills
    ? hasUserSkill(targetDir, layer.folder, managed)
    : fs.existsSync(path.join(targetDir, layer.folder))));
}

class AgentOSAdapter extends BaseAdapter {
  constructor() {
    super('Agent-OS (Domain & AI Workflows)', 'agent-os', 'Playbook / Contract Test');
  }

  /**
   * An agent operating system: a SKILL.md in skills/<name>/, .agents/skills/<name>/
   * or .claude/skills/<name>/ (skills the harness installs excluded), a
   * playbooks/ or rules/ folder with Markdown, or a generic package.json
   * signal (`agent-os` in the name, description or keywords, or the
   * `ai-agents` keyword). A code stack that also matches wins (see detector).
   */
  detect(targetDir) {
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const name = (pkg.name || '').toLowerCase();
        const desc = (pkg.description || '').toLowerCase();
        const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.map(k => String(k).toLowerCase()) : [];
        if (
          name.includes('agent-os') || desc.includes('agent-os') ||
          keywords.includes('agent-os') || keywords.includes('ai-agents')
        ) {
          return true;
        }
      } catch {}
    }

    const managed = managedPaths(targetDir);
    if (SKILL_ROOTS.some(root => hasUserSkill(targetDir, root, managed))) return true;
    return ['playbooks', 'rules'].some(folder => hasMarkdown(path.join(targetDir, folder)));
  }

  getSafeguards() {
    return [
      'Dual-Layer Architecture: Layer 1 (Engineering) & Layer 2 (Domain Runtime)',
      'Human-in-the-Loop (HITL) checkpoints: every changed skill and playbook declares a `HITL:` line or a `## Human checkpoint` section (check_hitl)',
      'Skill frontmatter: unique lowercase `name` and a `description` of at most 1024 characters in every changed SKILL.md (check_skills)',
      'Relative Markdown links resolve to files in the commit (check_links)',
      'No forgotten draft placeholders in changed Markdown, YAML and JSON (check_placeholders)',
      'Changed JSON data files parse (check_data_files)',
      'Rule mirrors (CLAUDE.md, GEMINI.md, .cursorrules, .windsurfrules) point to AGENTS.md (check_symlinks)',
      'Project rules from .clckernel.yaml (check_custom)',
      'Secret Leak Guard (scan_secrets)',
      'Single Source of Truth (SSOT) memory protocol (agent-enforced; not checked by a guard)',
      'Local-only Spec Driven Development (sdds/)',
      'Red→Green TDD Verifier (runs changed tests with vitest / jest / node:test)'
    ];
  }

  /** Guards for any Agent-OS; domain checks belong in the project's tools/guards/. */
  getTools() {
    return [
      {
        name: 'check_symlinks',
        language: 'js',
        path: 'check_symlinks.js',
        command: 'node tools/check_symlinks.js',
        description: 'AI IDE rule mirrors point to AGENTS.md (symlink or identical copy)'
      },
      {
        name: 'check_hitl',
        language: 'js',
        path: 'check_hitl.js',
        command: 'node tools/check_hitl.js',
        description: 'Explicit Human-in-the-Loop checkpoint marker in changed skills and playbooks'
      },
      {
        name: 'check_skills',
        language: 'js',
        path: 'check_skills.js',
        command: 'node tools/check_skills.js',
        description: 'SKILL.md frontmatter: name and description present, well-formed and unique'
      },
      {
        name: 'check_links',
        language: 'js',
        path: 'check_links.js',
        command: 'node tools/check_links.js',
        description: 'Relative links in changed Markdown point to files in the commit'
      },
      {
        name: 'check_placeholders',
        language: 'js',
        path: 'check_placeholders.js',
        command: 'node tools/check_placeholders.js',
        description: 'Forgotten draft placeholders in changed Markdown, YAML and JSON (templates/ may keep slots)'
      },
      {
        name: 'check_data_files',
        language: 'js',
        path: 'check_data_files.js',
        command: 'node tools/check_data_files.js',
        description: 'Every changed .json file parses (snapshot content, any folder)'
      },
      {
        name: 'scan_secrets',
        language: 'js',
        path: 'scan_secrets.js',
        command: 'node tools/scan_secrets.js',
        description: 'Security & API key leak scanner'
      },
      {
        name: 'verify_tdd',
        language: 'js',
        path: 'verify_tdd.js',
        command: 'node tools/verify_tdd.js',
        description: 'Runs changed tests (vitest / jest / node:test) against BASE (must fail) and the staged code (must pass)'
      },
      {
        name: 'check_custom',
        language: 'js',
        path: 'check_custom.js',
        command: 'node tools/check_custom.js',
        description: 'Project rules from .clckernel.yaml (e.g. sections every playbook must have)'
      }
    ];
  }

  provision(targetDir, config) {
    // 1. Create docs/, sdds/, and tools/. AGENTS.md is owned by this adapter
    // (dual-layer template below), so BaseAdapter must not write its generic
    // law file — otherwise the generic one lands first and, being present,
    // would make the guard below skip the dual-layer render entirely.
    super.provision(targetDir, { ...(config || {}), skipAgentsMd: true });

    // 2. Write Dual-Layer AGENTS.md, describing only the folders that exist.
    const layers = presentLayers(targetDir);
    const layerMap = layers.length > 0
      ? layers.map(layer => `- \`${layer.folder}/\` — ${layer.text}`).join('\n')
      : '- No agent folders yet. Add skills, playbooks, rules, prompts or templates folders and describe them here.';
    const dualLayerAgents = `# Standard Operating Procedure (SOP) — AGENTS
Governed by **CLC Kernel: The Universal AI Agent Governance Engine**.
Target System: **${this.name}**

---

## 🛠️ Layer 1: Development & Maintenance Governance (Engineering)
All AI Agents (Antigravity, OpenCode, Claude Code, Cursor, Windsurf, Copilot) developing or maintaining this codebase MUST adhere to strict engineering standards:

> 🚨 **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (NO EXCEPTIONS)**
> Even when the user issues a direct or urgent fix request ("fix this bug", "fix this error", "quick fix"):
> YOU ARE STRICTLY FORBIDDEN from modifying source code or workflows directly without completing the full quality harness:
> 1. **Research & Root Cause Analysis:** Investigate tracebacks and affected files before editing.
> 2. **SDD Specification:** Document non-trivial changes in \`sdds/{change-name}/01-spec.md\` (gitignored).
> 3. **Verification (Red Phase):** Write a failing test or contract validation first.
> 4. **Clean Implementation (Green Phase):** Make tests pass maintaining strict layer isolation.
> 5. **Mandatory Audit Gate:** Execute \`node tools/audit.js\` and output summary to stdout.

### Engineering Rules
1. **Conventional Commits Only**: Commits must use Conventional Commits (e.g. \`feat(...): ...\`, \`fix(...): ...\`). NEVER add \`Co-Authored-By\` or AI attribution.
2. **Mirror Links Interoperability**: \`CLAUDE.md\`, \`GEMINI.md\`, \`.cursorrules\`, and \`.windsurfrules\` must remain symlinks to (or identical copies of) \`AGENTS.md\` (checked by \`tools/check_symlinks.js\`).
3. **No Superficial Symptom Patches**: Always address root causes.

---

## 🚀 Layer 2: Domain Runtime Directives (Agent Workflows & Operations)
When operating as domain agents for end-users and non-technical operators:

1. **Non-Technical Operator Friendly**: Interact naturally with the operator. Guide step-by-step through conversational prompts without technical jargon.
2. **Mandatory Human-in-the-Loop (HITL) Checkpoints**: Always pause phase-by-phase during multi-step pipelines. Present draft output and WAIT for explicit user confirmation before executing irreversible steps. Every skill and playbook declares its checkpoint with a \`HITL:\` line or a \`## Human checkpoint\` section (checked by \`tools/check_hitl.js\`).
3. **Skill Contract**: Every \`SKILL.md\` opens with a frontmatter holding a unique lowercase \`name\` and a \`description\` that says when to use the skill (checked by \`tools/check_skills.js\`).
4. **SSOT Memory Primacy**: Read from and persist to the files this repository designates as its single source of truth; never keep operator data only in a conversation.
5. **Clean Creation State (No Invented Data)**: Never invent data. A field without a real value stays empty or \`null\` until real data exists.
6. **Finished Documents**: Deliverables follow the repository's templates and formats, keep no draft placeholders and link only to files that exist (checked by \`tools/check_placeholders.js\` and \`tools/check_links.js\`).

### Repository Map
${layerMap}

---

## 🎮 Universal Command Interface (All LLMs & Agents)
When given a command matching \`clckernel <action>\` or \`/clckernel <action>\`, execute the deterministic state machine below:

| Command | Lifecycle Phase | Mandatory Execution Protocol |
|---|---|---|
| \`clckernel feature <name>\` | New Feature | 1. Research affected layers.<br>2. Author local spec in \`sdds/{name}/spec.md\`.<br>3. Present HIT review to user and wait for approval.<br>4. Write failing test (Red Phase).<br>5. Implement clean code (Green Phase).<br>6. Run \`node tools/audit.js --change {name}\` (or \`audit.py --change {name}\`). |
| \`clckernel fix <issue>\` | Bug Fix | 1. Investigate root cause (no code edits).<br>2. Reproduce with failing test (Red Phase).<br>3. Minimal surgical fix respecting Clean Arch (Green Phase).<br>4. Run audit gate without skipping. |
| \`clckernel test\` | Verification | Run test suite and verify clean pass (exit code 0). |
| \`clckernel audit\` | Verification | Run \`npx clckernel audit [dir] [--change <name>]\` (every installed orchestrator: \`tools/audit.js\` and/or \`tools/audit.py\`) and output the Educational Summary; only \`--change\` writes the report to \`sdds/<name>/\`. |
| \`clckernel doctor\` | Diagnostics | Run \`npx clckernel doctor [dir]\`: checks AGENTS.md, sdds/, tools/, the pre-commit hook and that the guard scripts load. |
| \`clckernel commit <message>\` | Version Control | Run full audit, verify tests pass, ensure no changes outside SDD scope, and commit with conventional commits (never add AI attribution). |
| \`clckernel guard create <name>\` | Safeguards | Scaffold a new guard script in the stack's native language in \`tools/guards/\`. |
| \`clckernel update\` | Maintenance | Non-destructive update: run \`npx clckernel update [dir]\` (\`--dry-run\` previews, \`--add-guards <a,b\\|all>\` adds guards); refreshes kernel tools, hook, playbooks & symlinks (preserves SDDs, project guards, edited files & \`.clckernel.yaml\`). |
| \`clckernel start\` | Setup | Scan codebase and propose a governance plan; if the harness is missing, install it with \`npx clckernel . --yes\`. \`.clckernel.yaml\` is optional: write it only for settings that differ from the defaults. |

---

## 🛡️ Core AI Safeguards
${this.getSafeguards().map(s => `- ${s}`).join('\n')}

---

${FIRST_SESSION_SECTION}`;

    // Guard: never overwrite a project-customized AGENTS.md (e.g. a law file
    // carrying domain invariants the template cannot know about).
    const io = currentIO(targetDir);
    const dualAgentsPath = path.join(targetDir, 'AGENTS.md');
    if (!io.exists(dualAgentsPath)) {
      io.writeFile(dualAgentsPath, dualLayerAgents);
    }

    // 3. Create AI IDE mirror symlinks
    const mirrors = ['CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules'];
    for (const mirror of mirrors) {
      const mirrorPath = path.join(targetDir, mirror);
      try {
        // An update never creates a mirror the project deleted (sdds/update-no-additions).
        if (!io.exists(mirrorPath)) {
          io.mirror('AGENTS.md', mirrorPath);
        }
      } catch {}
    }
    // Guards are copied by the generator from getTools(targetDir), so the
    // registry and the hook list exactly what is installed.
  }
}

module.exports = AgentOSAdapter;
