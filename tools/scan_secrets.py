#!/usr/bin/env python3
"""
Secrets & API Key Scanner
Detects hardcoded secrets, API keys, tokens, and private keys in changed files.
Self-contained: uses only Python stdlib (re, pathlib, subprocess, json).
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import sys

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402

# One finding per matching line: {lineNo, col, label, snippet}; the snippet is redacted.
PATTERNS: list[tuple[str, str]] = [
    (r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", "Private Key"),
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key"),
    (
        r"(?:api[_-]?key|apikey|secret[_-]?key|api[_-]?secret)\s*[=:]\s*['\"]"
        r"[A-Za-z0-9_\-]{16,}['\"]",
        "API Key",
    ),
    (
        r"(?:password|passwd|pwd)\s*[=:]\s*['\"][^'\"]{6,}['\"]",
        "Hardcoded Password",
    ),
    (
        r"(?:secret|token|auth[_-]?token|bearer)\s*[=:]\s*['\"]"
        r"[A-Za-z0-9_\-\.]{16,}['\"]",
        "Secret/Token",
    ),
    (r"ghp_[A-Za-z0-9]{36}", "GitHub Personal Access Token"),
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI API Key"),
    (r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}", "Stripe API Key"),
    (r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "JWT Token"),
    (
        r"(?:SUPABASE|NEXT_PUBLIC|VITE)_\w*_KEY\s*=\s*['\"][^'\"]{8,}['\"]",
        "Framework Secret Key",
    ),
]

SKIP_EXTENSIONS = frozenset(
    {
        ".png", ".jpg", ".gif", ".svg", ".ico",
        ".woff", ".woff2", ".ttf", ".lock",
        ".min.js", ".min.css",
    }
)


def _compile_patterns() -> list[tuple[re.Pattern, str]]:
    """Compile all secret-detection patterns once."""
    return [(re.compile(p), label) for p, label in PATTERNS]


REDACTED = "\u2026[REDACTED]"


def _redact(line: str, compiled: list[tuple[re.Pattern, str]]) -> str:
    """
    The line with every secret match (of any pattern) cut to its first 4
    characters plus a marker, stripped and capped at 120 characters. The full
    matched value never leaves the guard.
    """
    out = line
    for regex, _label in compiled:
        out = regex.sub(lambda m: m.group(0)[:4] + REDACTED, out)
    return out.strip()[:120]


def check(target_dir: str | None = None) -> dict:
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

    compiled = _compile_patterns()
    findings: dict[str, list[dict]] = {}

    for filepath in files:
        ext = pathlib.Path(filepath).suffix
        if ext in SKIP_EXTENSIONS:
            continue

        content = _changes.read_file(dir_path, filepath, mode)
        if content is None:
            continue

        file_hits: list[dict] = []
        for line_no, line in enumerate(content.splitlines(), start=1):
            for regex, label in compiled:
                m = regex.search(line)
                if m:
                    file_hits.append({
                        "lineNo": line_no,
                        "col": m.start(),
                        "label": label,
                        "snippet": _redact(line, compiled),
                    })
                    break  # one finding per line

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
