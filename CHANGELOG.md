# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `check_a11y` reads each JSX tag whole: attributes on later lines (an `aria-label`, an `alt`, an
  `onKeyDown`) are seen, hidden inputs are skipped, inputs labelled through `htmlFor`/`for` or wrapped by a
  `<label>` pass, spread props are not reported, and components named `Input`/`Img` are no longer treated
  as native elements.
- `npx clckernel` no longer prints the `clc-forge` deprecation notice. The legacy `clc-forge` and
  `create-clc-forge` binaries now point to `bin/deprecated.js`, so npx runs the bin named like the package
  instead of the first (alphabetically sorted) one.

## [2.0.0] - 2026-10-26

### ⚠ BREAKING CHANGES

- **Strict YAML subset for `.clckernel.yaml`.** `check_custom` (JS and Python) now parses a documented YAML
  subset and fails closed: a config that relied on lenient parsing, or that contains invalid rules or invalid
  regexes, now fails the pre-commit hook instead of being silently skipped.
- **Frontend hook location.** On Next.js and Astro projects the pre-commit hook is written to `.husky/` only
  when Husky is active; otherwise it goes to `.githooks/` with `core.hooksPath`. Re-running `update` may move
  your hook.
- **Legacy `clc-forge` artifacts.** Installs no longer create the `clc_forge_cli` skill, the
  `clc_forge_context.mdc` Cursor rule or `.clc-forge.resolved.json`, and `clckernel update` removes them when
  they are provably harness-generated (it reports anything it keeps).
- **`check_hitl` requires an explicit marker.** A changed skill or playbook must contain a `HITL:` line or a
  `## Human checkpoint` / `## HITL` section; words such as "review" or "confirm" no longer pass. The guard now
  also covers `playbooks/` and evaluates the files changed in the commit. Existing Agent-OS repositories may
  start failing when they touch a skill or playbook without a marker.
- **Domain guards leave the kernel.** `check_domain_data` and `check_test_calendar_sync` are no longer shipped
  or installed, and Agent-OS detection no longer reacts to the `marketing-os` / `laila-mos` names or a
  "marketing operating system" description (`agent-os` and `ai-agents` still work). `clckernel update` leaves
  copies installed by earlier releases exactly where they are in `tools/` (never moves or deletes them), takes
  them out of the registry and reports them as retired kernel guards, so they keep running as project guards.
- **The pre-commit hook and `clckernel audit` run the same guards (sdds/unified-discovery).** The generated hook
  no longer lists one line per guard plus a `tools/guards/` loop: it calls `node tools/audit.js --hook` and
  `python3 tools/audit.py --hook` (each when installed; with neither the commit fails), then the external tools.
  The orchestrators discover every guard — kernel guards and project guards, both `tools/guards/*` and
  unmanaged `check_*` / `scan_*` / `verify_*` / `*_guard` files at the top of `tools/` — and run each exactly
  once (`.js` via `audit.js`, `.py` via `audit.py`; a lone orchestrator runs both languages). A project guard
  placed at the top of `tools/`, previously run only by `clckernel audit`, now also blocks commits. A guard the
  registry lists but that is missing on disk now fails the hook and the audit. `--hook` writes no report or
  receipt and prints one line per guard. Re-run `clckernel update` to get the new hook.
- **Retired kernel guards stay in place.** A guard in the registry that the current kernel no longer ships is
  kept where it is (no move to `tools/guards/`, which broke guards that `require` a sibling such as
  `./_changes`), leaves the registry, and `update` reports it as "retired kernel guard kept as project guard".
  `updateHarness()` returns `retiredGuards` instead of `guardMigration`.
- **`.clckernel.yaml` is read by install, update and the guards; keys without an effect are gone
  (sdds/config-foundation).** `active_guards`, `phases`, `gate_mode`, `layers` and `scope` never
  changed anything: they now print a deprecation warning and are ignored (`severities` got a real effect in
  sdds/audit-cli, below). The config-driven metadata path (`.clckernel.resolved.json`, `CLCKERNEL_SEVERITIES`) is
  removed. An invalid value now stops install, update and every guard with
  `Invalid .clckernel.yaml: key "<key>" — <reason>`.
