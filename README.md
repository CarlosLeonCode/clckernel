<div align="center">
  <img width="350" height="350" alt="clckernel_logo" src="https://github.com/user-attachments/assets/ed631ce1-c996-4347-b818-97b8ab25e0ec" />
</div>

# 🤖 CLC Kernel (`clckernel`)

[![npm version](https://img.shields.io/npm/v/clckernel.svg)](https://www.npmjs.com/package/clckernel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Español](https://img.shields.io/badge/README-Español-blue.svg)](./README.es.md)

> **The Universal Polyglot AI Agent Governance Engine & AIUP Orchestrator.**
> Built by [CarlosLeonCode](https://github.com/carlosleoncode).

AI coding agents (Claude, Cursor, Gemini, Copilot) generate code at unprecedented speeds. However, without strict boundaries, they introduce architectural decay, false-positive tests, and invisible technical debt. **CLC Kernel** is the definitive developer harness to govern them.

It establishes an **AI Unified Process (AIUP)**—forcing LLMs to operate like disciplined software engineers across any programming language (Next.js, FastAPI, Django, Astro, Rails, Go, Rust, Laravel).

---

## 🎯 1. Positioning: A New Category — AI Agent Governance

CLC Kernel is **not** "just another AI framework" or prompt collection. It pioneers a distinct engineering category: **Deterministic AI Agent Governance**.

| Tool Category | What It Does | Where It Falls Short | CLC Kernel Advantage |
|---|---|---|---|
| **Prompt Rules** (`.cursorrules`, `.mdc`) | Injects markdown suggestions into chat context. | **Non-deterministic:** Ignored during large contexts or quick-fix prompts. | Enforces native **AST Linters** that physically block non-compliant Git commits. |
| **Spec Tools** (OpenSpec, Markdown specs) | Documents specifications & design requirements. | **Static:** Doesn't verify failing test transitions or guard code changes. | Full **AIUP lifecycle:** Spec -> Human Gate -> Red-to-Green TDD -> AST Verification. |
| **Agent Runtimes** (LangGraph, CrewAI) | Builds multi-agent production backend apps. | **Different problem:** Doesn't govern human-in-the-loop repo development. | **Developer Tooling Harness:** Injected directly into your daily IDE workflow. |

---

## 🏛️ 2. Core Conceptual Pillars

CLC Kernel is built upon five foundational engineering principles designed to eliminate "vibe coding" hazards:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       AI UNIFIED PROCESS (AIUP)                             │
├─────────────┬─────────────┬─────────────┬──────────────────┬────────────────┤
│   1. SDD    │   2. HIT    │   3. TDD    │     4. AST       │   5. MIRROR    │
│ Spec-Driven │ Human-in-the│ Red-to-Green│ Deterministic    │ Single Source  │
│ Development │    Loop     │ Transitions │ Layer Linters    │ of Truth Sync  │
└─────────────┴─────────────┴─────────────┴──────────────────┴────────────────┘
```

### 📝 A. Spec-Driven Development (SDD)
Agents suffer from *immediacy bias*—writing code before understanding requirements. CLC Kernel forbids direct modifications: agents must first author a local, gitignored specification under `sdds/{feature-name}/` detailing objectives, architectural layer impacts, and edge cases.

### 🛑 B. Human-in-the-Loop Gate (HIT)
Before touching a single line of production code, the agent must present concrete test scenarios to the developer for review and approval. **The human is the Architect/Director; the AI is the Executor.**

### 🧪 C. Test-Driven Development (TDD Red-to-Green)
AI agents frequently generate "tautological tests" that never fail against bugs. CLC Kernel enforces real TDD: the agent must produce a failing regression test (Red Phase) and prove failure before writing implementation code (Green Phase).

### 🛡️ D. Deterministic AST Safeguards (Native Code Linters)
Markdown instructions can be forgotten by LLMs. CLC Kernel provisions deterministic Abstract Syntax Tree (AST) linters in the stack's native language (Python `ast`, Go `ast`, RuboCop, PHPStan, TypeScript AST). These guards physically validate code changes and block non-compliant commits:
- **📱 Frontend & UX:** Mobile-first responsive breakpoints & 44px touch targets (`check_responsive`), SEO metadata/GEO tags/LCP priority (`check_seo`), ARIA accessibility (`check_a11y`), UI primitive reuse (`check_ui_reuse`), image optimization & tree-shaking (`check_performance`), and Zod API contracts (`check_api_contracts`).
- **🏛️ Backend & Architecture:** Clean Architecture layer boundaries (`check_architecture`), N+1 query loop prevention (`check_db_efficiency`), migration idempotency (`check_migrations`), and secret leak scanning (`scan_secrets`).
- **🤖 Agent-OS & Domain Workflows:** AI IDE rule mirror symlink validation (`check_symlinks`), mandatory Human-in-the-Loop review checkpoint validator (`check_hitl`), domain deliverables schema & clean creation state metrics integrity (`check_domain_data`).
- **🎯 Process & Infrastructure:** Git diff vs SDD scope validation (`check_scope`), TDD Red-to-Green transition proof (`verify_tdd`), and tech guards (`docker_guard`, `celery_guard`, `redis_guard`, `postgres_guard`).

### 🔗 E. Single Source of Truth (SSOT) & Dynamic Mirroring
Managing separate instructions for Cursor, Claude, Windsurf, Copilot, and Gemini causes documentation drift. CLC Kernel solves this via **Dynamic Mirroring**:
- `AGENTS.md` is forged as the **Single Source of Truth**.
- Cross-platform filesystem symlinks automatically project `AGENTS.md` to:
  - 🧠 `CLAUDE.md` (Claude Desktop / Windsurf)
  - 🌌 `GEMINI.md` (Gemini CLI / Project IDX)
  - 💠 `.cursorrules` & `.cursor/rules/clckernel_context.mdc` (Cursor)
  - ✈️ `.github/copilot-instructions.md` (GitHub Copilot)
  - 🛸 `.antigravity/rules.md` (Antigravity)
- *Edit once in `AGENTS.md`, and all AI IDEs synchronize instantly with zero redundancy.*

---

## 💡 3. Why CLC Kernel Exists

Left unguided, AI agents create compounding **Comprehension Debt**—a codebase that grows faster than the team's ability to maintain its architecture:

<div align="center">
  <img width="900" alt="clckernel_comparison" src="https://github.com/user-attachments/assets/cb62753a-3e88-432d-9196-94eaa817864d" />
  <p><em>Left: AI agent without governance — chaotic, hallucinated code. Right: AI agent with CLC Kernel AIUP — structured, safe, architectural.</em></p>
</div>

- ❌ **Architectural Decay:** Mixing routing logic with database queries instead of respecting layer isolation.
- ❌ **UI Duplication:** Inventing raw HTML and arbitrary hex colors instead of reusing design tokens.
- ❌ **False-Positive Tests:** Writing mocks that pass trivially without testing domain invariants.
- ❌ **Secret Leaks:** Accidental commits of API credentials or private backend DTOs.

---

## 🧩 4. Recommended Ecosystem Dependencies (Modular & Optional)

CLC Kernel focuses strictly on **Governance, Process & Quality Guardrails**. It intentionally does not bundle monolithic databases or runtime graphs. Instead, it integrates modularly with companion tools (with graceful skip if absent):

| Companion Tool | Role | Why It's Recommended | Fallback Behavior |
|---|---|---|---|
| 🧠 **[Engram (MCP)](https://github.com/Gentleman-Programming/gentle-ai)** | Long-Term Memory & ADRs | Preserves architectural context, design rationales, and cross-session knowledge for agents. | Graceful skip (audits proceed without persistent memory). |
| 🕸️ **[Graphify](https://github.com/carlosleoncode/graphify)** | Code Knowledge Graph | Generates dependency graphs and visual codebase topology for architecture-aware agents. | Graceful skip (`verify_memory_graph` advisory check passes). |
| 🛡️ **[Gentle AI (RDD)](https://github.com/Gentleman-Programming/gentle-ai)** | Adversarial Review Gate | Enforces Review-Driven Development (RDD) with multi-lens inspection before commits. | Graceful skip (`verify_rdd_review_gate` advisory check passes). |
| ⚡ **Native Stack Linters** | AST & Type Safety | `ruff` (Python), `golangci-lint` (Go), `cargo clippy` (Rust), `phpstan` (PHP), `tsc` (TypeScript). | Uses whatever CLI is available in the local repository environment. |

---

## 🧠 5. The Conversational CLI Paradigm

CLC Kernel operates both in your terminal and inside your AI chat. It injects an **Agentic Playbook (`SKILL.md`)**, turning your LLM into an interactive governance orchestrator:

- 🚀 **`clckernel start`**: Auto-detects your stack, proposes an AIUP lifecycle, and generates `.clckernel.yaml`.
- 🛠️ **`clckernel create_guard`**: Generates a custom AST linter in your stack's native language (`tools/guards/`).
- 🔄 **`clckernel add_phase` / `remove_guard`**: Interactively mutates the AIUP workflow without manual YAML editing.

---

## 🌐 6. Polyglot Stack Adapters

CLC Kernel includes dedicated adapters for popular technology stacks:

| Ecosystem | Detection Signature | Test Runner | Enforced Safeguards |
|---|---|---|---|
| ⚛️ **Next.js** | `next` | Vitest / Jest | UI Reuse, Semantic Tokens, RSC Rules, Zod, A11y, Responsive, SEO, Performance |
| ⚡ **FastAPI** | `fastapi` | Pytest | Pydantic V2, Alembic Idempotency, Clean Arch AST, DB Efficiency (N+1) |
| 💎 **Rails** | `Gemfile` | RSpec | RuboCop AST, Brakeman Security, Migration Idempotency |
| 🐹 **Golang** | `go.mod` | `go test` | `golangci-lint` AST, Domain/UseCase Clean Architecture |
| 🦀 **Rust** | `Cargo.toml` | `cargo test` | `cargo clippy` AST, `cargo audit`, Strict Memory Safety |
| 🐘 **Laravel** | `artisan` | Pest / PHPUnit | PHPStan AST, Eloquent N+1 Detection, Migrations |
| 🎸 **Django** | `manage.py` | `pytest-django` | Django ORM Idempotency, Ruff AST, Scope Guard, DB Efficiency (N+1) |
| 🚀 **Astro** | `astro.config` | Playwright | Tailwind v4 Tokens, Content Collection Schema, A11y, Responsive, SEO |
| 🤖 **Agent-OS** | `skills/`, `brand/`, `templates/`, `agent-os` | Playbook / Contract Test | Dual-Layer AGENTS.md, HITL Checkpoints (`check_hitl`), AI IDE Symlinks (`check_symlinks`), Domain Data Integrity (`check_domain_data`), Secrets (`scan_secrets`) |

---

## ⚡ 7. Step-by-Step Guide (Full Lifecycle)

```
[1. Terminal]           [2. AI Chat]                 [3. TDD Loop]                 [4. Git Commit]
npx clckernel   ───►   clckernel start   ───►   "Feature X with harness"   ───►   Pre-commit Hooks
(Bootstrap)            (Interactive Setup)          (SDD -> HIT -> Tests)         (AST & Secret Guard)
```

### 1️⃣ Step 1: Bootstrap the Repository (Terminal)
```bash
npx clckernel
```
Auto-detects your framework, generates `AGENTS.md`, creates dynamic IDE symlinks, provisions pre-commit hooks (`.husky/` or `.githooks/`), and creates stack-native AST tools in `tools/`.

### 2️⃣ Step 2: Initialize in Your AI Chat (Conversational CLI)
Open Cursor, Claude Code, Gemini CLI, Windsurf, or Copilot and type:
> `clckernel start`
The agent scans your codebase silently, proposes an AIUP governance plan tailored to your framework, and generates `.clckernel.yaml`.

### 3️⃣ Step 3: Develop with the AIUP Harness
When requesting features or fixes, trigger the workflow:
> *"Add user authentication endpoint. **Use the workflow / harness**."*
The agent executes the full AIUP cycle: **SDD Spec -> HIT Approval -> TDD Red Phase -> Clean Implementation -> AST Audit**.

### 4️⃣ Step 4: Deterministic Guard Verification (Commit)
```bash
git add .
git commit -m "feat(auth): add user authentication endpoint"
```
Pre-commit hooks execute AST scanners (Clean Architecture, Secret Leaks, Scope Guard, Migration Idempotency). Non-compliant commits are blocked deterministically.

### 5️⃣ Step 5: Verify Repository Health Anytime (Terminal)
```bash
npx clckernel doctor
```
Runs the **CLC Kernel Doctor** to verify 100% compliance across `AGENTS.md`, `sdds/`, `tools/`, and Git hooks.


