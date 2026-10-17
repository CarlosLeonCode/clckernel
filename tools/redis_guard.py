#!/usr/bin/env python3
"""
Redis Guard
Checks for Redis configuration security issues in changed Python files.
Self-contained: uses only Python stdlib (ast, pathlib, subprocess, json, sys).
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path


def _get_changed_files(target_dir: str) -> list[str] | None:
    """Return list of changed Python files from git diff, or None on failure."""
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
                if f.strip().endswith('.py')
            ]
            if files or (ref == "--cached" and out.strip()):
                return files
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    return None


class RedisVisitor(ast.NodeVisitor):
    """AST visitor that detects Redis configuration security issues."""

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.violations: list[dict] = []

    def _add_violation(self, lineno: int, issue: str, snippet: str):
        self.violations.append({
            "file": self.filepath,
            "lineNo": lineno,
            "issue": issue,
            "snippet": snippet[:120],
        })

    def _is_redis_url(self, node: ast.expr) -> bool:
        """Check if expression looks like a redis:// URL."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            val = node.value.lower()
            return 'redis://' in val or 'rediss://' in val
        return False

    def _has_password_check(self, keywords: list[ast.keyword]) -> bool:
        """Check if password or auth is provided in Redis connection keywords."""
        for kw in keywords:
            if kw.arg in ('password', 'secret', 'ssl_password'):
                if isinstance(kw.value, ast.Constant) and kw.value.value:
                    return True
                # Check for str() wrapper which might hide empty password
                if isinstance(kw.value, ast.Call):
                    return False  # Treat wrapped values as potentially missing
        return False

    def visit_Call(self, node: ast.Call):
        # Check for Redis() or redis.Redis() instantiation
        is_redis_call = False
        if isinstance(node.func, ast.Name) and node.func.id == 'Redis':
            is_redis_call = True
        elif isinstance(node.func, ast.Attribute) and node.func.attr == 'Redis':
            is_redis_call = True

        if is_redis_call:
            has_decode = False
            has_timeout = False
            has_password = self._has_password_check(node.keywords)
            has_hardcoded_url = False

            for keyword in node.keywords:
                if keyword.arg == 'decode_responses':
                    if isinstance(keyword.value, ast.Constant) and keyword.value.value is True:
                        has_decode = True
                elif keyword.arg == 'socket_connect_timeout':
                    has_timeout = True
                elif keyword.arg == 'host' and not has_password:
                    # Host without password on decode_responses is risky
                    pass
                elif keyword.arg in ('url', 'connection_pool'):
                    # url or connection_pool might contain credentials
                    pass

            # Check positional args for decode_responses
            if node.args:
                # First positional arg could be host or url
                if len(node.args) >= 1:
                    arg = node.args[0]
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        if self._is_redis_url(arg):
                            has_hardcoded_url = True

            # decode_responses=True without password is a security risk
            if has_decode and not has_password:
                self._add_violation(
                    node.lineno or 0,
                    "decode_responses_without_password",
                    "Redis decode_responses=True without password authentication"
                )

            # Missing socket_connect_timeout
            if not has_timeout:
                self._add_violation(
                    node.lineno or 0,
                    "missing_socket_connect_timeout",
                    "Redis connection missing socket_connect_timeout"
                )

            # Hardcoded Redis URL
            if has_hardcoded_url:
                self._add_violation(
                    node.lineno or 0,
                    "hardcoded_redis_url",
                    "Hardcoded redis:// URL in Redis() call"
                )

        self.generic_visit(node)


def check(target_dir: str | None = None) -> dict:
    """
    Scan changed Python files for Redis security issues.

    Returns:
        dict with keys: exit_code, skipped, name, data
    """
    dir_path = target_dir or os.getcwd()

    files = _get_changed_files(dir_path)
    if files is None:
        return {
            "exit_code": 0, "skipped": True, "name": "redis_guard",
            "data": {"findings": [], "message": "No git diff available"},
        }

    if not files:
        return {
            "exit_code": 0, "skipped": False, "name": "redis_guard",
            "data": {"findings": [], "message": "No changed Python files to scan"},
        }

    all_violations: list[dict] = []

    for filepath in files:
        full_path = Path(dir_path) / filepath
        if not full_path.exists():
            continue

        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, PermissionError):
            continue

        try:
            tree = ast.parse(content, filename=str(full_path))
        except SyntaxError:
            continue

        visitor = RedisVisitor(filepath)
        visitor.visit(tree)
        all_violations.extend(visitor.violations)

    total = len(all_violations)
    if total:
        msg = f"{total} Redis violation(s) found"
    else:
        msg = "No Redis violations found"

    return {
        "exit_code": 1 if total else 0,
        "skipped": False,
        "name": "redis_guard",
        "data": {"findings": all_violations, "message": msg},
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
