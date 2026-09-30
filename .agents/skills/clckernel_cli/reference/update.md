# Playbook: Update / Upgrade CLC Kernel

Use this playbook when the user wants to update an existing project to the latest version of CLC Kernel (via `/clc update`, `clckernel update`, `npx clckernel update`, or conversational request like *"actualizar clckernel en el proyecto"*).

## Invariants: The Non-Destructive Update Contract

1. **NEVER DELETE OR OVERWRITE `sdds/`:** All local specifications (`sdds/*/spec.md`, `plan.md`) must stay 100% intact.
2. **NEVER TOUCH CUSTOM GUARDS:** Any user-defined scripts under `tools/guards/` are preserved without alteration.
3. **NEVER OVERWRITE CONFIGURATION:** Existing `.clckernel.yaml` or `.clc-forge.yaml` settings and custom thresholds remain intact.
4. **NEVER MODIFY APPLICATION CODE:** Source files, domain layers, and application tests are never touched.

## Update Sequence

### Phase 1: Inspection & Detection
1. Verify the project is already governed by checking for `AGENTS.md`, `.clckernel.yaml`, `.husky/pre-commit`, or `.githooks/pre-commit`.
2. Inspect the active framework and test runner.

### Phase 2: Refresh Core Infrastructure
1. Refresh bundled AST audit tools in `tools/`:
   - `tools/audit.js` / `tools/audit.py`
   - Built-in guards (`scan_secrets.js`, `check_responsive.js`, `check_seo.js`, `check_db_efficiency.py`, `check_custom.js`, `docker_guard.py`, etc.)
2. Refresh Agent Skills & Playbooks:
   - Synchronize `.agents/skills/clckernel_cli/` with latest playbooks and references.
3. Refresh Cross-IDE Rule Symlinks:
   - Ensure `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, and `.antigravity/rules.md` link to `AGENTS.md`.
4. Refresh Pre-commit Hook:
   - Ensure the git pre-commit hook runs the latest standard guards while preserving any custom checks.

### Phase 3: Verification & Reporting
1. Run `node tools/audit.js` or `python tools/audit.py` to verify harness health.
2. Output a transparent Educational Summary highlighting:
   - What was updated (core tools, playbooks, symlinks)
   - What was preserved (SDDs, custom guards, YAML configuration)
