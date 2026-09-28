/**
 * CLC Kernel — Agent-OS & Domain Workflows Stack Adapter
 * Supports AI Agent Operating Systems (Marketing OS, Content Ops, Research OS)
 * featuring Dual-Layer Governance and Domain Integrity Safeguards.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class AgentOSAdapter extends BaseAdapter {
  constructor() {
    super('Agent-OS (Domain & AI Workflows)', 'agent-os', 'Playbook / Contract Test');
  }

  detect(targetDir) {
    // 1. package.json check
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const name = (pkg.name || '').toLowerCase();
        const desc = (pkg.description || '').toLowerCase();
        const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.map(k => k.toLowerCase()) : [];
        if (
          name.includes('agent-os') || name.includes('marketing-os') || name.includes('laila-mos') ||
          desc.includes('agent-os') || desc.includes('marketing operating system') ||
          keywords.includes('agent-os') || keywords.includes('marketing-os') || keywords.includes('ai-agents')
        ) {
          return true;
        }
      } catch {}
    }

    // 2. skills/ or .agents/skills/ directory check
    const skillsDir = path.join(targetDir, 'skills');
    const agentSkillsDir = path.join(targetDir, '.agents', 'skills');
    if (fs.existsSync(skillsDir) || fs.existsSync(agentSkillsDir)) {
      const dirToCheck = fs.existsSync(skillsDir) ? skillsDir : agentSkillsDir;
      try {
        const files = fs.readdirSync(dirToCheck);
        if (files.some(f => f.endsWith('.md'))) {
          return true;
        }
      } catch {}
    }

    // 3. brand/ or templates/ check alongside README referencing agents/workflows
    const brandPath = path.join(targetDir, 'brand');
    const templatesPath = path.join(targetDir, 'templates');
    const readmePath = path.join(targetDir, 'README.md');
    if ((fs.existsSync(brandPath) || fs.existsSync(templatesPath)) && fs.existsSync(readmePath)) {
      try {
        const readme = fs.readFileSync(readmePath, 'utf-8').toLowerCase();
        if (readme.includes('subagent') || readme.includes('operating system') || readme.includes('agent')) {
          return true;
        }
      } catch {}
    }

    return false;
  }

  getSafeguards() {
    return [
      'Dual-Layer Architecture: Layer 1 (Engineering) & Layer 2 (Domain Runtime)',
      'Mandatory Human-in-the-Loop (HITL) Checkpoints',
      'Symlink Interoperability (.cursorrules, CLAUDE.md, GEMINI.md, .windsurfrules)',
      'Domain Data Integrity & Clean Creation State (No Hallucinated Metrics)',
      'Single Source of Truth (SSOT) Memory Primacy',
      'Local-only Spec Driven Development (sdds/)'
    ];
  }

  getTools() {
    return [
      {
        name: 'check_symlinks',
        language: 'node',
        path: 'tools/check_symlinks.js',
        command: 'node tools/check_symlinks.js',
        description: 'AI IDE symlinks and rule mirror verification'
      },
      {
        name: 'check_hitl',
        language: 'node',
        path: 'tools/check_hitl.js',
        command: 'node tools/check_hitl.js',
        description: 'Human-in-the-Loop review checkpoint validator'
      },
      {
        name: 'check_domain_data',
        language: 'node',
        path: 'tools/check_domain_data.js',
        command: 'node tools/check_domain_data.js',
        description: 'Domain deliverables schema and clean state integrity'
      },
      {
        name: 'scan_secrets',
        language: 'node',
        path: 'tools/scan_secrets.js',
        command: 'node tools/scan_secrets.js',
        description: 'Security & API key leak scanner'
      }
    ];
  }

  provision(targetDir, config) {
    // 1. Create docs/, sdds/, and tools/
    super.provision(targetDir, config);

    // 2. Write Dual-Layer AGENTS.md
    const dualLayerAgents = `# Standard Operating Procedure (SOP) — AGENTS
Governed by **CLC Kernel: The Universal AI Agent Governance Engine**.
Target System: **${this.name}**

---

## 🛠️ Layer 1: Development & Maintenance Governance (Engineering)
All AI Agents (Antigravity, OpenCode, Claude Code, Cursor, Windsurf, Copilot) developing or maintaining this codebase MUST adhere to strict engineering standards:

> 🚨 **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (UNBYPASSABLE)**
> Even when the user issues a direct or urgent fix request ("fix this bug", "fix this error", "quick fix"):
> YOU ARE STRICTLY FORBIDDEN from modifying source code or workflows directly without completing the full quality harness:
> 1. **Research & Root Cause Analysis:** Investigate tracebacks and affected files before editing.
> 2. **SDD Specification:** Document non-trivial changes in \`sdds/{change-name}/01-spec.md\` (gitignored).
> 3. **Verification (Red Phase):** Write a failing test or contract validation first.
> 4. **Clean Implementation (Green Phase):** Make tests pass maintaining strict layer isolation.
> 5. **Mandatory Audit Gate:** Execute \`node tools/audit.js\` and output summary to stdout.

### Engineering Rules
1. **Conventional Commits Only**: Commits must use Conventional Commits (e.g. \`feat(...): ...\`, \`fix(...): ...\`). NEVER add \`Co-Authored-By\` or AI attribution.
2. **Mirror Links Interoperability**: \`CLAUDE.md\`, \`GEMINI.md\`, \`.cursorrules\`, and \`.windsurfrules\` must remain valid symlinks to \`AGENTS.md\`.
3. **No Superficial Symptom Patches**: Always address root causes.

---

## 🚀 Layer 2: Domain Runtime Directives (Agent Workflows & Operations)
When operating as domain agents for end-users and non-technical operators:

1. **Non-Technical Operator Friendly**: Interact naturally with the operator. Guide step-by-step through conversational prompts without technical jargon.
2. **Mandatory Human-in-the-Loop (HITL) Checkpoints**: Always pause phase-by-phase during multi-step pipelines. Present draft output and WAIT for explicit user confirmation before executing irreversible steps.
3. **SSOT Memory Primacy**: Always read from and persist to designated single-source-of-truth memory files (e.g. \`brand/client-profile.md\` or \`docs/\`).
4. **Clean Creation State (No Hallucinated Data)**: When new records, calendars, or deliverables are drafted, metric fields must initialize as \`null\` / empty. Never invent fictional stats.
5. **Deterministic Output Standard**: Outputs must strictly follow valid Markdown, JSON schema, or domain templates.

---

## 🛡️ Core AI Safeguards
${this.getSafeguards().map(s => `- ${s}`).join('\n')}
`;

    fs.writeFileSync(path.join(targetDir, 'AGENTS.md'), dualLayerAgents, 'utf-8');

    // 3. Create AI IDE mirror symlinks
    const mirrors = ['CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules'];
    for (const mirror of mirrors) {
      const mirrorPath = path.join(targetDir, mirror);
      try {
        if (!fs.existsSync(mirrorPath)) {
          fs.symlinkSync('AGENTS.md', mirrorPath);
        }
      } catch {}
    }

    // 4. Copy domain guard tools into tools/
    const srcToolsDir = path.join(__dirname, '..', '..', 'tools');
    const targetToolsDir = path.join(targetDir, 'tools');
    const toolsToCopy = ['check_symlinks.js', 'check_hitl.js', 'check_domain_data.js', 'scan_secrets.js', 'audit.js'];

    for (const toolFile of toolsToCopy) {
      const srcFile = path.join(srcToolsDir, toolFile);
      const destFile = path.join(targetToolsDir, toolFile);
      if (fs.existsSync(srcFile) && !fs.existsSync(destFile)) {
        try {
          fs.copyFileSync(srcFile, destFile);
        } catch {}
      }
    }
  }
}

module.exports = AgentOSAdapter;
