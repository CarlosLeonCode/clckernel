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
import sys

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402


def _is_docker_file(path: str) -> bool:
    """True for Dockerfile and docker-compose paths."""
    return (
        path.endswith(('Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'))
        or 'Dockerfile' in path
        or 'docker-compose' in path
    )


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

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(dir_path)
    mode, files = changes["mode"], [f for f in changes["files"] if _is_docker_file(f)]
    if mode is None:
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
        content = _changes.read_file(dir_path, filepath, mode)
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
