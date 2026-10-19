# Playbook: Kernel Doctor & Diagnostics

Use this playbook to diagnose environment health, detect hook drift, or verify configuration integrity (via `/clc doctor`, `/clckernel doctor`, or conversational request like *"revisá el estado del kernel"*).

## Checks

Start with `npx clckernel doctor [dir]`: it checks `AGENTS.md`, `sdds/`, `docs/Journal/`, `tools/`, the pre-commit hook, that each `tools/check_*` guard loads (JS) or parses (Python), and the orchestrators' imports. Then:

1. **Config Integrity:** When `.clckernel.yaml` exists, check its keys against the README "Configuration" table (`rules`, `exclude_paths`, `mirrors`, `hitl`, `update`, `tdd`, `severities`); report any invalid value or deprecated key the guards warn about.
2. **Hook Parity:** Check that the hook git runs (`.githooks/pre-commit` with `core.hooksPath=.githooks`, or `.husky/pre-commit` when Husky owns `core.hooksPath`) is executable and calls `node tools/audit.js --hook` and/or `python3 tools/audit.py --hook`.
3. **Tools & Guards Health:** Run `npx clckernel audit`: it runs every guard the hook runs (kernel guards and project guards in `tools/guards/`).
4. **Drift Remediation:** If drift is detected, offer automatic fix or report clear steps.
