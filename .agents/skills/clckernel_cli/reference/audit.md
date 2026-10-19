# Playbook: Mandatory Educational Audit Gate

Use this playbook when auditing code quality, architecture compliance, or executing the mandatory audit gate (via `/clc audit`, `/clckernel audit`, or conversational request like *"corré la auditoría del kernel"*).

## Execution

1. **Locate Audit Tool:** `npx clckernel audit [dir] [--change <name>]` runs every installed orchestrator for you. Or check the available audit scripts:
   - `node tools/audit.js` (JavaScript / Node environment)
   - `python tools/audit.py` (Python / Backend environment)
2. **Execute Audit:** Run the tool within the project workspace. CLI (both scripts):
   `audit.(js|py) [targetDir] [--change <name>] [--staged]`.
   - Working on an SDD change (`sdds/<name>/`): pass `--change <name>`. Only then are the report
     (`05-audit-report.md`) and the receipt (`audit-receipt.json`) written, in `sdds/<name>/`.
     On a mixed stack (both `tools/audit.js` and `tools/audit.py` installed) each orchestrator
     writes its own pair: `05-audit-report.js.md` + `audit-receipt.js.json` and
     `05-audit-report.py.md` + `audit-receipt.py.json`. Read both.
   - Without `--change` nothing is written: read the summary from stdout.
   - `--staged` is the default snapshot (staged changes, or the last commit when nothing is staged).
   - An unknown flag exits 2 with the usage line: fix the command, do not report it as a guard failure.
3. **Educational Summary:** Output the educational audit summary highlighting:
   - Architectural conformance (layer-boundary guards)
   - TDD compliance & test coverage
   - Security & Secrets scan results
   - Performance / DB efficiency checks
4. **Actionable Feedback:** If any guard fails, explain the exact violation, why it breaches architectural invariants, and how to remediate it.
5. **Warnings:** A guard marked `WARN` / ⚠️ (level `warning`, from the guard or `severities` in `.clckernel.yaml`) failed but does not block: the verdict is `PASSED_WITH_WARNINGS`. Report it and propose the fix; do not hide it. A guard that crashed always blocks.
