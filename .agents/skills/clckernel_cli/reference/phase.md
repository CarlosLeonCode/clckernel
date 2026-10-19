# Playbook: Execution Phases Management

Use this playbook when adding, modifying, or removing lifecycle phases in the AIUP governance pipeline (via `/clc add_phase`, `/clc remove_phase`, or conversational request like *"agregá una fase de smoke test antes del commit"*).

## Guidelines

1. **Understand Phase Purpose:**
   - Pre-implementation (e.g. Research, SDD spec, RFC alignment)
   - Implementation (e.g. TDD Red/Green, Layer Check)
   - Verification / Audit (e.g. Guard Audit, E2E, Smoke test)
   - Delivery (e.g. Git pre-commit, PR generation)

2. **Update `AGENTS.md`:**
   - Phases are agent instructions: record the new order in the Loop section of `AGENTS.md`, never in
     `.clckernel.yaml` (its `phases` key is deprecated and has no effect).
   - Preserve execution order and dependencies.
   - Say whether the phase is blocking or advisory; a blocking check belongs in a guard under
     `tools/guards/`, which the pre-commit hook runs.

3. **Confirm & Validate:**
   - Present the updated pipeline flow to the user.
