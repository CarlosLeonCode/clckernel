# Playbook: Mandatory Educational Audit Gate

Use this playbook when auditing code quality, architecture compliance, or executing the mandatory audit gate (via `/clc audit`, `/clckernel audit`, or conversational request like *"corré la auditoría del kernel"*).

## Execution

1. **Locate Audit Tool:** Check available audit scripts:
   - `node tools/audit.js` (JavaScript / Node environment)
   - `python tools/audit.py` (Python / Backend environment)
2. **Execute Audit:** Run the tool within project workspace.
3. **Educational Summary:** Output the educational audit summary highlighting:
   - AST Architectural conformance
   - TDD compliance & test coverage
   - Security & Secrets scan results
   - Performance / DB efficiency checks
4. **Actionable Feedback:** If any guard fails, explain the exact violation, why it breaches architectural invariants, and how to remediate it.
