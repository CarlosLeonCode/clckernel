# Contributing to CLC Kernel

Thanks for your interest in improving CLC Kernel (`clckernel`). This guide explains how to set up the
repository, what the pre-commit hook checks, and how a change goes from idea to pull request.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through
[SECURITY.md](SECURITY.md), never through public issues.

## Prerequisites

- **Node.js 18 or newer** (`engines.node` is `>=18.0.0`; CI runs 18, 20 and 22).
- **Python 3.9 or newer** with **pytest** (`python -m pip install pytest`). The JS test suite runs the Python
  guards and the Python TDD verifier, so these tests need a Python interpreter. Do not install PyYAML on
  purpose: CI runs without it to exercise the stdlib YAML fallback.
- **git**.

## Setup

```bash
git clone https://github.com/CarlosLeonCode/clc_forge.git
cd clc_forge
npm ci
git config core.hooksPath .githooks
```

The last command activates this repository's own pre-commit hook.

## What the pre-commit hook runs

[`.githooks/pre-commit`](.githooks/pre-commit) runs, under `set -e` (the first failure blocks the commit):

1. `node tools/scan_secrets.js` — pattern-based scan of the staged files for secrets.
2. `node tools/verify_tdd.js` — the red→green check: when staged JS/TS code changes, the changed test files
   must **fail** against `HEAD` without your code change (red) and **pass** against the staged tree (green). A JS/TS code
   change without a changed test fails. Test-only changes pass with a warning.
3. `npm test` — the whole suite.

So every change to JS code needs a test that fails before your change and passes after it.

**Python files under `tools/` are a gap.** They are tested from the JS suite (for example
`test/check_migrations_reversibility.test.js` runs the Python guard), but `verify_tdd.js` only treats JS/TS
files as code, so it does not prove red→green for a Python-only change. When you change a `.py` guard, run your
new test against the old code yourself (e.g. `git stash` the fix, run the test, see it fail, restore) and say
so in the pull request.

`git commit --no-verify` skips the hook; CI runs the same tests on every push and pull request, so skipped
checks still surface there.

## Workflow (SDD)

Work follows the loop described in [AGENTS.md](AGENTS.md): research, plan, test, implement, verify.

- For anything beyond a small fix, write a short spec under `sdds/<change-name>/` (for example `spec.md`)
  before coding. The `sdds/` directory is **gitignored**: specs are local working notes and are not committed.
  Put the reasoning that reviewers need in the pull request description instead.
- Write the failing test first, then make it pass.
- Keep the change scoped to what the spec describes.

## Running checks locally

| Command | What it does |
|---------|--------------|
| `npm test` | Runs every test in `test/` with `node --test`. |
| `npm run test:unit` | Runs only the adapter tests. |
| `npm run test:coverage` | Runs the suite and writes V8 coverage to `coverage/`. |
| `node tools/audit.js` | Runs the audit orchestrator over the staged changes (or the last commit when nothing is staged). CI runs it on Node 22 / Python 3.13. |
| `npm run website:dev` | Starts the documentation website (run `npm --prefix website ci` first). |

## Rules for guards

- **Parity.** Guards that exist in both JavaScript and Python (`check_custom`, `check_architecture`,
  `scan_secrets`, `verify_tdd`, `_changes`, the YAML parser) are twins: they must report the same findings for
  the same input. Change both together and test both.
- **No dependencies in `tools/`.** Files under `tools/` are copied into user projects and must run there with
  only Node.js built-ins or the Python standard library.
- **Honest claims.** `test/claims.test.js` scans the READMEs, AGENTS.md, the shipped skill, the catalog, guard
  sources and the website for overstated wording. Describe a guard by what it checks (for example
  "regex scan of staged files for …"), not by guarantees it cannot give. If that test fails, rewrite the text
  rather than the test.
- Use `.clckernel.yaml` as the config name in docs and messages.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/): `fix(scope): …`, `feat(scope): …`,
  `docs: …`, `test: …`, `refactor: …`, `ci: …`, `chore: …`. Mark breaking changes with `!` and a
  `BREAKING CHANGE:` footer.
- Do not add AI attribution lines (such as `Co-Authored-By` for an AI tool) to commits.
- Keep each commit a reviewable unit: the test and the code it covers go together.

## Pull requests

1. Open an issue first for larger changes, so the approach can be agreed before you invest time.
2. Fork the repository and create a branch from `main`.
3. Make your change with tests; update README.md, README.es.md and AGENTS.md when behavior or wording changes,
   and add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
4. Open a pull request using the template and a Conventional Commit title.
5. CI must be green before merge.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pushes to `main` and on pull requests. The
matrix covers Node 18, 20 and 22 with Python 3.9 and 3.13 (pytest installed, PyYAML deliberately absent). Each
job runs `npm ci` and `npm test`; the Node 22 / Python 3.13 job also runs `node tools/audit.js`.

## Known limitations

- **Windows is not tested.** CI runs on Linux (ubuntu-latest); the generated hooks and this repository's
  hook are bash/sh scripts, so on Windows they need Git Bash. Report Windows problems as issues.
- The limitations users see (lint-staged/ESLint and `tools/`, Rust inline unit tests, external tools that
  run only when available) are listed in [README → Known limitations](README.md#known-limitations); keep that
  list current when a change adds or removes one.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
