# 📦 Playbook: \`clckernel commit <message>\`

Safely commit changes after verifying all pre-flight quality and architecture gates.

## Mandatory Execution Protocol

### Step 1: Pre-Flight AST Audit
1. Run \`node tools/audit.js\` or \`python tools/audit.py\`.
2. Ensure 100% of discovered guards pass with 0 errors and 0 secret leaks.

### Step 2: Scope Verification
1. Compare \`git diff --cached\` (or unstaged diff) against the active SDD spec in \`sdds/{change}/\`.
2. Verify that no files outside the agreed feature scope are staged.

### Step 3: Conventional Commit Formatting
1. Format commit message according to Conventional Commits:
   - \`feat(...): ...\`
   - \`fix(...): ...\`
   - \`refactor(...): ...\`
   - \`test(...): ...\`
   - \`docs(...): ...\`
2. **STRICT LAW:** NEVER add "Co-Authored-By", AI signatures, or AI attribution.
3. Stage required files and commit cleanly.