- **The audit writes a report only when told where (sdds/audit-cli).** `node tools/audit.js`,
  `python3 tools/audit.py` and `clckernel audit` used to write `05-audit-report.md` and `audit-receipt.json`
  into a guessed folder (the first directory under `sdds/`, or `sdds/audit-run/`), i.e. into an unrelated spec.
  Now a plain run only prints the summary; `--change <name>` (also `clckernel audit [dir] --change <name>`)
  writes both files to `sdds/<name>/`, creating that folder only then. `<name>` must be one path segment.
  The orchestrators take `[targetDir] [--hook] [--change <name>] [--staged]`; any other flag, a second
  positional or `--hook` with `--change` exits 2 with the usage (unknown flags used to be ignored). The Python
  orchestrator now resolves `sdds/` against the target directory, like the JS one. Agents that need the report
  must pass `--change <sdd name>`: re-run `clckernel update` to get the AGENTS.md and playbook wording.

### Added

- **Onboarding after install (sdds/onboarding).** A real install ends with a "Next steps" block true to that
  install: commit the harness (or the exact command that activates the hook when it is not active), the AI
  harnesses whose mirrors were written, `clckernel start`, `npx clckernel audit`, `tools/guards/` and
  `npx clckernel update --dry-run`. An update prints a short one only when protected `*.clckernel-new` files or
  available guards need attention. Every generated AGENTS.md gains a "First session after install" section, and
  the skill triggers on it: the user's request comes first; otherwise the agent explains what is installed, asks
  one question (run the `start` playbook or keep the defaults) and stops.
- **Red→Green TDD verification for Go, Rust, Ruby and PHP (sdds/tdd-other-stacks).** `tools/verify_tdd.js`
  gains language profiles (`go test`, `cargo test --test`, RSpec / Minitest through bundler, Pest / PHPUnit),
  grouped by the nearest `go.mod` / `Cargo.toml` / `Gemfile` / `composer.json`, and is installed for the Go,
  Rust, Rails and Laravel stacks: their commits now fail when production code changes without a test that
  fails on `HEAD` and passes on the staged code. A missing toolchain fails closed with an install hint. Rust
  unit tests inside `src/` cannot be separated for the red run: a `src/` change needs an integration test.
- **Wider secret coverage in `scan_secrets` (sdds/secret-patterns).** New labels: `Anthropic API Key`,
  `OpenAI Project Key` (project, service-account and admin keys), `Google API Key`, `Slack Token`, `GitHub Token`
  (OAuth, user, server and refresh prefixes) and `GitHub Fine-Grained PAT`. `Quoted Key Secret` flags a quoted
  JSON/YAML key (`"api_key": "…"`) whose value holds a letter and a digit. `Dotenv Secret` flags a committed
  `.env`, `.env.*` or `*.env` file (unquoted values included) when a secret-looking variable has a real value;
  `.env.example`, `.env.sample` and `.env.template` are left alone. Both generic rules skip placeholders (`${VAR}`,
  `<…>`, `changeme`, `your-…`, `xxx`, one repeated character, …). Existing labels are unchanged. The pure matcher
  is exported as `findSecrets(text, filename)` (JS) and `find_secrets(text, filename)` (Python).

- **Non-blocking warnings in the audit and the pre-commit hook (sdds/audit-cli).** A guard result may carry
  `level: 'warning'`, and `.clckernel.yaml` `severities: { <guard name>: warning | error }` sets it per guard
  (overriding the guard; values are validated — the key is no longer deprecated). A failing guard at `warning`
  prints `WARN`, does not change the exit code, and is listed separately in the report and in the receipt's
  `warnings`; the verdict is `PASSED_WITH_WARNINGS` when only warnings failed. A guard that crashes (throws,
  returns no result, cannot run, or is missing) always blocks, whatever its severity. `--staged` is accepted as
  an explicit name for the default snapshot (staged changes, else the last commit).

