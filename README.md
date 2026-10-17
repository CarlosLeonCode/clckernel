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

**CLC Kernel** is a polyglot developer harness that governs AI agents using **deterministic pre-commit guards** (pattern-based checks, plus Python AST guards on Python stacks), **local SDD specs**, and an enforced **AI Unified Process (AIUP)**.

---

## 📋 Table of Contents
- [🎯 Use Cases](#-use-cases)
- [🏛️ The AI Unified Process (AIUP)](#️-the-ai-unified-process-aiup)
- [🔍 Review-Driven Development (RDD) & the 4 Lenses](#-review-driven-development-rdd--the-4-lenses)
- [⚡ Step-by-Step Guide (Full Lifecycle)](#-step-by-step-guide-full-lifecycle)
- [🎮 Universal Command Interface](#-universal-command-interface)
- [🔄 Updating an Existing Project](#-updating-an-existing-project)
- [🌐 Supported Stacks & Archetypes](#-supported-stacks--archetypes)
- [🏛️ Architecture: Standalone vs. Gentle AI Symbiosis](#-architecture-standalone-vs-gentle-ai-symbiosis)
- [🧩 Optional Ecosystem Companions](#-optional-ecosystem-companions)
- [📖 Glossary of Key Terms](#-glossary-of-key-terms)
- [📄 License](#-license)

---

<a id="use-cases"></a>
## 🎯 Use Cases

| Use Case | Problem It Solves | How CLC Kernel Solves It |
|---|---|---|
| **1. Coding Agent Governance**<br>*(Cursor, Claude Code, Copilot)* | Agents "vibe code", bypass tests, and violate layer boundaries in backend/frontend apps. | Enforces **Rule #0** (Research -> SDD -> TDD Red-to-Green -> Audit) and blocks commits via the pre-commit hook (`--no-verify` skips it; CI is the backstop). |
| **2. Agent-OS & Domain Workflows**<br>*(Autonomous bots, marketing/sales OS)* | Agent runtimes execute actions without review, hallucinate metrics, or drift across IDE configs. | Provides **Dual-Layer Governance**, validates IDE mirror symlinks, checks Human-in-the-Loop (`check_hitl`), and enforces null-safe schemas (`check_domain_data`). |
| **3. Complex Refactors & Migrations** | Agents modify files outside the agreed feature scope, causing silent regressions. | Anchors work to a local `sdds/{change}/spec.md`; scope is an agent-enforced protocol (not checked by a guard). |
| **4. Shift-Left CI/CD & Pre-commit** | Secret leaks, N+1 query loops, and broken database migrations reach remote branches. | Runs zero-dependency checks in your stack's native language before Git commit: pattern-based guards everywhere, Python AST guards (layers, N+1 heuristic) on Python stacks. |

---

<a id="aiup"></a>
## 🏛️ The AI Unified Process (AIUP)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       AI UNIFIED PROCESS (AIUP)                             │
├─────────────┬─────────────┬─────────────┬──────────────────┬────────────────┤
│   1. SDD    │   2. HIT    │   3. TDD    │    4. GUARDS     │   5. MIRROR    │
│ Spec-Driven │ Human-in-the│ Red-to-Green│ Deterministic    │ Single Source  │
│ Development │    Loop     │ Transitions │ Pre-commit Hook  │ of Truth Sync  │
└─────────────┴─────────────┴─────────────┴──────────────────┴────────────────┘
```

1. **SDD (Spec-Driven Development):** Agent must write a local, gitignored specification (`sdds/{feature}/spec.md`) before editing production files.
2. **HIT (Human-in-the-Loop):** The engineer reviews and approves test scenarios and contracts before execution begins.
3. **TDD (Red-to-Green):** Agent must prove failure with a failing regression test (Red Phase) before writing implementation code (Green Phase).
4. **Guards (Deterministic Safeguards):** Pattern-based scripts (and Python `ast` parsers for Python stacks) inspect the staged diff; the pre-commit hook blocks non-compliant commits (`--no-verify` skips it; CI is the backstop).
5. **SSOT (Single Source of Truth):** `AGENTS.md` is forged once and mirrored via filesystem symlinks to `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, and Copilot.

---

<a id="rdd-and-lenses"></a>
## 🔍 Review-Driven Development (RDD) & the 4 Lenses

CLC Kernel structures all verification and audit gates around **Review-Driven Development (RDD)**, with guard results grouped into **4 lenses** by a static name → lens table:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     RESULTS GROUPED INTO 4 REVIEW LENSES                    │
├─────────────────────┬───────────────────┬───────────────────┬───────────────┤
│    🎯 CORRECTNESS   │    🛡️ SECURITY    │  🏛️ ARCHITECTURE  │ ⚡ PERFORMANCE│
│ Functional bugs,    │ Secret leaks,     │ Layer violations, │ N+1 heuristic,│
│ scope drift, TDD,   │ permission bypass,│ domain boundaries,│ bundle size,  │
│ API contracts       │ dangerous eval    │ circular deps     │ memory leaks  │
└─────────────────────┴───────────────────┴───────────────────┴───────────────┘
```

When you run `clckernel audit` (or `node tools/audit.js`), CLC Kernel generates:
1. **Human-Readable Educational Report (`05-audit-report.md`):** Explains exactly what passed, failed, or was skipped grouped by lens.
2. **Machine-Readable Audit Receipt (`audit-receipt.json`):** An immutable JSON receipt bound to the active `commitHash` certifying the verdict for automated review gates (such as Gentle AI).

---

<a id="step-by-step-guide"></a>
## ⚡ Step-by-Step Guide (Full Lifecycle)

```
[1. Terminal]           [2. AI Chat]                 [3. TDD Loop]                 [4. Git Commit]
npx clckernel   ───►   clckernel start   ───►   "Feature X with harness"   ───►   Pre-commit Hooks
(Bootstrap)            (Interactive Setup)          (SDD -> HIT -> Tests)         (Guards & Secret Scan)
```

### 1️⃣ Step 1: Bootstrap the Repository (Terminal)
```bash
npx clckernel start
```
Auto-detects your framework, generates `AGENTS.md`, creates dynamic IDE symlinks (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`), provisions pre-commit hooks, and installs native guard scripts in `tools/`.

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
6. **Audit Gate:** Runs `node tools/audit.js` and outputs the verification summary.

### 4️⃣ Step 4: Deterministic Guard Verification (Git Commit)
```bash
git add .
git commit -m "feat(auth): add user authentication endpoint"
```
Pre-commit hooks automatically execute the installed guards (e.g. Clean Architecture, Secret Leaks, Migration Reversibility, depending on the stack). Any non-compliant commit is **blocked by the pre-commit hook** (`--no-verify` skips it; CI is the backstop).

### 5️⃣ Step 5: Verify Repository Health Anytime (Doctor)
```bash
npx clckernel doctor
```
Checks `AGENTS.md`, `sdds/`, `tools/`, test runners and Git hooks.

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
| `clckernel doctor` | Diagnostics | Checks Git pre-commit hooks, IDE mirror symlinks, and guard script integrity. |
| `clckernel commit <message>` | Version Control | Pre-flight audit, verifies diff vs SDD scope, and commits with Conventional Commits (zero AI attribution). |
| `clckernel guard create <name>` | Safeguards | Scaffolds a new guard script in the stack's native language in `tools/guards/`. |
| `clckernel update` | Maintenance | Non-destructive update: refreshes core tools, skills & IDE symlinks without overwriting SDDs, custom guards, or `.clckernel.yaml`. |
| `clckernel start` | Setup | Auto-detects stack, proposes AIUP lifecycle, and generates `.clckernel.yaml`. |

---

<a id="updating-an-existing-project"></a>
## 🔄 Updating an Existing Project (Non-Destructive)

When new versions of CLC Kernel are released with new guards, upgraded playbooks, or improved IDE rules, update your project safely without losing your work:

```bash
npx clckernel update
```
Or from your AI agent chat:
```bash
clckernel update
```

### 🔒 The Non-Destructive Update Guarantee:
- **Refreshes & Upgrades:** Core orchestrators (`tools/audit.js`, `tools/audit.py`), built-in guards, Agent Skills (`.agents/skills/`), and IDE symlinks (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, Copilot, Antigravity).
- **100% Preserved:**
  - `sdds/`: All local specifications, plans, and verification receipts remain intact.
  - `tools/guards/`: All team-authored custom guards are preserved without modification.
  - `.clckernel.yaml`: All custom thresholds and active safeguard selections are preserved.
  - Application source code and domain models are never touched.

---

<a id="supported-stacks"></a>
## 🌐 Supported Stacks & Archetypes

| Ecosystem | Detection Signature | Test Runner | Native Safeguards |
|---|---|---|---|
| ⚛️ **Next.js** | `next` | Vitest / Jest | Clean Arch, UI Reuse, Semantic Tokens, RSC, A11y, Responsive, SEO |
| ⚡ **FastAPI** | `fastapi` | Pytest | Alembic Migration Reversibility, Clean Arch (Python AST), N+1 Heuristic (Python AST), Red→Green TDD Verifier (pytest) |
| 💎 **Rails** | `Gemfile` | RSpec | RuboCop, Brakeman Security |
| 🐹 **Golang** | `go.mod` | `go test` | `golangci-lint`, Domain/UseCase Layer Isolation |
| 🦀 **Rust** | `Cargo.toml` | `cargo test` | `cargo clippy`, `cargo audit`, Strict Memory Safety |
| 🐘 **Laravel** | `artisan` | Pest / PHPUnit | PHPStan static analysis |
| 🎸 **Django** | `manage.py` | `pytest-django` | Ruff, Clean Arch (Python AST), N+1 Heuristic (Python AST), Red→Green TDD Verifier (pytest) |
| 🚀 **Astro** | `astro.config` | Playwright | Tailwind v4 Tokens, Content Schema, A11y, Responsive, SEO |
| 🤖 **Agent-OS** | `skills/`, `brand/`, `templates/` | Contract Tests | Dual-Layer AGENTS.md, HITL Gates (`check_hitl`), Symlinks (`check_symlinks`), Domain Data (`check_domain_data`) |

---

<a id="architecture-symbiosis"></a>
## 🏛️ Architecture: Standalone vs. Gentle AI Symbiosis

CLC Kernel is architected with a **zero-lock-in philosophy**: it functions as a 100% self-sufficient local governance engine, while offering seamless, native interoperability with the [Gentle AI](https://github.com/Gentleman-Programming/gentle-ai) ecosystem.

<div align="center">
  <img src="./docs/Architecture/clckernel-symbiosis.visual-check.2048x1320.dark.png" alt="CLC Kernel Standalone vs Gentle AI Symbiosis (Archify Diagram)" width="100%" />
</div>

> 💡 *Interactive Diagram: Built with [Archify](https://github.com/tt-a1i/archify). Open [`docs/Architecture/clckernel-symbiosis.html`](./docs/Architecture/clckernel-symbiosis.html) for full trace animation, theme switching, and deep-link node inspection.*

```mermaid
flowchart TD
  subgraph CORE["🤖 CLC KERNEL (Core Governance Engine)"]
    SSOT["1. SSOT Law<br/>(AGENTS.md & IDE Mirrors)"]
    AIUP["2. AIUP Harness<br/>(SDD + HITL + TDD Red-to-Green)"]
    GUARDS["3. Pre-commit Guards<br/>(Layer, Secret & Migration Rules)"]
    RECEIPT["4. 4-Lens Audit Engine<br/>(Emits audit-receipt.json)"]
    SSOT --> AIUP --> GUARDS --> RECEIPT
  end

  RECEIPT -->|audit-receipt.json| MODES{Deployment Mode}

  subgraph MODE1["🟢 MODE 1: STANDALONE (100% Local & Offline)"]
    M1_1["• Zero foreign dependencies"]
    M1_2["• Guards run in the stack's native language"]
    M1_3["• Git pre-commit hook blocks invalid commits (--no-verify skips it; CI is the backstop)"]
    M1_4["• Self-contained 05-audit-report.md"]
  end

  subgraph MODE2["🟣 MODE 2: + GENTLE AI SYMBIOSIS"]
    M2_1["🧠 Engram (MCP): Persistent context & ADR tracking"]
    M2_2["🛡️ Gentle AI (RDD): Multi-agent adversarial review"]
    M2_3["🕸️ Graphify: Codebase topology & blast radius analysis"]
    M2_4["🔗 Zero-Lock-In: Consumes audit-receipt.json seamlessly"]
  end

  MODES -->|Local Only| MODE1
  MODES -->|With Companions| MODE2
```

---

<a id="ecosystem-companions"></a>
## 🧩 Optional Ecosystem Companions

CLC Kernel focuses strictly on governance and runs with **zero foreign dependencies**. It seamlessly integrates with companion tools:
- 🧠 **[Engram (MCP)](https://github.com/Gentleman-Programming/gentle-ai):** Persistent architectural memory and ADR tracking across agent sessions.
- 🕸️ **[Graphify](https://github.com/carlosleoncode/graphify):** Visual dependency graphs and codebase topology mapping.
- 🛡️ **[Gentle AI (RDD)](https://github.com/Gentleman-Programming/gentle-ai):** Multi-lens adversarial code review gate.

---

<a id="glossary"></a>
## 📖 Glossary of Key Terms

| Term | Definition |
|---|---|
| **SDD** *(Spec-Driven Development)* | A specification-first methodology where detailed technical contracts, schemas, acceptance criteria, and test scenarios are authored in local, gitignored specs (`sdds/{change}/spec.md`) before modifying source code. |
| **RDD** *(Review-Driven Development)* | An adversarial and structured code verification methodology where changes are audited across four orthogonal lenses (Correctness, Security, Architecture, Performance) to ensure systematic quality gates before merge or commit. |
| **AIUP** *(AI Unified Process)* | The end-to-end governed lifecycle implemented by CLC Kernel: Research $\rightarrow$ Local SDD $\rightarrow$ Human-in-the-Loop (HITL) approval $\rightarrow$ TDD Red-to-Green $\rightarrow$ Guard Audit Gate $\rightarrow$ Conventional Commit. |
| **HIT / HITL** *(Human-in-the-Loop)* | A mandatory approval gate where a human engineer validates contracts, architecture decisions, and proposed tests before an autonomous agent executes production code edits. |
| **TDD** *(Test-Driven Development)* | The engineering practice of writing a failing automated regression test (Red Phase) to reproduce an issue or specify a new feature before writing the minimal production code to make it pass (Green Phase). |
| **Guard** *(Safeguard script)* | A lightweight, zero-dependency check in the stack's native language, run by the pre-commit hook. Most guards are pattern-based (regex); on Python stacks the layer, N+1 and Celery/Redis/Postgres guards parse code with Python `ast`. The hook blocks violations before commit (`--no-verify` skips it; CI is the backstop). |
| **SSOT** *(Single Source of Truth)* | The centralized governance principle where `AGENTS.md` acts as the single source of truth, mirrored automatically to all AI IDE config files (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, Copilot) via filesystem symlinks. |
| **Audit Receipt** | An immutable, machine-readable JSON artifact (`audit-receipt.json`) produced by the audit engine containing the timestamp, commit hash, per-lens verdicts, and Gentle AI RDD compatibility metadata. |
| **ADR** *(Architectural Decision Record)* | A standardized document in `docs/Journal/` capturing significant architectural decisions, context, evaluated alternatives, and consequences. |
| **Agent-OS** | An operating system archetype for non-tech domain workflows (e.g. Marketing OS, Content Ops, Research OS) governed by dual-layer architecture, strict schema validation, and HITL checkpoints. |

---

<a id="license"></a>
## 📄 License
MIT © [CarlosLeonCode](https://github.com/carlosleoncode)
