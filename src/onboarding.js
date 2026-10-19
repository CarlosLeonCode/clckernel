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

module.exports = { FIRST_SESSION_SECTION };
