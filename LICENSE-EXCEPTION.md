# CLC Kernel Installed Files Exception

## Summary (not legal advice; the exception text governs)

- CLC Kernel itself (the CLI, its source and this repository) is licensed under the GNU AGPL v3 only.
- The files CLC Kernel installs into your project are yours to use, change and ship as part of that project,
  under your project's own license. Using them does not put your project under the AGPL.
- This does not let you take those files out of a project and distribute them as a separate governance tool
  or competing product; that remains under the AGPL.

## Exception text

Version 1.0. Copyright (C) 2025-2026 CarlosLeonCode.

This is an additional permission under section 7 of the GNU Affero General Public License, version 3
("AGPL"), granted by the copyright holder of CLC Kernel. It applies to CLC Kernel when this notice is
distributed with it.

### 1. Definitions

"CLC Kernel" means the program distributed under the AGPL by CarlosLeonCode as `clckernel`, including its
command-line interface, its source code under `src/` and `bin/`, its website and the repository as
distributed.

"Project" means a software repository or directory into which the CLC Kernel installer or updater has
written files.

"Installed Files" means the files that the CLC Kernel installer or updater writes into a Project, whether
copied verbatim or later modified by the Project, namely:

a. the contents it places under the Project's `tools/` directory (guards, helpers, audit orchestrators and
   the managed-files registry);
b. the generated git hook files (`.githooks/pre-commit` or `.husky/pre-commit`);
c. the generated `.clckernel.yaml` configuration file;
d. the generated `AGENTS.md` and its IDE mirror files (such as `CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
   `.windsurfrules`, `.cursor/rules/clckernel_context.mdc` and `.github/copilot-instructions.md`); and
e. the files it writes under `.agents/skills/clckernel_cli/`.

### 2. Permission

As an additional permission under section 7 of the AGPL, you may use, copy, modify and distribute Installed
Files as part of the Project into which they were installed, and as part of works derived from that
Project, under terms of your choice, without the requirements of the AGPL. In particular, the Installed Files
create no obligation to license the Project, or any part of it, under the AGPL, and no obligation under
section 13 of the AGPL (remote network interaction) arises from the Installed Files.

### 3. Limits

This exception does not apply to:

a. CLC Kernel itself: its command-line interface, its source under `src/` and `bin/`, its website and the
   repository as distributed, which remain under the AGPL only;
b. distributing the Installed Files, alone or in a collection, as a standalone governance tool, harness or
   competing product, separately from a Project in which they serve that Project; or
c. any copy of CLC Kernel from which this exception notice has been removed by the person redistributing
   it.

This exception grants no trademark rights. The names and logo are covered by [TRADEMARKS.md](TRADEMARKS.md).

### 4. Modified versions

If you modify CLC Kernel, you may extend this exception to your version of it, but you are not obliged to
do so. If you do not wish to do so, delete this exception statement from your version.
