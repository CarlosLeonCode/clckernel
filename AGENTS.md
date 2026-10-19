# CLC Kernel FastAPI (BACKEND) — AGENTS

This document is the **authoritative law** for AI agents working in this repository.
Forged by **CLC Kernel: The AI Agent Governance Engine**.

> **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (NO EXCEPTIONS)**
> Even when the user issues a direct or urgent fix request ("fix this bug", "fix this error", "quick fix"):
> YOU ARE STRICTLY FORBIDDEN from modifying source code directly without completing the full quality harness:
> 1. **Research & Root Cause Analysis:** Investigate tracebacks and inspect affected files before editing.
> 2. **TDD Verification (Red Phase):** Write a failing regression test first (Pytest).
> 3. **Clean Architecture Implementation (Green Phase):** Make the test pass maintaining layer isolation.
> 4. **Mandatory Educational Audit Gate:** Execute `node tools/audit.js` or `python tools/audit.py` and output the Educational Code Summary to stdout.
> NEVER declare success or skip verification commands for quick fixes.

## 1. The Loop (Every Task)
1. **Research** — Inspect codebase / docs before writing code.
2. **Plan** — Write an SDD under `sdds/{change-name}/`. SDDs live 100% locally and are gitignored.
3. **Test** (TDD) — Write failing test first (Pytest).
4. **Implement** — Make test pass.
5. **Verify & Audit** — Run `node tools/audit.js --change {change-name}` or `python tools/audit.py --change {change-name}` (report + receipt in `sdds/{change-name}/`; without `--change` nothing is written).
6. **DoD** — Lint, typecheck, tests, coverage, docs, memory.
7. **Commit** — Pre-commit hook runs automated guards.
8. **PR** — Generate PR body.

## 2. Core AI Safeguards
- Wait for Audit Gate
- Scope protocol (agent-enforced; not checked by a guard)
- TDD protocol (agent-enforced; no verifier installed for this stack)
- Secret Leak Guard
- Clean Architecture protocol (agent-enforced; no layer guard installed for this stack)
- N+1 Heuristic (ORM-like calls inside loops, Python AST)
- Migration Reversibility protocol (agent-enforced; no migration guard installed for this stack)
- Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)

## 3. Universal Command Interface (All LLMs & Agents)
When given a command matching `clckernel <action>` or `/clckernel <action>`, execute the deterministic state machine below:

| Command | Lifecycle Phase | Mandatory Execution Protocol |
|---|---|---|
| `clckernel feature <name>` | New Feature | 1. Research affected layers.<br>2. Author local spec in `sdds/{name}/spec.md`.<br>3. Present HIT review to user and wait for approval.<br>4. Write failing test (Red Phase).<br>5. Implement clean code (Green Phase).<br>6. Run `node tools/audit.js --change {name}` (or `audit.py --change {name}`). |
| `clckernel fix <issue>` | Bug Fix | 1. Investigate root cause (no code edits).<br>2. Reproduce with failing test (Red Phase).<br>3. Minimal surgical fix respecting Clean Arch (Green Phase).<br>4. Run audit gate without skipping. |
| `clckernel test` | Verification | Run test suite (`npm test`) and verify clean pass (exit code 0). |
| `clckernel audit` | Verification | Run `node tools/audit.js` or `python tools/audit.py` and output the Educational Summary. |
| `clckernel doctor` | Diagnostics | Check git pre-commit hooks, IDE symlinks, and guard script integrity. |
| `clckernel commit <message>` | Version Control | Run full audit, verify tests pass, ensure no changes outside SDD scope, and commit with conventional commits (never add AI attribution). |
| `clckernel guard create <name>` | Safeguards | Scaffold a new guard script in the stack's native language in `tools/guards/`. |
| `clckernel update` | Maintenance | Non-destructive update: refresh core tools, playbooks & symlinks (preserves SDDs & custom guards). |
| `clckernel start` | Setup | Scan codebase, propose governance plan, and materialize `.clckernel.yaml`. |