- **Configuration keys with a real effect (sdds/config-foundation).** `exclude_paths` (paths no diff-based guard
  evaluates), `mirrors.list` / `mirrors.required` (mirrors install creates and `check_symlinks` verifies),
  `hitl.markers` / `hitl.paths` / `hitl.optOut` (`check_hitl`), `update.exclude` (paths install/update never
  write; reported as *excluded by config*) and `tdd.code` / `tdd.ignore` (what `verify_tdd.js/.py` count as
  production code, e.g. Python tools tested by JS tests). Defaults keep the earlier behaviour. One schema in
  `tools/_config.js` and its twin `tools/_config.py` (the Python YAML fallback parser moved to `tools/_yaml.py`),
  installed next to `_changes.js/.py`. README "Configuration" lists every key.

- **Safe `update` and `--dry-run` (sdds/safe-update).** `clckernel update` and a reinstall with `--yes` never
  overwrite a kernel file (`tools/*`, the pre-commit hook, the `clckernel_cli` skill) they cannot prove is
  theirs and intact: a locally edited file, or a project file that only shares a kernel file's name, is kept
  and the new version is written as `<file>.clckernel-new` (added to the consumer `.gitignore`). An older
  intact install without hashes still updates silently: `src/known-hashes.json` holds the sha256 of every
  version the kernel published (built from the git history by `scripts/build-known-hashes.js`).
  `--dry-run` (`clckernel update [dir] --dry-run`, `clckernel [dir] --yes --dry-run`) prints the plan and
  writes nothing — no files, directories, `.gitignore` or `git config`.

- **Full-stack and monorepo support.** The detector finds code parts at the root, in declared workspaces
  (`package.json#workspaces`, `pnpm-workspace.yaml`) and in conventional directories (`frontend`, `backend`,
  `web`, `api`, `server`, `client`, `apps/*`, `services/*`, `packages/*`). Several parts install the union of
  their guards once, run each part's external tools inside its directory, list the parts in AGENTS.md and in
  the install summary, and `update` re-detects them. `verify_tdd.py` and `verify_tdd.js` group the changed
  files by their nearest project root and verify red→green per group; code changed in a part without a test
  in that part fails. A repository with a single part at its root is installed exactly as before.
- `tools/verify_tdd.py` now runs the changed tests with pytest and requires them to fail on the base tree and
  pass on the staged tree; it is installed for FastAPI and Django.
- `tools/verify_tdd.js`, its twin for vitest, jest and node:test, installed for Next.js, Astro and Agent-OS.
- `tools/_changes.js` / `tools/_changes.py`: guards read the staged snapshot (or `HEAD` when nothing is staged)
  instead of the working copy.
- `clckernel audit [dir]` runs every installed audit orchestrator.
- `tools/.clckernel-managed.json` registry, so guards and both TDD verifiers skip the harness's own files and
  the first commit after an install passes the real hook.
- `scan_secrets` detects Stripe `sk_`/`rk_` live and test keys.
- Generic Agent-OS detection: `SKILL.md` in `skills/<name>/`, `.agents/skills/<name>/` or
  `.claude/skills/<name>/`, or a `playbooks/` / `rules/` folder with Markdown (the `package.json` keywords
  still work). The harness's own skill is ignored, and a code stack in the same repository wins.
- Agent-OS guards `check_skills` (SKILL.md frontmatter: `name`, `description`, unique names),
  `check_links` (relative Markdown links resolve in the commit) and `check_placeholders` (forgotten draft
  markers outside `templates/`); `check_custom` is now installed for Agent-OS.
- `listFiles` / `list_files` in `tools/_changes.*`: every file of the snapshot being verified.
- **Project guards run.** Every generated pre-commit hook ends with a generic block that runs each
  `tools/guards/*.js` with `node` and `tools/guards/*.py` with `python3` (alphabetical, after the kernel guards;
  no-op without `tools/guards/`), and `audit.js` / `audit.py` report them. A non-zero exit blocks; the standard
  JSON result is used when printed. Guards can import the snapshot helpers (`require('../_changes')`).
