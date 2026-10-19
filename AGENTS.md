# CLC Kernel (Node CLI) — AGENTS

Authoritative rules for AI agents working on **this repository**: the `clckernel` CLI, an agnostic
AI-governance harness (Node >= 18, CommonJS, one runtime dependency: `@clack/prompts`).
`CLAUDE.md` and `GEMINI.md` are symlinks to this file.

> **RULE #0: MANDATORY EXECUTION OVERRIDE RULE (NO EXCEPTIONS)**
> Even for a direct or urgent request ("fix this bug", "quick fix") you may not edit source code without:
> 1. **Research & root cause:** read the affected files and the failing output before editing.
> 2. **Red:** write a failing regression test first (`node:test`, under `test/`).
> 3. **Green:** make it pass with the smallest change that keeps the module boundaries (`src/` CLI,
>    `tools/` guards copied into consumer projects, `.agents/skills/clckernel_cli/` playbooks).
> 4. **Audit gate:** run `node tools/audit.js` and show its summary.
> Never declare success without running the verification commands.

## 1. The Loop (Every Task)
1. **Research** — read the code and docs involved; cite `file:line` evidence.
2. **Plan** — write `sdds/{change-name}/01-spec.md` (evidence, invariant, decisions, out of scope, TDD plan).
   `sdds/` is local and gitignored; put what reviewers need in the PR description.
3. **Test** — failing test first; record the red run in `sdds/{change-name}/02-red.md`.
4. **Implement** — make it pass.
5. **Verify & audit** — `npm test`, then `node tools/audit.js --change {change-name}` (report and receipt in
   `sdds/{change-name}/`; without `--change` nothing is written).
6. **DoD** — tests green, docs updated (README.md, README.es.md, AGENTS.md, playbooks, CHANGELOG `[Unreleased]`),
   `npm run website:build` when `website/` changed.
7. **Commit** — Conventional Commits, never AI attribution (no `Co-Authored-By` for an AI tool). The hook runs.
8. **PR** — template + Conventional Commit title.

## 2. What actually guards this repository
- **Tests:** `npm test` = `node --test test/*.test.js test/**/*.test.js`. The Python guards in `tools/*.py`
  are tested from the JS suite (they run through `python3`); there is no pytest suite.
- **Pre-commit hook** (`.githooks/pre-commit`, active with `git config core.hooksPath .githooks`), under `set -e`:
  1. `node tools/scan_secrets.js` — pattern scan of the staged files for secrets.
  2. `node tools/verify_tdd.js` — red→green: changed tests must fail against `HEAD` without the change and pass
     on the staged tree. `.clckernel.yaml` sets `tdd.code: tools/**/*.py`, so a change to a Python guard also
     needs a JS test that fails without it.
  3. `npm test` — the whole suite.
- **Audit:** `node tools/audit.js` runs every guard in `tools/` over the staged changes (or the last commit).
- **Honest claims:** `test/claims.test.js` scans READMEs, this file, the skill, the catalog, guard sources and
  the website for overstated wording. Rewrite the text, not the test.

## 3. Repository rules
- **Known hashes:** after changing anything under `tools/` or `.agents/skills/clckernel_cli/`, run
  `node scripts/build-known-hashes.js` (a test fails until `src/known-hashes.json` is rebuilt).
- **Golden snapshot:** `test/fixtures/single_stack_snapshot.json` pins what single-stack installs write
  (config, hook, AGENTS.md, tools/). Regenerate it only deliberately, check the diff is exactly the intended
  change, and note why in `test/parts_single_stack.test.js`.
- **Parity:** JS/Python twin guards (`check_custom`, `check_architecture`, `scan_secrets`, `verify_tdd`,
  `_changes`, the YAML parser) change together and are tested together.
- **No dependencies in `tools/`:** Node built-ins or the Python standard library only.
- **Agnostic:** never name consumer projects or business domains in code, tests, docs or commits.
- **Config name:** `.clckernel.yaml` in docs and messages.

## 4. Universal Command Interface (All LLMs & Agents)
When given `clckernel <action>` or `/clckernel <action>`, follow the matching playbook in
`.agents/skills/clckernel_cli/reference/`:

| Command | Lifecycle Phase | Mandatory Execution Protocol |
|---|---|---|
| `clckernel feature <name>` | New Feature | 1. Research.<br>2. Spec in `sdds/{name}/01-spec.md`.<br>3. Present it and wait for approval.<br>4. Failing test (red).<br>5. Implement (green).<br>6. `node tools/audit.js --change {name}`. |
| `clckernel fix <issue>` | Bug Fix | 1. Root cause (no edits).<br>2. Failing test (red).<br>3. Minimal fix (green).<br>4. Audit gate. |
| `clckernel test` | Verification | `npm test` and verify exit code 0. |
| `clckernel audit` | Verification | `node tools/audit.js [--change <name>]` and show the summary. |
| `clckernel doctor` | Diagnostics | `node bin/cli.js doctor .` |
| `clckernel commit <message>` | Version Control | Tests and audit green, changes within the SDD scope, Conventional Commit without AI attribution; the hook must pass (never `--no-verify`). |
| `clckernel guard create <name>` | Safeguards | Scaffold a guard in `tools/` with JS/Python parity and tests. |
| `clckernel update` | Maintenance | `node bin/cli.js update <dir> [--dry-run] [--add-guards <a,b\|all>]` against a consumer checkout. |
| `clckernel start` | Setup | Not needed here: this repository is the kernel itself. |
