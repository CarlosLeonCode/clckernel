# Playbook: Kernel Doctor & Diagnostics

Use this playbook to diagnose environment health, detect hook drift, or verify configuration integrity (via `/clc doctor`, `/clckernel doctor`, or conversational request like *"revisá el estado del kernel"*).

## Checks

1. **Config Integrity:** When `.clckernel.yaml` exists, check its keys against the README "Configuration" table (`rules`, `exclude_paths`, `mirrors`, `hitl`, `update`, `tdd`); report any invalid value or deprecated key the guards warn about.
2. **Hook Parity:** Check that git hooks (`.githooks/pre-commit` or `.husky/pre-commit`) are installed and executable (`chmod +x`).
3. **Tools & Guards Health:** Verify that the guards the pre-commit hook runs exist in `tools/` and run without syntax errors.
4. **Drift Remediation:** If drift is detected, offer automatic fix or report clear steps.
