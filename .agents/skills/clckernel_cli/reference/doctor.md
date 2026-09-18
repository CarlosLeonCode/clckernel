# Playbook: Kernel Doctor & Diagnostics

Use this playbook to diagnose environment health, detect hook drift, or verify configuration integrity (via `/clc doctor`, `/clckernel doctor`, or conversational request like *"revisá el estado del kernel"*).

## Checks

1. **Config Integrity:** Validate `.clckernel.yaml` syntax and presence of required sections (`framework`, `language`, `project_type`, `safeguards`).
2. **Hook Parity:** Check that git hooks (`.githooks/pre-commit` or `.husky/pre-commit`) are installed and executable (`chmod +x`).
3. **Tools & Guards Health:** Verify that scripts referenced in `.clckernel.yaml` exist in `tools/` and run without syntax errors.
4. **Drift Remediation:** If drift is detected, offer automatic fix or report clear steps.
