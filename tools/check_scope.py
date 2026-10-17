#!/usr/bin/env python3
"""
Scope Guard — SDD Scope Validation
Validates that changed files match the declared SDD scope by comparing
git diff output against the SDD affected files list.
Self-contained: uses only Python stdlib (pathlib, subprocess, json).
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


def _find_sdd_declared_files(target_dir: str) -> list[str] | None:
    """
    Find declared affected files from the active SDD directory.
    Looks for 00-state.md, 01-proposal.md, or any .md with 'affected' or 'files'.
    Returns None if no SDD context found.
    """
    root = pathlib.Path(target_dir)
    sdds_dir = root / "sdds"
    if not sdds_dir.is_dir():
        return None

    # Find active SDD dir (most recently modified)
    candidates = sorted(
        [d for d in sdds_dir.iterdir() if d.is_dir()],
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        return None

    sdd_dir = candidates[0]

    # Try to extract file list from SDD markdown files
    declared: list[str] = []
    for md_file in sdd_dir.glob("*.md"):
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        # Look for file references in common SDD patterns
        # Pattern: `- path/to/file` or `| path/to/file |`
        for line in content.splitlines():
            # Match bullet-point file paths
            m = re.match(r"\s*[-*]\s+`?([a-zA-Z_][\w./-]+\.\w+)`?", line)
            if m:
                declared.append(m.group(1))
            # Match table cell file paths
            m = re.match(r"\s*\|[^|]*`?([a-zA-Z_][\w./-]+\.\w+)`?[^|]*\|", line)
            if m:
                declared.append(m.group(1))

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for f in declared:
        if f not in seen:
            seen.add(f)
            unique.append(f)

    return unique if unique else None


def check(target_dir: str | None = None) -> dict:
    """
    Validate that changed files match declared SDD scope.

    Returns:
        dict with keys: exit_code, skipped, name, data
        data.authorized, data.warnings, data.unrelated — lists of file paths
    """
    dir_path = target_dir or os.getcwd()

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(dir_path)
    changed = changes["files"]
    if changes["mode"] is None:
        return {
            "exit_code": 0, "skipped": True, "name": "check_scope",
            "data": {
                "authorized": [], "warnings": [], "unrelated": [],
                "message": "No git diff available",
            },
        }

    if not changed:
        return {
            "exit_code": 0, "skipped": False, "name": "check_scope",
            "data": {
                "authorized": [], "warnings": [], "unrelated": [],
                "message": "No changed files",
            },
        }

    declared = _find_sdd_declared_files(dir_path)
    if declared is None:
        # No SDD context — all files are "unrelated" but it's not an error
        return {
            "exit_code": 0, "skipped": False, "name": "check_scope",
            "data": {
                "authorized": [], "warnings": [], "unrelated": changed,
                "message": "No SDD context found — all changed files are undeclared",
            },
        }

    authorized: list[str] = []
    warnings: list[str] = []
    unrelated: list[str] = []

    for f in changed:
        if f in declared:
            authorized.append(f)
        else:
            # Check if it's in the same directory as a declared file (warn)
            declared_dirs = {str(pathlib.Path(d).parent) for d in declared}
            if str(pathlib.Path(f).parent) in declared_dirs:
                warnings.append(f)
            else:
                unrelated.append(f)

    total = len(changed)
    if unrelated:
        msg = (
            f"{len(unrelated)} file(s) not in declared SDD scope "
            f"({len(authorized)} authorized, {len(warnings)} related warnings)"
        )
        exit_code = 1
    elif warnings:
        msg = (
            f"All files related to declared scope "
            f"({len(authorized)} authorized, {len(warnings)} related warnings)"
        )
        exit_code = 0
    else:
        msg = f"All {total} changed file(s) are within declared SDD scope"
        exit_code = 0

    return {
        "exit_code": exit_code,
        "skipped": False,
        "name": "check_scope",
        "data": {
            "authorized": authorized,
            "warnings": warnings,
            "unrelated": unrelated,
            "message": msg,
        },
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
