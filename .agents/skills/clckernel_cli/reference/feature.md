# 🚀 Playbook: \`clckernel feature <name>\`

Guide the developer through implementing a new feature strictly governed by the **AI Unified Process (AIUP)**.

## Mandatory Execution Protocol

### Step 1: Research & Impact Analysis
1. Inspect the codebase, existing modules, and architecture layers before writing any code.
2. Determine affected architectural layers (Domain, Use Cases, Infrastructure, Presentation).

### Step 2: Local SDD Specification
1. Create a local specification file at \`sdds/{name}/spec.md\` (or \`sdds/{name}/01-spec.md\`).
2. Document:
   - Feature purpose and user requirements.
   - API / Domain contracts and interfaces.
   - Affected files and strict layer boundaries.
   - Planned test scenarios (unit, integration, edge cases).

### Step 3: Human-in-the-Loop (HIT) Review Gate
1. Present the proposed SDD spec, contracts, and test scenarios directly to the user in chat.
2. **STOP.** Explicitly ask for developer confirmation:
   > *"Review the proposed contracts and test scenarios above. Shall we proceed to the Red TDD phase?"*
3. Wait for the user's approval before touching any production source files.

### Step 4: TDD Red Phase (Failing Test)
1. Write a failing regression or unit test demonstrating the new feature requirement.
2. Run the test suite and verify it fails with a non-zero exit code.
3. Confirm that the failure message proves the feature is missing or non-functional.

### Step 5: Clean Implementation (Green Phase)
1. Implement the minimal clean code necessary to make the failing test pass.
2. Maintain strict Clean Architecture boundaries (Domain -> Use Case -> Infrastructure).
3. Re-run tests to confirm 100% green pass.

### Step 6: Mandatory AST Audit Gate
1. Execute \`node tools/audit.js\` or \`python tools/audit.py\`.
2. Output the Educational Summary table to stdout.
3. Verify zero secrets, zero layer violations, and zero N+1 queries.
