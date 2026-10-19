#!/usr/bin/env python3
"""
Secrets & API Key Scanner
Detects hardcoded secrets, API keys, tokens, and private keys in changed files.
Self-contained: uses only Python stdlib (re, pathlib, subprocess, json).

Rules (sdds/secret-patterns) are tried in order; the first match labels the
line (one finding per line). They mirror RULES in scan_secrets.js exactly,
same regex sources and flags. The two generic rules skip placeholder values
(see _is_placeholder):
  - Quoted Key Secret: a quoted JSON/YAML key ending in a secret word, with a
    quoted value of 8+ non-space characters holding a letter and a digit;
  - Dotenv Secret: in `.env`, `.env.*` and `*.env` files (not `.env.example`,
    `.env.sample`, `.env.template`), `NAME=value` where a `_` segment of NAME
    is a secret word and the value is not numeric-only or a boolean/null word.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import sys
from typing import Callable, List, NamedTuple, Optional

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402

SECRET_KEY_WORDS = (
    r"api[_-]?key|apikey|secret[_-]?key|api[_-]?secret|client[_-]?secret|secret|"
    r"access[_-]?token|auth[_-]?token|refresh[_-]?token|token|password|passwd|private[_-]?key"
)
DOTENV_SECRET_NAME = re.compile(
    r"(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PASS|CREDENTIALS?|DSN|PRIVATE)(?:_|$)",
    re.IGNORECASE,
)
PLACEHOLDER_WORDS = (
    "xxx", "your", "changeme", "change_me", "change-me", "placeholder", "example",
    "dummy", "replace", "insert", "redacted", "fake", "sample", "todo", "...", "***",
)
NON_SECRET_WORDS = ("true", "false", "yes", "no", "on", "off", "null", "none")
TEMPLATE_SEGMENTS = ("example", "sample", "template")


def _is_placeholder(value: str) -> bool:
    """True for values that are obviously not a real secret."""
    v = value.lower()
    if v.startswith("$") or "${" in v or "$(" in v or "{{" in v:
        return True
    if "<" in v and ">" in v:
        return True
    if re.match(r"^(.)\1*$", v):
        return True
    return any(w in v for w in PLACEHOLDER_WORDS)


def _dotenv_value(raw: str) -> str:
    """The value of a dotenv assignment: quotes removed, or an unquoted value without its ` #` comment."""
    quoted = re.match(r"^([\"'])([^\n]*?)\1", raw)
    if quoted:
        return quoted.group(2)
    comment = re.search(r"\s#", raw)
    return (raw if comment is None else raw[: comment.start()]).strip()


def _is_dotenv_file(filename: str) -> bool:
    """`.env`, `.env.<suffix>` or `<name>.env`, unless a dot segment marks it as a template."""
    base = os.path.basename(filename or "")
    if not (base == ".env" or base.startswith(".env.") or (base.endswith(".env") and len(base) > 4)):
        return False
    return not any(seg in TEMPLATE_SEGMENTS for seg in base.lower().split("."))


def _accept_quoted(m: re.Match) -> bool:
    value = m.group(3)
    return bool(re.search(r"[A-Za-z]", value)) and bool(re.search(r"[0-9]", value)) and not _is_placeholder(value)


def _accept_dotenv(m: re.Match) -> bool:
    if not DOTENV_SECRET_NAME.search(m.group(1)):
        return False
    value = _dotenv_value(m.group(2).strip())
    if not value or re.match(r"^[0-9]+$", value) or value.lower() in NON_SECRET_WORDS:
        return False
    return not _is_placeholder(value)


class Rule(NamedTuple):
    regex: "re.Pattern[str]"
    label: str
    accept: Optional[Callable[[re.Match], bool]] = None
    dotenv_only: bool = False


def _rule(source: str, label: str, ignore_case: bool = False, **kw) -> Rule:
    return Rule(re.compile(source, re.IGNORECASE if ignore_case else 0), label, **kw)


# One finding per matching line: {lineNo, col, label, snippet}; the snippet is redacted.
RULES: List[Rule] = [
    _rule(r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", "Private Key"),
    _rule(r"AKIA[0-9A-Z]{16}", "AWS Access Key"),
    _rule(
        r"(?:api[_-]?key|apikey|secret[_-]?key|api[_-]?secret)\s*[=:]\s*['\"][A-Za-z0-9_\-]{16,}['\"]",
        "API Key", ignore_case=True,
    ),
    _rule(r"(?:password|passwd|pwd)\s*[=:]\s*['\"][^'\"]{6,}['\"]", "Hardcoded Password", ignore_case=True),
    _rule(
        r"(?:secret|token|auth[_-]?token|bearer)\s*[=:]\s*['\"][A-Za-z0-9_\-\.]{16,}['\"]",
        "Secret/Token", ignore_case=True,
    ),
    _rule(r"ghp_[A-Za-z0-9]{36}", "GitHub Personal Access Token"),
    _rule(r"sk-[A-Za-z0-9]{20,}", "OpenAI API Key"),
    _rule(r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}", "Stripe API Key"),
    _rule(r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "JWT Token"),
    _rule(
        r"(?:SUPABASE|NEXT_PUBLIC|VITE)_\w*_KEY\s*=\s*['\"][^'\"]{8,}['\"]",
        "Framework Secret Key", ignore_case=True,
    ),
    _rule(r"sk-ant-[A-Za-z0-9_-]{20,}", "Anthropic API Key"),
    _rule(r"sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}", "OpenAI Project Key"),
    _rule(r"AIza[0-9A-Za-z_-]{35}", "Google API Key"),
    _rule(r"xox[abprs]-[0-9]+-[0-9A-Za-z-]{8,}", "Slack Token"),
    _rule(r"gh[ousr]_[A-Za-z0-9]{36}", "GitHub Token"),
    _rule(r"github_pat_[A-Za-z0-9_]{40,}", "GitHub Fine-Grained PAT"),
    _rule(
        r"([\"'])[A-Za-z0-9_.-]*(?:" + SECRET_KEY_WORDS + r")\1\s*:\s*([\"'])([^\"'\s]{8,})\2",
        "Quoted Key Secret", ignore_case=True, accept=_accept_quoted,
    ),
    _rule(
        r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]*)$",
        "Dotenv Secret", accept=_accept_dotenv, dotenv_only=True,
    ),
]

SKIP_EXTENSIONS = frozenset(
    {
        ".png", ".jpg", ".gif", ".svg", ".ico",
        ".woff", ".woff2", ".ttf", ".lock",
        ".min.js", ".min.css",
    }
)

REDACTED = "…[REDACTED]"


def _redact(line: str, rules: List[Rule]) -> str:
    """
    The line with every match of every applicable rule cut to its first 4
    characters plus a marker, stripped and capped at 120 characters. Filters
    are ignored here: over-redaction is safe. The full matched value never
    leaves the guard.
    """
    out = line
    for rule in rules:
        out = rule.regex.sub(lambda m: m.group(0)[:4] + REDACTED, out)
    return out.strip()[:120]


def find_secrets(text: str, filename: str) -> List[dict]:
    """Pure matcher: the findings for `text` as the content of `filename` (repo-relative path)."""
    dotenv = _is_dotenv_file(filename)
    rules = [r for r in RULES if dotenv or not r.dotenv_only]
    findings: List[dict] = []
    # Split on "\n" only, like the JS guard, so line numbers and snippets match.
    for line_no, line in enumerate(str(text).split("\n"), start=1):
        for rule in rules:
            m = rule.regex.search(line)
            if m and (rule.accept is None or rule.accept(m)):
                findings.append({
                    "lineNo": line_no,
                    "col": m.start(),
                    "label": rule.label,
                    "snippet": _redact(line, rules),
                })
                break  # one finding per line
    return findings


def check(target_dir: Optional[str] = None) -> dict:
    """
    Scan changed files for secrets and API keys.

    Returns:
        dict with keys: exit_code, skipped, name, data
        data.findings maps filepath -> list of {lineNo, col, label, snippet}
    """
    dir_path = target_dir or os.getcwd()

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(dir_path)
    mode, files = changes["mode"], changes["files"]
    if mode is None:
        return {
            "exit_code": 0, "skipped": True, "name": "scan_secrets",
            "data": {"findings": {}, "message": "No git diff available"},
        }

    if not files:
        return {
            "exit_code": 0, "skipped": False, "name": "scan_secrets",
            "data": {"findings": {}, "message": "No changed files to scan"},
        }

    findings: dict = {}

    for filepath in files:
        ext = pathlib.Path(filepath).suffix
        if ext in SKIP_EXTENSIONS:
            continue

        content = _changes.read_file(dir_path, filepath, mode)
        if content is None:
            continue

        file_hits = find_secrets(content, filepath)
        if file_hits:
            findings[filepath] = file_hits

    total = sum(len(v) for v in findings.values())
    if total:
        msg = (
            f"{total} potential secret(s) found in "
            f"{len(findings)} file(s)"
        )
    else:
        msg = "No secrets detected"

    return {
        "exit_code": 1 if total else 0,
        "skipped": False,
        "name": "scan_secrets",
        "data": {"findings": findings, "message": msg},
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