- Agent-OS guard `check_data_files`: every changed `.json` file must parse (snapshot content, any folder).
- CI on Node 18/20/22 and Python 3.9/3.13 (without PyYAML), plus a shared YAML conformance suite and
  regression tests for documentation claims and repository hygiene.

### Changed

- **Mixed stacks keep both audit reports (sdds/residual-fixes).** When `tools/audit.js` and `tools/audit.py`
  are both installed, `--change <name>` makes each orchestrator write its own pair:
  `05-audit-report.js.md` + `audit-receipt.js.json` and `05-audit-report.py.md` + `audit-receipt.py.json`
  (before, `clckernel audit --change` ran both and the second overwrote the first). Single-orchestrator
  projects keep `05-audit-report.md` and `audit-receipt.json`.
- **`update` never adds what the project did not choose.** It refreshes only the guards the project has (in
  the registry or present in `tools/`) and runs only those in the hook; the stack's other guards are listed
  as *available, not installed* and opted in with the new `clckernel update --add-guards <name,...|all>`
  (an unknown name exits 1 without writing). It no longer recreates IDE mirrors the project deleted (*not
  present (skipped)*), and neither install nor update adds a `.gitignore` entry for a path git tracks
  (*tracked, not ignored*). `--dry-run` shows the three new sections. A part added to a monorepo gets its
  external tools on update; its guards are offered as available.
- **The kernel skill obeys `check_hitl`.** `check_hitl` no longer exempts `clckernel_cli` (it also reads
  registry-listed files, via the new `includeManaged` option of `_changes.js`); the skill gains a
  `## Human checkpoint` section: approval before code after a spec, before committing, before destructive
  steps, and no publishing without an explicit request. The retired `clc_forge_cli` and vendored plugin
  skills (`impeccable`) stay exempt.
- **Hashed registry.** `tools/.clckernel-managed.json` is now `{ "kernelVersion", "files": [{ "path",
  "sha256" }] }` and also covers the hook and the skill; `_changes.js`/`_changes.py` read both this and the
  older list format, and `update` migrates it. Protected files are left out of it.
- **Every install/update write goes through `src/io.js`**, one write point that applies the ownership rule and
  records the plan. The `update` summary now lists written, unchanged, protected, moved, removed, `.gitignore`
  and `git config` changes, and exits 0 with a visible warning when files were protected. `update` rejects
  unknown flags.
- **Old domain guards are moved only when intact.** A locally modified `tools/check_domain_data.js` or
  `tools/check_test_calendar_sync.js` stays in `tools/` with a warning instead of being moved.

- Generated hooks run under `set -e` without `|| true`; audit orchestrators report a crashing guard as
  FAILED.
- Hooks run each stack's external tools (ruff, pytest, rubocop, rspec, phpstan, golangci-lint, go test, cargo)
  when available and print "not available, skipped" otherwise; Rails, Go, Laravel and Rust run the secret scan.
- Choosing another stack in the prompt selects a real adapter instead of only changing the project type.
- Agent-OS: the kernel installs only guards that hold for any Agent-OS (domain rules belong in the project's
  `tools/guards/`); `check_symlinks` also fails a rule mirror that does not point to `AGENTS.md` (symlink or
  identical copy); the generated `AGENTS.md` describes only the folders the repository has, and its Clean
  Creation State rule is domain-neutral (a field without a real value stays empty or `null`).
- The CLI refuses missing targets and reserved words as directories, sets `core.hooksPath` only at the
  repository root when unset or already `.githooks`, and `doctor` exits 1 when a check fails.
- `scan_secrets` redacts detected secrets in its output.
- Documentation, the website and generated `AGENTS.md` describe guards by what they check and drop claims the
  code does not support.

### Fixed

- A fresh install no longer adds `.agents/skills/clc_forge_cli/`, `.clckernel.resolved.json` or
  `.clc-forge.resolved.json` to `.gitignore`; each is added only when that artifact exists in the project.
