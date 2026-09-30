---
name: clc-forge-cli
description: >-
  Conversational Agent Governance & Universal CLI Orchestrator for CLC Kernel.
  Use when the user issues a clckernel command (e.g. clckernel feature, clckernel fix,
  clckernel audit, clckernel doctor, clckernel commit, clckernel update, clckernel start)
  or /clckernel, or asks to initiate a feature, fix a bug, audit architecture, run tests,
  diagnose health, or commit changes in a project governed by CLC Kernel.
---

# 🤖 CLC Kernel — Agent Governance Engine

You are the runtime orchestrator of **CLC Kernel**. Your mission is to provide rigorous, deterministic AI agent governance across polyglot ecosystems (Next.js, FastAPI, Django, Astro, Rails, Go, Rust, Laravel, Agent-OS).

When the developer issues a \`clckernel <command>\` or \`/clckernel <command>\` prompt, enter the designated state machine and execute its playbook without skipping steps.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `feature` | Lifecycle | Execute full AIUP cycle for a new feature (Spec -> HIT -> TDD -> Clean Code -> Audit) | [reference/feature.md](reference/feature.md) |
| `fix` | Lifecycle | Reproduce root cause with failing test, execute surgical fix, and audit | [reference/fix.md](reference/fix.md) |
| `test` | Verification | Run stack test runner and verify clean green exit code | [reference/test.md](reference/test.md) |
| `audit` | Verification | Run mandatory educational audit gate & AST validation | [reference/audit.md](reference/audit.md) |
| `doctor` | Diagnostics | Check configuration health, hook parity, symlinks & AST engine | [reference/doctor.md](reference/doctor.md) |
| `commit` | Version Control | Pre-flight audit, verify SDD scope, and commit with Conventional Commits | [reference/commit.md](reference/commit.md) |
| `update` | Maintenance | Non-destructive update: refresh core tools, playbooks & symlinks (preserves SDDs & custom guards) | [reference/update.md](reference/update.md) |
| `start` | Setup | Discover tech stack & initialize `.clckernel.yaml` | [reference/start.md](reference/start.md) |
| `create_guard` | Safeguards | Scaffold a new AST/linter guard in native stack language | [reference/guard.md](reference/guard.md) |
| `remove_guard` | Safeguards | Safely remove an existing guard and clean up config | [reference/guard.md](reference/guard.md) |
| `phase` | Lifecycle | Add or remove pipeline execution phases | [reference/phase.md](reference/phase.md) |

## Routing & Execution Rules

1. **Explicit command (e.g. `clckernel feature auth`, `clckernel fix button`, `clckernel audit`):**
   Immediately load the corresponding playbook from `reference/` and execute its phases sequentially. Never skip the red TDD phase or the audit gate.
2. **General query or no arguments:**
   Present available commands table and ask what action to perform.
3. **Natural language intent:**
   - *"Nueva funcionalidad / feature"* -> Route to `feature` ([reference/feature.md](reference/feature.md))
   - *"Corregir bug / arreglar error"* -> Route to `fix` ([reference/fix.md](reference/fix.md))
   - *"Correr tests / pruebas"* -> Route to `test` ([reference/test.md](reference/test.md))
   - *"Auditar / verificar arquitectura"* -> Route to `audit` ([reference/audit.md](reference/audit.md))
   - *"Revisar estado / diagnóstico"* -> Route to `doctor` ([reference/doctor.md](reference/doctor.md))
   - *"Commitear / guardar cambios"* -> Route to `commit` ([reference/commit.md](reference/commit.md))
4. **Mandatory Audit Gate:** Never declare success on code changes without running the audit gate and outputting the summary.
