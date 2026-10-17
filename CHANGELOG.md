# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Added

- `tools/verify_tdd.py` now runs the changed tests with pytest and requires them to fail on the base tree and
  pass on the staged tree; it is installed for FastAPI and Django.
- `tools/verify_tdd.js`, its twin for vitest, jest and node:test, installed for Next.js, Astro and Agent-OS.
- `tools/_changes.js` / `tools/_changes.py`: guards read the staged snapshot (or `HEAD` when nothing is staged)
  instead of the working copy.
- `clckernel audit [dir]` runs every installed audit orchestrator.
- `tools/.clckernel-managed.json` registry, so guards and both TDD verifiers skip the harness's own files and
  the first commit after an install passes the real hook.
- `scan_secrets` detects Stripe `sk_`/`rk_` live and test keys.
- CI on Node 18/20/22 and Python 3.9/3.13 (without PyYAML), plus a shared YAML conformance suite and
  regression tests for documentation claims and repository hygiene.

### Changed

- Generated hooks run under `set -e` without `|| true`; audit orchestrators report a crashing guard as
  FAILED.
- Hooks run each stack's external tools (ruff, pytest, rubocop, rspec, phpstan, golangci-lint, go test, cargo)
  when available and print "not available, skipped" otherwise; Rails, Go, Laravel and Rust run the secret scan.
- Choosing another stack in the prompt selects a real adapter instead of only changing the project type.
- The CLI refuses missing targets and reserved words as directories, sets `core.hooksPath` only at the
  repository root when unset or already `.githooks`, and `doctor` exits 1 when a check fails.
- `scan_secrets` redacts detected secrets in its output.
- Documentation, the website and generated `AGENTS.md` describe guards by what they check and drop claims the
  code does not support.

### Fixed

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

[Unreleased]: https://github.com/CarlosLeonCode/clc_forge/compare/v1.2.19...HEAD
[1.2.19]: https://github.com/CarlosLeonCode/clc_forge/releases/tag/v1.2.19
