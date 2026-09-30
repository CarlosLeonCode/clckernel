/**
 * CLC Kernel — Base Stack Adapter Interface
 * All framework-specific adapters (Rails, Astro, Next.js, FastAPI, Go, Rust, Laravel)
 * inherit from this interface to ensure universal polyglot harness behavior.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { TechnologyDetector } = require('../technologies/detector');

class BaseAdapter {
  constructor(name, projectType, testRunner) {
    this.name = name;
    this.projectType = projectType;
    this.testRunner = testRunner;
    this.techDetector = new TechnologyDetector();
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
   * Override in subclasses to declare stack-specific tools.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    return [];
  }

  /**
   * Merges technology-specific tools into the adapter tool manifest.
   * Tech tools are inserted before check_custom to preserve user override escape hatch.
   * @param {Array} baseTools - The adapter's base tool manifest
   * @returns {Array} Merged tool manifest with technology tools inserted
   */
  _mergeTechTools(baseTools) {
    const techTools = this.techDetector.getToolsForTech(this.detectedTech || []);
    if (techTools.length === 0) return baseTools;

    const result = [];
    for (const tool of baseTools) {
      if (tool.name === 'check_custom') {
        // Insert tech tools before check_custom
        result.push(...techTools);
      }
      result.push(tool);
    }
    return result;
  }

  provision(targetDir, config) {
    // Subclasses that render their own AGENTS.md pass { skipAgentsMd: true }
    // so this generic law file is never written alongside (or over) theirs.
    const skipAgentsMd = !!(config && config.skipAgentsMd);

    // 1. Create docs/ and sdds/
    fs.mkdirSync(path.join(targetDir, 'docs', 'Journal'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'docs', 'Architecture'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'docs', 'Development'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'sdds'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'tools'), { recursive: true });

    // 2. Gitignore sdds/*
    const gitignorePath = path.join(targetDir, '.gitignore');
    let gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (!gitignore.includes('sdds/*')) {
      gitignore += '\n\n# Local Spec-Driven Development (SDD) files\nsdds/*\n!sdds/.gitkeep\nopenspec/*\n!openspec/.gitkeep\n.ruff_cache/\n';
      fs.writeFileSync(gitignorePath, gitignore, 'utf-8');
    }
    fs.writeFileSync(path.join(targetDir, 'sdds', '.gitkeep'), '', 'utf-8');

    // 3. Write AGENTS.md
    const isFront = this.projectType === 'frontend';
    const agentsContent = skipAgentsMd ? '' : `# 🔨 CLC Kernel ${this.name} (${this.projectType.toUpperCase()}) — AGENTS

This document is the **authoritative law** for AI agents working in this repository.
Forged by **CLC Kernel: The AI Agent Governance Engine**.

> 🚨 **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (UNBYPASSABLE)**
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
5. **Verify & Audit** — Run \`node tools/audit.js\` or \`python tools/audit.py\`.
6. **DoD** — Lint, typecheck, tests, coverage, docs, memory.
7. **Commit** — Pre-commit hook runs automated guards.
8. **PR** — Generate PR body.

## 2. Core AI Safeguards (${this.name})
${this.getSafeguards().map(s => `- ${s}`).join('\n')}
`;
    // Guard: never overwrite a project-customized AGENTS.md.
    if (skipAgentsMd) {
      return;
    }
    const agentsPath = path.join(targetDir, 'AGENTS.md');
    if (!fs.existsSync(agentsPath)) {
      fs.writeFileSync(agentsPath, agentsContent, 'utf-8');
    }
  }
}

module.exports = BaseAdapter;
