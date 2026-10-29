/**
 * CLC Kernel — Base Stack Adapter Interface
 * All framework-specific adapters (Rails, Astro, Next.js, FastAPI, Go, Rust, Laravel)
 * inherit from this interface to ensure universal polyglot harness behavior.
 */

const path = require('path');
const { currentIO } = require('../io');
const { FIRST_SESSION_SECTION, KERNEL_BUG_SECTION } = require('../onboarding');

class BaseAdapter {
  constructor(name, projectType, testRunner) {
    this.name = name;
    this.projectType = projectType;
    this.testRunner = testRunner;
  }

  detect(targetDir) {
    return false;
  }

  getSafeguards() {
    return [];
  }

  /**
   * Returns the tool manifest for this adapter.
   * Each entry describes one pre-commit tool (script or external CLI).
   * Override in subclasses to declare stack-specific tools. The generator
   * passes the project root, so an adapter may add guards whose structure is
   * present; without it the adapter's unconditional set is returned.
   * @param {string} [targetDir] - Project root
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools(targetDir) {
    return [];
  }

  provision(targetDir, config) {
    // Subclasses that render their own AGENTS.md pass { skipAgentsMd: true }
    // so this generic law file is never written alongside (or over) theirs.
    const skipAgentsMd = !!(config && config.skipAgentsMd);

    // Every write goes through the active io session (sdds/safe-update).
    const io = currentIO(targetDir);

    // 1. Create docs/ and sdds/
    io.mkdir(path.join(targetDir, 'docs', 'Journal'));
    io.mkdir(path.join(targetDir, 'docs', 'Architecture'));
    io.mkdir(path.join(targetDir, 'docs', 'Development'));
    io.mkdir(path.join(targetDir, 'sdds'));
    io.mkdir(path.join(targetDir, 'tools'));

    // 2. Gitignore local SDD specs, ephemeral artifacts, and AI IDE mirrors
    const { ensureGitignoreEntries } = require('../gitignore');
    ensureGitignoreEntries(targetDir);
    const gitkeep = path.join(targetDir, 'sdds', '.gitkeep');
    if (!io.exists(gitkeep)) io.writeFile(gitkeep, '');

    // 3. Write AGENTS.md
    const isFront = this.projectType === 'frontend';
    const agentsContent = skipAgentsMd ? '' : `# 🔨 CLC Kernel ${this.name} (${this.projectType.toUpperCase()}) — AGENTS

This document is the **authoritative law** for AI agents working in this repository.
Forged by **CLC Kernel: The AI Agent Governance Engine**.

> 🚨 **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (NO EXCEPTIONS)**
> Even when the user issues a direct or urgent fix request ("fix this bug", "fix this error", "quick fix"):
> YOU ARE STRICTLY FORBIDDEN from modifying source code directly without completing the full quality harness:
> 1. **Research & Root Cause Analysis:** Investigate tracebacks and inspect affected files before editing.
> 2. **TDD Verification (Red Phase):** Write a failing regression test first (${this.testRunner}).
> 3. **Clean Architecture Implementation (Green Phase):** Make the test pass maintaining layer isolation.
> 4. **Mandatory Educational Audit Gate:** Execute \`node tools/audit.js\` or \`python tools/audit.py\` and output the Educational Code Summary to stdout.
> NEVER declare success or skip verification commands for quick fixes.

## 1. The Loop (Every Task)
1. **Research** — Inspect codebase / docs before writing code.
2. **Plan** — Write an SDD under \`sdds/{change-name}/\`. SDDs live 100% locally and are gitignored.
3. **Test** (TDD) — Write failing test first (${this.testRunner}).
4. **Implement** — Make test pass.
5. **Verify & Audit** — Run \`node tools/audit.js --change {change-name}\` or \`python tools/audit.py --change {change-name}\` (report + receipt in \`sdds/{change-name}/\`; without \`--change\` nothing is written).
6. **DoD** — Lint, typecheck, tests, coverage, docs, memory.
7. **Commit** — Pre-commit hook runs automated guards.
8. **PR** — Generate PR body.

## 2. Core AI Safeguards (${this.name})
${this.getSafeguards().map(s => `- ${s}`).join('\n')}

${KERNEL_BUG_SECTION}
${FIRST_SESSION_SECTION}`;
    // Guard: never overwrite a project-customized AGENTS.md.
    if (skipAgentsMd) {
      return;
    }
    const agentsPath = path.join(targetDir, 'AGENTS.md');
    if (!io.exists(agentsPath)) {
      io.writeFile(agentsPath, agentsContent);
    }
  }
}

module.exports = BaseAdapter;
