#!/usr/bin/env python3
"""
Docker Guard
Checks for Docker security issues in changed Dockerfile and docker-compose files.
Self-contained: uses only Python stdlib (pathlib, subprocess, json, sys, re).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def _get_changed_dockerfiles(target_dir: str) -> list[str] | None:
    """Return list of changed Docker-related files from git diff, or None on failure."""
    # Staged changes first (what is being committed); HEAD~1 only when nothing is staged.
    for ref in ("--cached", "HEAD~1"):
        try:
            args = ["git", "diff", "--name-only", "--diff-filter=ACMR", ref]
            out = subprocess.check_output(
                args, cwd=target_dir,
                stderr=subprocess.DEVNULL, text=True,
            )
            files = [
                f.strip() for f in out.splitlines()
                if f.strip().endswith(('Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'))
                or 'Dockerfile' in f
                or 'docker-compose' in f
            ]
            if files or (ref == "--cached" and out.strip()):
                return files
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    return None


def _read_file_content(full_path: Path) -> str | None:
    """Read file content safely, return None on failure."""
    try:
        return full_path.read_text(encoding="utf-8", errors="replace")
    except (OSError, PermissionError):
        return None


def _check_dockerfile(content: str, filepath: str) -> list[dict]:
    """Check a Dockerfile for security issues."""
    violations: list[dict] = []
    lines = content.splitlines()

    has_user = False
    user_is_root = False
    has_healthcheck = False
    env_secrets: list[tuple[int, str]] = []

    secret_patterns = [
        re.compile(r'^\s*ENV\s+(AWS_SECRET_ACCESS_KEY|DB_PASSWORD|SECRET_KEY|PASSWORD|TOKEN|API_KEY)\s*=', re.IGNORECASE),
        re.compile(r'^\s*ENV\s+\w*SECRET\w*\s*=', re.IGNORECASE),
        re.compile(r'^\s*ENV\s+\w*PASSWORD\w*\s*=', re.IGNORECASE),
    ]

    for lineno, line in enumerate(lines, start=1):
        stripped = line.strip()

        # Check USER directive
        if stripped.startswith('USER '):
            has_user = True
            user_val = stripped[5:].split()[0] if len(stripped) > 5 else ''
            if user_val.lower() in ('root', '0', 'root:x:0:0'):
                user_is_root = True

        # Check for HEALTHCHECK
        if stripped.startswith('HEALTHCHECK '):
            has_healthcheck = True

        # Check for ENV secrets
        for pattern in secret_patterns:
            if pattern.match(stripped):
                env_secrets.append((lineno, stripped))

    if not has_user:
        violations.append({
            "file": filepath,
            "lineNo": 0,
            "issue": "missing_user",
            "snippet": "No USER directive found - container runs as root",
        })
    elif user_is_root:
        violations.append({
            "file": filepath,
            "lineNo": 0,
            "issue": "user_is_root",
            "snippet": "USER directive runs as root - use non-root user",
        })

    for lineno, snippet in env_secrets:
        violations.append({
            "file": filepath,
            "lineNo": lineno,
            "issue": "env_secret",
            "snippet": snippet[:120],
        })

    if not has_healthcheck:
        violations.append({
            "file": filepath,
            "lineNo": 0,
            "issue": "missing_healthcheck",
            "snippet": "No HEALTHCHECK directive found",
        })

    return violations


def _check_docker_compose(content: str, filepath: str) -> list[dict]:
    """Check a docker-compose file for security issues."""
    violations: list[dict] = []

    # Look for hardcoded secrets in environment variables
    secret_patterns = [
        re.compile(r'^\s*-\s+(AWS_SECRET_ACCESS_KEY|DB_PASSWORD|SECRET_KEY|PASSWORD|TOKEN|API_KEY)\s*=\s*["\']', re.IGNORECASE),
        re.compile(r'^\s*-\s+\w*SECRET\w*\s*=\s*["\']', re.IGNORECASE),
        re.compile(r'^\s*-\s+\w*PASSWORD\w*\s*=\s*["\']', re.IGNORECASE),
    ]

    privilege_pattern = re.compile(r'^\s*privileged:\s*true', re.IGNORECASE)

    lines = content.splitlines()
    for lineno, line in enumerate(lines, start=1):
        for pattern in secret_patterns:
            if pattern.match(line):
                violations.append({
                    "file": filepath,
                    "lineNo": lineno,
                    "issue": "compose_env_secret",
                    "snippet": line.strip()[:120],
                })

        if privilege_pattern.match(line.strip()):
            violations.append({
                "file": filepath,
                "lineNo": lineno,
                "issue": "privileged_container",
                "snippet": line.strip(),
            })

    return violations


def check(target_dir: str | None = None) -> dict:
    """
    Scan changed Docker files for security issues.

    Returns:
        dict with keys: exit_code, skipped, name, data
    """
    dir_path = target_dir or os.getcwd()

    files = _get_changed_dockerfiles(dir_path)
    if files is None:
        return {
            "exit_code": 0, "skipped": True, "name": "docker_guard",
            "data": {"findings": [], "message": "No git diff available"},
        }

    if not files:
        return {
            "exit_code": 0, "skipped": False, "name": "docker_guard",
            "data": {"findings": [], "message": "No changed Docker files to scan"},
        }

    all_violations: list[dict] = []

    for filepath in files:
        full_path = Path(dir_path) / filepath
        if not full_path.exists():
            continue

        content = _read_file_content(full_path)
        if content is None:
            continue

        if 'docker-compose' in filepath:
            all_violations.extend(_check_docker_compose(content, filepath))
        else:
            all_violations.extend(_check_dockerfile(content, filepath))

    total = len(all_violations)
    if total:
        msg = f"{total} Docker violation(s) found"
    else:
        msg = "No Docker violations found"

    return {
        "exit_code": 1 if total else 0,
        "skipped": False,
        "name": "docker_guard",
        "data": {"findings": all_violations, "message": msg},
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
