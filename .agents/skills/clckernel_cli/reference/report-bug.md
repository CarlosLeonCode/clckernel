# Playbook: `clckernel report-bug <summary>`

Use this playbook when the bug you found is in **CLC Kernel itself** (a kernel guard, the pre-commit hook, the
audit orchestrators, the `clckernel` CLI or this skill), not in the project's code. Also use it when `fix`
traces a root cause to a kernel-owned file.

The fix belongs in the kernel repository, where every project gets it with the next release. A patch made
inside this project diverges: the next `clckernel update` keeps the edited file and writes the new kernel
version next to it as `<file>.clckernel-new`, so the fix never reaches anyone else.

## Step 1: Decide whether it is a kernel bug

It is a kernel bug only when **both** hold:

1. **The failing file is kernel-owned:** it is listed in `tools/.clckernel-managed.json` (the registry of
   files the kernel installed), or it is the generated pre-commit hook (`.githooks/pre-commit`, or
   `.husky/pre-commit` when Husky runs the hooks), a file under `.agents/skills/clckernel_cli/`, or the output
   of the `npx clckernel` CLI.
2. **The behavior contradicts the kernel's documentation:** the README, the guard's own header comment or
   AGENTS.md says it should do something else (a false positive on valid code, a crash, a wrong exit code, a
   check that never runs).

It is **not** a kernel bug when the failing file is a project guard (`tools/guards/`, or an unmanaged
`check_*`/`scan_*`/`verify_*` file at the top of `tools/`), when the project's `.clckernel.yaml` causes it,
or when the guard is right and the code is wrong. In those cases use the `fix` playbook
([fix.md](fix.md)) instead.

## Step 2: Do not patch the kernel file; offer a temporary workaround

**Never patch a kernel-owned file in this project**, even for a one-line fix. Instead, offer the smallest
workaround the kernel supports in `.clckernel.yaml`, and say that it is temporary:

| Workaround | When | Example |
|---|---|---|
| `severities` | A guard fails on valid code | `severities: { check_a11y: warning }` (the guard still reports, but does not block the commit) |
| `exclude_paths` | One path triggers the bug | `exclude_paths: ["path/to/affected/**"]` (no diff-based guard evaluates it) |
| `update.exclude` | You must keep a local file the kernel would overwrite | `update: { exclude: ["path/to/file"] }` |
| `tdd.ignore` | The TDD verifier misclassifies a file as production code | `tdd: { ignore: ["path/to/file"] }` |

Apply the workaround only after the user approves it, and record in the report how to remove it: delete the
entry after updating to the release that contains the fix (`npx clckernel update`).

## Step 3: Build the bug report

Collect, without editing anything:

- **Kernel version:** the output of `npx clckernel --version` and `kernelVersion` in
  `tools/.clckernel-managed.json`.
- **Where:** the guard or file and the line that misbehaves.
- **Minimal reproduction:** the smallest snippet and steps that trigger the bug. Strip all project code,
  secrets, names and data; use generic placeholders (`ExampleComponent`, `src/example.ts`).
- **Expected behavior** (with the documentation that says so) **vs actual behavior.**
- **Guard output:** the exact message or exit code (redact paths and names that identify the project).
- **Workaround** applied, if any, and how to remove it.

Before writing the report, check whether it is already known: search the existing issues at
https://github.com/CarlosLeonCode/clc_forge/issues. The repository and issues URLs come from the kernel's
`package.json` (`npm view clckernel repository.url bugs.url`); if that command is unavailable, use the URLs in
this playbook.

## Step 4: Explain the contribution path

Tell the user, in plain steps, how to fix it upstream. Anyone can do it with their own AI agent (Claude Code,
Antigravity, Cursor, Copilot, Gemini or any other agent that reads `AGENTS.md`):

1. **Fork** https://github.com/CarlosLeonCode/clc_forge on GitHub.
2. **Clone the fork:** `git clone https://github.com/<your-user>/clc_forge.git && cd clc_forge`.
3. **Create a branch:** `git checkout -b fix/<short-name>`.
4. **Open the fork with your AI agent** and give it the bug report. The kernel repository's own `AGENTS.md`
   makes the agent write a failing test first (red), then the fix (green); its pre-commit hook checks that the
   changed tests fail without the fix and pass with it.
5. **Push the branch** and **open a pull request** against `main` using the repository's pull request
   template and a Conventional Commit title (`fix(<guard>): ...`).

If the user does not want to fix it, the alternative is to **open an issue** with the report, using the
bug report form (`bug_report`) at https://github.com/CarlosLeonCode/clc_forge/issues/new/choose.

## Human checkpoint

Forking, pushing, opening an issue and opening a pull request are outward-facing. Prepare everything (the
report text, the commands, the workaround) and show it to the user; then STOP and wait for their
explicit approval. Never fork, push, open an issue or open a pull request on your own, and never change
`.clckernel.yaml` without approval.
