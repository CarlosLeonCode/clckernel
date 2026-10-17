# Security Policy

## Supported versions

Only the latest major version receives security fixes.

| Version | Supported |
|---------|-----------|
| 1.x     | Yes (until the next major release) |
| < 1.0   | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub's private vulnerability reporting:
<https://github.com/CarlosLeonCode/clc_forge/security/advisories/new>

Please include:

- the clckernel version, Node.js / Python versions and operating system;
- the affected component (a guard in `tools/`, hook generation, the CLI, an adapter);
- steps or a minimal repository that reproduces the issue;
- what an attacker could achieve, as you understand it;
- any suggested fix, if you have one.

Never include real secrets in a report — use placeholders.

## What to expect

This is a small, maintainer-run project, so responses are **best effort**. The maintainer will try to
acknowledge your report, keep you informed while it is investigated, and credit you in the advisory and
CHANGELOG.md when the fix ships (unless you prefer to stay anonymous). Please give the maintainer reasonable
time to release a fix before disclosing publicly.

## Scope

In scope:

- the guards and helpers under `tools/` (for example, a guard that executes or leaks content from the
  files it inspects, or a secret scanner that prints the secret it found);
- pre-commit hook generation and `core.hooksPath` handling;
- every file clckernel writes into a user's project (`install` and `update`), including symlinks and the
  managed-files registry;
- the CLI itself (`bin/`, `src/`).

Out of scope: the website under `website/` beyond its build dependencies, and vulnerabilities in third-party
tools the generated hooks call when available (ruff, pytest, vitest, golangci-lint and others) — please report
those upstream.

## Guards are not a security boundary

The guards are heuristics: most are pattern-based, and a few parse Python with the standard `ast` module.
They can miss problems and can report false positives. The pre-commit hook can be skipped with
`git commit --no-verify`, so treat it as an early warning and keep CI, code review and dedicated security
tooling as your actual controls. A guard failing to detect something is a bug worth reporting, but it is
not by itself a vulnerability in clckernel.
