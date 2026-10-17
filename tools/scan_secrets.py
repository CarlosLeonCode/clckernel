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
import subprocess
import sys

# One finding per matching line: (line_no, label, matched_snippet)
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
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI/Stripe API Key"),
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


def _get_changed_files(target_dir: str) -> list[str] | None:
    """Return list of changed files from git diff, or None on failure."""
    # Staged changes first (what is being committed); HEAD~1 only when nothing is staged.
    for ref in ("--cached", "HEAD~1"):
        try:
            args = ["git", "diff", "--name-only", "--diff-filter=ACMR", ref]
            out = subprocess.check_output(
                args, cwd=target_dir,
                stderr=subprocess.DEVNULL, text=True,
            )
            files = [f.strip() for f in out.splitlines() if f.strip()]
            if files or (ref == "--cached" and out.strip()):
                return files
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    return None


def _compile_patterns() -> list[tuple[re.Pattern, str]]:
    """Compile all secret-detection patterns once."""
    return [(re.compile(p), label) for p, label in PATTERNS]


def check(target_dir: str | None = None) -> dict:
    """
    Scan changed files for secrets and API keys.

    Returns:
        dict with keys: exit_code, skipped, name, data
        data.findings maps filepath -> list of {lineNo, label, snippet}
    """
    dir_path = target_dir or os.getcwd()

    files = _get_changed_files(dir_path)
    if files is None:
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

        full_path = pathlib.Path(dir_path) / filepath
        if not full_path.exists():
            continue

        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, PermissionError):
            continue

        file_hits: list[dict] = []
        for line_no, line in enumerate(content.splitlines(), start=1):
            for regex, label in compiled:
                m = regex.search(line)
                if m:
                    file_hits.append({
                        "lineNo": line_no,
                        "label": label,
                        "snippet": line.strip()[:120],
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
