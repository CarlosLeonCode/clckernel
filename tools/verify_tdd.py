#!/usr/bin/env python3
"""
TDD Flow Validator
Validates that test files exist for changed code, checks for test patterns,
and reports on test coverage presence (pytest, unittest, manage.py test).
Self-contained: uses only Python stdlib (pathlib, subprocess, json).
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys


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


def _detect_test_framework(target_dir: str) -> str:
    """Detect which test framework is in use."""
    root = pathlib.Path(target_dir)

    # Check for pytest.ini or pytest config
    for name in ("pytest.ini", "setup.cfg", "pyproject.toml"):
        fpath = root / name
        if fpath.exists():
            try:
                text = fpath.read_text(encoding="utf-8", errors="replace").lower()
            except OSError:
                continue
            if "pytest" in text:
                return "pytest"

    # Check for Django manage.py test
    if (root / "manage.py").exists():
        return "django"

    # Check for unittest patterns
    for py_file in root.rglob("test_*.py"):
        try:
            content = py_file.read_text(encoding="utf-8", errors="replace")
            if "import unittest" in content or "unittest.TestCase" in content:
                return "unittest"
        except OSError:
            continue

    return "unknown"


def _find_test_files(target_dir: str) -> list[str]:
    """Find all test files in the project."""
    root = pathlib.Path(target_dir)
    test_files: list[str] = []

    for py_file in root.rglob("test_*.py"):
        rel = str(py_file.relative_to(root))
        if "__pycache__" not in rel:
            test_files.append(rel)

    for py_file in root.rglob("*_test.py"):
        rel = str(py_file.relative_to(root))
        if "__pycache__" not in rel and rel not in test_files:
            test_files.append(rel)

    # Check tests/ directories
    for tests_dir in root.rglob("tests"):
        if tests_dir.is_dir():
            for py_file in tests_dir.glob("*.py"):
                rel = str(py_file.relative_to(root))
                if "__pycache__" not in rel and py_file.name != "__init__.py" and rel not in test_files:
                    test_files.append(rel)

    return sorted(test_files)


def _count_test_methods(target_dir: str, filepath: str) -> int:
    """Count test methods in a test file."""
    full_path = pathlib.Path(target_dir) / filepath
    try:
        content = full_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0

    import re
    # Count test_ method definitions and TestCase subclasses
    test_funcs = len(re.findall(r"def (test_\w+)", content))
    return test_funcs


def check(target_dir: str | None = None) -> dict:
    """
    Validate TDD flow: tests exist, test framework detected, coverage signals.

    Returns:
        dict with keys: exit_code, skipped, name, data
        data.framework, data.test_files, data.changed_code_files,
        data.test_count, data.has_test_coverage
    """
    dir_path = target_dir or os.getcwd()

    changed = _get_changed_files(dir_path)
    if changed is None:
        return {
            "exit_code": 0, "skipped": True, "name": "verify_tdd",
            "data": {"message": "No git diff available"},
        }

    if not changed:
        return {
            "exit_code": 0, "skipped": False, "name": "verify_tdd",
            "data": {
                "framework": "unknown", "test_files": [],
                "changed_code_files": [], "test_count": 0,
                "has_test_coverage": False,
                "message": "No changed files",
            },
        }

    framework = _detect_test_framework(dir_path)
    test_files = _find_test_files(dir_path)

    # Separate test files from code files in the diff
    changed_tests = [f for f in changed if f.endswith(".py") and _is_test_file(f)]
    changed_code = [f for f in changed if f.endswith(".py") and not _is_test_file(f)]

    # Count total test methods
    total_tests = sum(_count_test_methods(dir_path, tf) for tf in test_files)

    # Determine if there's meaningful test coverage
    has_tests = len(test_files) > 0
    has_test_in_diff = len(changed_tests) > 0
    has_code_in_diff = len(changed_code) > 0

    # TDD indicator: if code changed but no test changed, flag it
    if has_code_in_diff and not has_test_in_diff and has_tests:
        msg = (
            f"Code files changed without corresponding test changes "
            f"({len(changed_code)} code files, {len(changed_tests)} test files). "
            f"Framework: {framework}. Total test methods: {total_tests}"
        )
        exit_code = 1
    elif has_code_in_diff and not has_test_in_diff and not has_tests:
        msg = (
            f"No test files found in project. "
            f"{len(changed_code)} code file(s) changed without tests. "
            f"Framework: {framework}"
        )
        exit_code = 1
    elif has_test_in_diff:
        msg = (
            f"TDD flow detected: {len(changed_tests)} test file(s) changed "
            f"alongside {len(changed_code)} code file(s). "
            f"Framework: {framework}. Total test methods: {total_tests}"
        )
        exit_code = 0
    else:
        msg = (
            f"No Python code changes detected. "
            f"Framework: {framework}. Total test methods: {total_tests}"
        )
        exit_code = 0

    return {
        "exit_code": exit_code,
        "skipped": False,
        "name": "verify_tdd",
        "data": {
            "framework": framework,
            "test_files": test_files[:20],  # Cap at 20 for readability
            "changed_code_files": changed_code,
            "changed_test_files": changed_tests,
            "test_count": total_tests,
            "has_test_coverage": has_tests,
            "message": msg,
        },
    }


def _is_test_file(filepath: str) -> bool:
    """Check if a filepath is a test file."""
    basename = pathlib.Path(filepath).name
    return (
        basename.startswith("test_")
        or basename.endswith("_test.py")
        or "/tests/" in filepath
        or "/test/" in filepath
    )


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
