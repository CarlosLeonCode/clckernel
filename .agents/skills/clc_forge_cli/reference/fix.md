# 🔧 Playbook: \`clckernel fix <issue>\`

Enforce deterministic bug fixing without quick-fix shortcuts or superficial patches.

## Mandatory Execution Protocol

### Step 1: Root Cause & Traceback Analysis
1. Analyze the issue description, error logs, and stack trace.
2. Inspect the relevant files and surrounding architecture to pinpoint the exact failure mechanism.
3. **DO NOT** edit source code directly to "try things out".

### Step 2: TDD Red Phase (Regression Test)
1. Write a focused test that reproduces the bug demonstrably.
2. Run the test and verify it fails with the exact error described.
3. Log the failure output as proof of regression reproduction.

### Step 3: Surgical Clean Architecture Fix (Green Phase)
1. Apply the minimal surgical change addressing the root cause.
2. Respect layer isolation: do not bypass Domain or Use Case rules for convenience.
3. Run the regression test and confirm it passes in green.

### Step 4: Mandatory Audit Gate
1. Execute \`node tools/audit.js\` or \`python tools/audit.py\`.
2. Output the Educational Summary table to verify no side effects or guard violations occurred.
