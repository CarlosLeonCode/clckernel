<div align="center">
  <img width="280" height="280" alt="clckernel_logo" src="https://github.com/user-attachments/assets/ed631ce1-c996-4347-b818-97b8ab25e0ec" />

# 🤖 CLC Kernel (`clckernel`)

[![npm version](https://img.shields.io/npm/v/clckernel.svg)](https://www.npmjs.com/package/clckernel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Español](https://img.shields.io/badge/README-Español-blue.svg)](./README.es.md)

**Deterministic AI Agent Governance Engine & AIUP Orchestrator.**
*Forged by [CarlosLeonCode](https://github.com/carlosleoncode).*
</div>

AI coding agents (Cursor, Claude Code, Windsurf, Copilot) code fast, but without guardrails they create architectural decay, tautological tests, and secret leaks. 

**CLC Kernel** is a polyglot developer harness that physically governs AI agents using **deterministic AST linters (< 5ms)**, **local SDD specs**, and an enforced **AI Unified Process (AIUP)**.

---

## 📋 Table of Contents
- [🎯 Use Cases](#-use-cases)
- [🏛️ The AI Unified Process (AIUP)](#️-the-ai-unified-process-aiup)
- [⚡ Step-by-Step Guide (Full Lifecycle)](#-step-by-step-guide-full-lifecycle)
- [🎮 Universal Command Interface](#-universal-command-interface)
- [🌐 Supported Stacks & Archetypes](#-supported-stacks--archetypes)
- [🧩 Optional Ecosystem Companions](#-optional-ecosystem-companions)
- [📄 License](#-license)

---

<a id="use-cases"></a>
## 🎯 Use Cases

| Use Case | Problem It Solves | How CLC Kernel Solves It |
|---|---|---|
| **1. Coding Agent Governance**<br>*(Cursor, Claude Code, Copilot)* | Agents "vibe code", bypass tests, and violate layer boundaries in backend/frontend apps. | Enforces **Rule #0** (Research -> SDD -> TDD Red-to-Green -> AST Audit) and blocks commits via native AST guards. |
| **2. Agent-OS & Domain Workflows**<br>*(Autonomous bots, marketing/sales OS)* | Agent runtimes execute actions without review, hallucinate metrics, or drift across IDE configs. | Provides **Dual-Layer Governance**, validates IDE mirror symlinks, checks Human-in-the-Loop (`check_hitl`), and enforces null-safe schemas (`check_domain_data`). |
| **3. Complex Refactors & Migrations** | Agents modify files outside the agreed feature scope, causing silent regressions. | Locks work to a local `sdds/{change}/spec.md` and fails commits modifying untouched layers (`check_scope`). |
| **4. Shift-Left CI/CD & Pre-commit** | Secret leaks, N+1 query loops, and broken database migrations reach remote branches. | Runs zero-dependency AST checks in your stack's native language in **< 5ms** before Git commit. |

---

<a id="aiup"></a>
## 🏛️ The AI Unified Process (AIUP)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       AI UNIFIED PROCESS (AIUP)                             │
├─────────────┬─────────────┬─────────────┬──────────────────┬────────────────┤
│   1. SDD    │   2. HIT    │   3. TDD    │     4. AST       │   5. MIRROR    │
│ Spec-Driven │ Human-in-the│ Red-to-Green│ Deterministic    │ Single Source  │
│ Development │    Loop     │ Transitions │ Layer Linters    │ of Truth Sync  │
└─────────────┴─────────────┴─────────────┴──────────────────┴────────────────┘
```

1. **SDD (Spec-Driven Development):** Agent must write a local, gitignored specification (`sdds/{feature}/spec.md`) before editing production files.
2. **HIT (Human-in-the-Loop):** The engineer reviews and approves test scenarios and contracts before execution begins.
3. **TDD (Red-to-Green):** Agent must prove failure with a failing regression test (Red Phase) before writing implementation code (Green Phase).
4. **AST (Deterministic Safeguards):** Native stack parsers (Python `ast`, Go `ast`, RuboCop, TypeScript AST) inspect diffs and physically block invalid commits.
5. **SSOT (Single Source of Truth):** `AGENTS.md` is forged once and mirrored via filesystem symlinks to `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, and Copilot.

---

<a id="step-by-step-guide"></a>
## ⚡ Step-by-Step Guide (Full Lifecycle)

```
[1. Terminal]           [2. AI Chat]                 [3. TDD Loop]                 [4. Git Commit]
npx clckernel   ───►   clckernel start   ───►   "Feature X with harness"   ───►   Pre-commit Hooks
(Bootstrap)            (Interactive Setup)          (SDD -> HIT -> Tests)         (AST & Secret Guard)
```

### 1️⃣ Step 1: Bootstrap the Repository (Terminal)
```bash
npx clckernel start
```
Auto-detects your framework, generates `AGENTS.md`, creates dynamic IDE symlinks (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`), provisions pre-commit hooks, and creates native AST checks in `tools/`.

### 2️⃣ Step 2: Initialize in Your AI Chat (Conversational CLI)
Open Cursor, Claude Code, Gemini CLI, Windsurf, or Copilot and type:
> `clckernel start`

The agent scans your codebase silently, proposes an AIUP governance plan tailored to your framework, and generates `.clckernel.yaml`.

### 3️⃣ Step 3: Develop with the AIUP Harness
When requesting features or bugfixes, instruct your agent:
> *"Add user authentication endpoint. **Follow the CLC Kernel harness**."*

The agent autonomously executes the complete AIUP cycle:
1. **Research & Root Cause Analysis:** Inspects codebase and dependencies.
2. **Local SDD Spec:** Writes API contracts and test plans in `sdds/{change}/spec.md`.
3. **HIT Review:** Requests your review and approval on proposed contracts.
4. **TDD Red Phase:** Writes a failing regression test proving the requirement.
5. **Clean Implementation (Green Phase):** Writes minimal code to pass tests while respecting layer isolation.
6. **AST Audit Gate:** Runs `node tools/audit.js` and outputs the verification summary.

### 4️⃣ Step 4: Deterministic Guard Verification (Git Commit)
```bash
git add .
git commit -m "feat(auth): add user authentication endpoint"
```
Pre-commit hooks automatically execute AST scanners (Clean Architecture, Secret Leaks, Scope Guard, Migration Idempotency). Any non-compliant commit is **physically blocked** before touching Git history.

### 5️⃣ Step 5: Verify Repository Health Anytime (Doctor)
```bash
npx clckernel doctor
```
Audits 100% compliance across `AGENTS.md`, `sdds/`, `tools/`, active test runners, and Git hooks.

---

<a id="universal-command-interface"></a>
## 🎮 Universal Command Interface (All LLMs & Agents)

CLC Kernel provides a deterministic command grammar supported natively by **Claude Code, Cursor, Codeium/Windsurf, Copilot, Gemini, and Antigravity**:

| Command | Category | Mandatory Execution Protocol |
|---|---|---|
| `clckernel feature <name>` | Feature | Full AIUP cycle: Research -> Local Spec (`sdds/{name}/spec.md`) -> HIT review -> TDD Red Phase -> Green Implementation -> Audit. |
| `clckernel fix <issue>` | Bug Fix | Root-cause analysis (no direct code edits) -> Failing regression test -> Surgical clean fix -> Audit gate. |
| `clckernel test` | Verification | Runs repository test suite in the native stack runner and confirms clean pass. |
| `clckernel audit` | Verification | Runs `node tools/audit.js` or `python tools/audit.py` and emits the Educational Summary. |
| `clckernel doctor` | Diagnostics | Checks Git pre-commit hooks, IDE mirror symlinks, and AST engine integrity. |
| `clckernel commit <message>` | Version Control | Pre-flight audit, verifies diff vs SDD scope, and commits with Conventional Commits (zero AI attribution). |
| `clckernel guard create <name>` | Safeguards | Scaffolds a new AST guard script in the stack's native language in `tools/guards/`. |
| `clckernel start` | Setup | Auto-detects stack, proposes AIUP lifecycle, and generates `.clckernel.yaml`. |

---

<a id="supported-stacks"></a>
## 🌐 Supported Stacks & Archetypes

| Ecosystem | Detection Signature | Test Runner | Native Safeguards |
|---|---|---|---|
| ⚛️ **Next.js** | `next` | Vitest / Jest | Clean Arch, UI Reuse, Semantic Tokens, RSC, A11y, Responsive, SEO |
| ⚡ **FastAPI** | `fastapi` | Pytest | Pydantic V2, Alembic Idempotency, Clean Arch AST, DB Efficiency (N+1) |
| 💎 **Rails** | `Gemfile` | RSpec | RuboCop AST, Brakeman Security, Migration Idempotency |
| 🐹 **Golang** | `go.mod` | `go test` | `golangci-lint` AST, Domain/UseCase Layer Isolation |
| 🦀 **Rust** | `Cargo.toml` | `cargo test` | `cargo clippy` AST, `cargo audit`, Strict Memory Safety |
| 🐘 **Laravel** | `artisan` | Pest / PHPUnit | PHPStan AST, Eloquent N+1 Loop Detection, Migrations |
| 🎸 **Django** | `manage.py` | `pytest-django` | Django ORM Idempotency, Ruff AST, Scope Guard, DB Efficiency (N+1) |
| 🚀 **Astro** | `astro.config` | Playwright | Tailwind v4 Tokens, Content Schema, A11y, Responsive, SEO |
| 🤖 **Agent-OS** | `skills/`, `brand/`, `templates/` | Contract Tests | Dual-Layer AGENTS.md, HITL Gates (`check_hitl`), Symlinks (`check_symlinks`), Domain Data (`check_domain_data`) |

---

<a id="ecosystem-companions"></a>
## 🧩 Optional Ecosystem Companions

CLC Kernel focuses strictly on governance and runs with **zero foreign dependencies**. It seamlessly integrates with companion tools:
- 🧠 **[Engram (MCP)](https://github.com/Gentleman-Programming/gentle-ai):** Persistent architectural memory and ADR tracking across agent sessions.
- 🕸️ **[Graphify](https://github.com/carlosleoncode/graphify):** Visual dependency graphs and codebase topology mapping.
- 🛡️ **[Gentle AI (RDD)](https://github.com/Gentleman-Programming/gentle-ai):** Multi-lens adversarial code review gate.

---

<a id="license"></a>
## 📄 License
MIT © [CarlosLeonCode](https://github.com/carlosleoncode)
