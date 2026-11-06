# 🔧 Playbook: \`clckernel fix <issue>\`

Enforce deterministic bug fixing without quick-fix shortcuts or superficial patches.

## Mandatory Execution Protocol

### Step 1: Root Cause & Traceback Analysis
1. Analyze the issue description, error logs, and stack trace.
2. Inspect the relevant files and surrounding architecture to pinpoint the exact failure mechanism.
3. **DO NOT** edit source code directly to "try things out".
4. If `docs/Journal/` has entries (`docs/Journal/<YYYY>/<timestamp>-<change>.md`), list the folder of the current year and read the entries that touch the affected area: they record why it is the way it is.
5. If the root cause is in a kernel-owned file (listed in `tools/.clckernel-managed.json`, the generated hook, `.agents/skills/clckernel_cli/` or the `clckernel` CLI), stop here and switch to [report-bug.md](report-bug.md): never patch kernel files in the project.

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

### Step 5: Journal Entry
1. If the fix was audited as an SDD change (`audit --change <issue>`) and `tools/check_journal.js` is installed, run `npx clckernel journal <issue>` and fill in the entry from the SDD: Context, Decision, Alternatives, Consequences, short, with no secrets, no local paths and no links to `sdds/`.
2. Stage the entry with the fix: it goes in the same commit (see commit.md).
