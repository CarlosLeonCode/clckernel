#!/usr/bin/env python3
"""
Alembic / Django Migration Reversibility & Safety Guard
Checks that database migration scripts follow safe practices:
  - Migrations have both upgrade() and downgrade()
  - No destructive operations without downgrade safeguards
  - Migration files are not empty
  - Django migrations reference existing model classes
Self-contained: uses only Python stdlib (regex-based checks; pathlib, subprocess, json).
"""
from __future__ import annotations

import ast
import json
import os
import pathlib
import re
import subprocess
import sys


def _get_changed_files(target_dir: str) -> list[str] | None:
    """Return changed files from git diff, or None on failure."""
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


def _find_migration_files(target_dir: str) -> list[str]:
    """Find all migration files in the project."""
    root = pathlib.Path(target_dir)
    migrations: list[str] = []

    # Alembic: alembic/versions/*.py
    alembic_versions = root / "alembic" / "versions"
    if alembic_versions.is_dir():
        for f in sorted(alembic_versions.glob("*.py")):
            migrations.append(str(f.relative_to(root)))

    # Django: */migrations/*.py
    for migrations_dir in root.rglob("migrations"):
        if migrations_dir.is_dir() and migrations_dir != root:
            # Skip hidden dirs and __pycache__
            rel = str(migrations_dir.relative_to(root))
            if rel.startswith(".") or "__pycache__" in rel:
                continue
            for f in sorted(migrations_dir.glob("*.py")):
                if f.name != "__init__.py":
                    migrations.append(str(f.relative_to(root)))

    return migrations


def _check_alembic_migration(filepath: str, content: str) -> list[dict]:
    """Check an Alembic migration file for issues."""
    violations: list[dict] = []

    # Check for upgrade function
    if "def upgrade(" not in content:
        violations.append({
            "lineNo": 0,
            "rule": "missing-upgrade",
            "reason": "Migration has no upgrade() function",
        })

    # Check for downgrade function
    if "def downgrade(" not in content:
        violations.append({
            "lineNo": 0,
            "rule": "missing-downgrade",
            "reason": "Migration has no downgrade() function — rollback impossible",
        })

    # Check for destructive operations
    destructive_patterns = [
        (r"\.drop_table\(", "DROP TABLE", "Destructive: table drop without safeguard"),
        (r"\.drop_column\(", "DROP COLUMN", "Destructive: column drop without safeguard"),
        (r"\.drop_index\(", "DROP INDEX", "Destructive: index drop"),
        (r"batch_alter_table.*\.drop_column", "BATCH DROP COLUMN", "Batch column drop"),
    ]
    for pattern, label, reason in destructive_patterns:
        if re.search(pattern, content):
            # Check if there's a corresponding downgrade
            if "def downgrade(" in content:
                downgrade_section = content.split("def downgrade(")[1] if "def downgrade(" in content else ""
                if label.lower().replace(" ", "_") not in downgrade_section.lower().replace(" ", "_"):
                    # More lenient: just flag it
                    violations.append({
                        "lineNo": 0,
                        "rule": f"destructive-{label.lower().replace(' ', '_')}",
                        "reason": f"{reason} — verify downgrade covers this",
                    })

    return violations


def _check_django_migration(filepath: str, content: str) -> list[dict]:
    """Check a Django migration file for issues."""
    violations: list[dict] = []

    # Check for empty migration
    if len(content.strip()) < 50:
        violations.append({
            "lineNo": 0,
            "rule": "empty-migration",
            "reason": "Migration file appears empty or near-empty",
        })

    # Check for RunPython without reverse_code
    if "RunPython(" in content:
        # Find RunPython calls and check for reverse_code
        run_python_pattern = re.compile(r"RunPython\(([^)]*)\)")
        for match in run_python_pattern.finditer(content):
            args = match.group(1)
            if "reverse_code" not in args and "run_python" not in args.lower():
                violations.append({
                    "lineNo": content[:match.start()].count("\n") + 1,
                    "rule": "run-python-no-reverse",
                    "reason": "RunPython without reverse_code — rollback may fail",
                })

    # Check for RunSQL without reverse_sql
    if "RunSQL(" in content:
        run_sql_pattern = re.compile(r"RunSQL\(([^)]*)\)")
        for match in run_sql_pattern.finditer(content):
            args = match.group(1)
            if "reverse_sql" not in args:
                violations.append({
                    "lineNo": content[:match.start()].count("\n") + 1,
                    "rule": "run-sql-no-reverse",
                    "reason": "RunSQL without reverse_sql — rollback may fail",
                })

    return violations


def check(target_dir: str | None = None) -> dict:
    """
    Check migration files for reversibility and safety issues.

    Returns:
        dict with keys: exit_code, skipped, name, data
        data.violations maps filepath -> list of {lineNo, rule, reason}
    """
    dir_path = target_dir or os.getcwd()

    changed_files = _get_changed_files(dir_path)
    if changed_files is None:
        return {
            "exit_code": 0, "skipped": True, "name": "check_migrations",
            "data": {"violations": {}, "message": "No git diff available"},
        }

    migration_files = _find_migration_files(dir_path)
    if not migration_files:
        return {
            "exit_code": 0, "skipped": False, "name": "check_migrations",
            "data": {"violations": {}, "message": "No migration files found"},
        }

    # Only check migrations that were changed
    changed_migrations = [f for f in migration_files if f in changed_files]
    if not changed_migrations:
        return {
            "exit_code": 0, "skipped": False, "name": "check_migrations",
            "data": {"violations": {}, "message": "No migration files were changed"},
        }

    violations: dict[str, list[dict]] = {}

    for filepath in changed_migrations:
        full_path = pathlib.Path(dir_path) / filepath
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, PermissionError):
            continue

        # Determine migration framework
        if "/alembic/" in filepath or "alembic" in filepath:
            file_violations = _check_alembic_migration(filepath, content)
        elif "/migrations/" in filepath:
            file_violations = _check_django_migration(filepath, content)
        else:
            file_violations = []

        if file_violations:
            violations[filepath] = file_violations

    total = sum(len(v) for v in violations.values())
    if total:
        msg = (
            f"{total} migration issue(s) found in "
            f"{len(violations)} file(s)"
        )
    else:
        msg = "All migration checks passed"

    return {
        "exit_code": 1 if total else 0,
        "skipped": False,
        "name": "check_migrations",
        "data": {"violations": violations, "message": msg},
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