- `check_scope.py` reads paths that start with a dot (`.agents/...`, `.clckernel.yaml`,
  `.github/workflows/ci.yml`; extension-less dotfiles such as `` `.gitignore` `` in backticks) and no longer
  truncates table cells (`| src/foo.js |` was read as `oo.js`) (sdds/final-sweep).
- Docs and website describe the real hook (`.githooks/pre-commit` calling `tools/audit.js --hook` /
  `tools/audit.py --hook`, `.husky/pre-commit` only when Husky already runs the hooks), the real install
  command (`npx clckernel` / `npx clckernel . --yes`; `start` is an agent command) and only real
  `.clckernel.yaml` keys. The AGENTS.md command tables and the playbooks name the CLI options (`--change`,
  `--dry-run`, `--add-guards`) and no longer say `start` materializes `.clckernel.yaml`; the READMEs gained
  a "Known limitations" section (sdds/final-sweep).
- Install/update decide from the repository's own (`--local`) `core.hooksPath`: a global or system value
  (a user-wide hooks dir) no longer blocks setting `.githooks` nor makes a frontend project look like Husky.
  The local value is set and a note says a global `core.hooksPath` is configured (sdds/residual-fixes).
- `check_architecture.py` decides Django vs Clean Architecture per changed file, from its nearest project root
  (`manage.py`, `pyproject.toml`, `setup.cfg`, `requirements*.txt`), so a Django app in `backend/` or
  `apps/api/` gets the Django rules and a FastAPI part next to it keeps the layer rules (sdds/residual-fixes).
- `verify_tdd`: a file native to one verifier that matches `tdd.code` is handed to the other-language verifier
  when both are installed (`.py` to `verify_tdd.js`, JS/TS to `verify_tdd.py`), so "Python tools tested by JS
  tests" no longer fails `verify_tdd.py` for lack of a pytest test. With one verifier nothing changes
  (sdds/residual-fixes).
- Website: no "100% Verified Code" claim; the file-tree hook example is the generated `.githooks/pre-commit`
  (`audit.js --hook` / `audit.py --hook`, then external tools; `.husky/` only when Husky is active)
  (sdds/residual-fixes).
- `scan_secrets.py` matches the assignment rules case-insensitively, as the JS guard always did, and splits
  lines the same way, so both report identical findings.
- `check_custom`: Python glob translation, JS/Python glob parity and an infinite loop on empty regex matches.
- `check_architecture`: classifies layers by path segment and checks every imported name, including relative
  imports.
- `check_migrations`: compares upgrade and downgrade to check that destructive upgrades are reversed.
- `check_db_efficiency`: flags only ORM-like calls inside loops, not `dict.get` or `requests.get`.
- `postgres_guard`: detects unsafe SQL passed to `execute()`.
- `check_ui_reuse`: skips test files and harness-owned `tools/` sources.
- `check_test_calendar_sync` reports drift instead of writing files from the hook (`--fix` keeps the old
  behavior).
- Technology guards are run by the generated hook and discovered by `audit`.
- `update` prints success lines with a defined color.

### Deprecated

- The `clc-forge` and `create-clc-forge` binaries print a deprecation notice and will be removed in the next
  major release; use `clckernel`.
- `.clc-forge.yml` / `.clc-forge.yaml` still load with a warning; rename them to `.clckernel.yaml`.

### Upgrade notes

- Run `clckernel update` in each existing project to refresh guards, the hook and the managed-files registry,
  then review any `.clckernel.yaml` that now fails to parse.
- After pulling this repository on another machine, regenerate the local IDE mirrors (they are no longer
  tracked) with `clckernel update`.

## [1.2.19]

- Previous release.

[Unreleased]: https://github.com/CarlosLeonCode/clc_forge/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/CarlosLeonCode/clc_forge/compare/v1.2.19...v2.0.0
[1.2.19]: https://github.com/CarlosLeonCode/clc_forge/releases/tag/v1.2.19
