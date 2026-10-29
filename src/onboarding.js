/**
 * CLC Kernel — First-session onboarding (sdds/onboarding).
 * The AGENTS.md section every generated template ends with: what the agent
 * does in the first session after an install, without ever blocking the
 * user's own request.
 */

const FIRST_SESSION_SECTION = `## First session after install
Applies while \`tools/.clckernel-managed.json\` exists and \`.clckernel.yaml\` does not (the harness was just installed with its defaults):
1. **The user's request comes first.** If the user asked for a task, do it under the rules above, then mention onboarding once, in one sentence, at the end.
2. **Otherwise, orient briefly.** Read \`tools/.clckernel-managed.json\` (the guards and files the kernel installed) and the pre-commit hook (\`.githooks/pre-commit\`, or \`.husky/pre-commit\` when Husky runs the hooks), and explain in a few lines what runs on every commit.
3. **Ask ONE question:** tailor the rules now with the \`start\` playbook (\`.agents/skills/clckernel_cli/reference/start.md\`), or keep the defaults. Keeping the defaults writes a \`.clckernel.yaml\` that holds only a comment, so this question is not asked again. Then STOP and wait for the answer (Human checkpoint).
`;

/**
 * sdds/kernel-bug-protocol: what the agent does when the root cause is in
 * CLC Kernel itself. Every generated AGENTS.md carries it (single-stack
 * templates have no command table, so the section names the command).
 */
const KERNEL_BUG_SECTION = `## If the bug is in CLC Kernel
When the root cause is in a kernel-owned file (listed in \`tools/.clckernel-managed.json\`, the generated pre-commit hook, \`.agents/skills/clckernel_cli/\` or the \`clckernel\` CLI) and contradicts the kernel's documentation, run \`clckernel report-bug <summary>\` (\`.agents/skills/clckernel_cli/reference/report-bug.md\`):
1. **Never patch a kernel-owned file in this project:** \`clckernel update\` would keep the edit and the fix would never reach the kernel.
2. Offer a temporary workaround in \`.clckernel.yaml\` (\`severities\`, \`exclude_paths\`, \`update.exclude\`, \`tdd.ignore\`).
3. Prepare a bug report (version, minimal reproduction without project code, expected vs actual) and explain how to fix it upstream: fork the kernel repository and open a pull request with your own AI agent, or open an issue. Never fork, push or open an issue or pull request without the user's explicit approval.
`;

module.exports = { FIRST_SESSION_SECTION, KERNEL_BUG_SECTION };
