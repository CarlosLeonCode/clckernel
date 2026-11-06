# Playbook: Update / Upgrade CLC Kernel

Use this playbook when the user wants to update an existing project to the latest version of CLC Kernel (via `/clc update`, `clckernel update`, `npx clckernel update`, or conversational request like *"actualizar clckernel en el proyecto"*).

## Invariants: The Non-Destructive Update Contract

1. **NEVER DELETE OR OVERWRITE `sdds/`:** All local specifications (`sdds/*/spec.md`, `plan.md`) must stay 100% intact.
2. **NEVER TOUCH PROJECT GUARDS:** Scripts under `tools/guards/` and unmanaged guard files at the top of `tools/` are preserved without alteration. A kernel guard the new release no longer ships stays where it is and keeps running as a project guard; nothing is moved or deleted.
3. **NEVER OVERWRITE CONFIGURATION:** Existing `.clckernel.yaml` settings (or a config under an older name) remain intact.
4. **NEVER OVERWRITE EDITED KERNEL FILES:** A kernel file the project edited is kept; the new version is written next to it as `<file>.clckernel-new`. The same holds for the kernel-owned sections of `AGENTS.md` (*Parts*, *Core AI Safeguards*): an edited section keeps `AGENTS.md` as it is, and the refreshed file is written as `AGENTS.md.clckernel-new` for the user to merge.
5. **NEVER MODIFY APPLICATION CODE:** Source files, domain layers, and application tests are never touched.

## Update Sequence

### Phase 1: Inspection & Plan
1. Verify the project is already governed by checking for `AGENTS.md`, `tools/.clckernel-managed.json`, `.githooks/pre-commit` or `.husky/pre-commit`.
2. Run `npx clckernel update [dir] --dry-run --json`. Nothing is written. stdout is one JSON object (`contract: clckernel.update-plan/v1`): `plan` (written, kept, excluded by `update.exclude`), `kernelVersion` (`installed`, `current`), `whatsNew`, `warnings` and `nextSteps`. When `success` is `false`, show `error` and stop. (`npx clckernel update [dir] --dry-run` prints the same plan as text.)
3. Show the plan. Then, for each `whatsNew` entry (a guard released after `kernelVersion.installed`):
   - explain what it does (`checks`);
   - say whether it blocks commits (`blocking`, the catalog default; the project's `severities` can change it);
   - check the project against `adopt` (does it have the files or dependencies the guard reads?) and say what you found;
   - recommend adopting it or not, and why. An entry with `installed: true` is already in the project: only report it.

   `whatsNew` is empty when the project already runs the current version or its registry has no `kernelVersion`.
4. **STOP.** Wait for the user's approval of the plan and of each new guard to adopt.

### Phase 2: Run the Update
1. Run `npx clckernel update [dir]`, with `--add-guards <a,b>` naming only the new guards the user approved in Phase 1 (e.g. `npx clckernel update . --add-guards check_sql_migrations`). It refreshes, in one pass:
   - the kernel tools the project already has in `tools/` (`audit.js` / `audit.py`, guards, helpers) — update never adds a guard the project did not choose;
   - the skill and playbooks in `.agents/skills/clckernel_cli/`;
   - the IDE mirrors that link to `AGENTS.md`;
   - the pre-commit hook, which calls `node tools/audit.js --hook` and/or `python3 tools/audit.py --hook` (every kernel and project guard, once) and then the stack's external tools when they are available.
2. To install additional guards, add `--add-guards <a,b|all>` (e.g. `npx clckernel update . --add-guards check_skills`), only with the user's approval.
3. Never copy or edit kernel files by hand to "refresh" them.

### Phase 3: Verification & Reporting
1. Run `npx clckernel audit` (or `node tools/audit.js` / `python3 tools/audit.py`) to verify harness health.
2. Output a transparent Educational Summary highlighting:
   - What was updated (core tools, hook, playbooks, symlinks)
   - What was preserved (SDDs, project guards, edited files kept with a `.clckernel-new` copy, YAML configuration)
