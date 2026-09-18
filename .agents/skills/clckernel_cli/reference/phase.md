# Playbook: Execution Phases Management

Use this playbook when adding, modifying, or removing lifecycle phases in the AIUP governance pipeline (via `/clc add_phase`, `/clc remove_phase`, or conversational request like *"agregá una fase de smoke test antes del commit"*).

## Guidelines

1. **Understand Phase Purpose:**
   - Pre-implementation (e.g. Research, SDD spec, RFC alignment)
   - Implementation (e.g. TDD Red/Green, Layer Check)
   - Verification / Audit (e.g. AST Audit, E2E, Smoke test)
   - Delivery (e.g. Git pre-commit, PR generation)

2. **Update `.clckernel.yaml`:**
   - Preserve execution order and dependencies.
   - Specify whether the phase is blocking (`required: true`) or advisory (`required: false`).

3. **Confirm & Validate:**
   - Present the updated pipeline flow to the user.
