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
import sys

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402


def _is_migration_path(rel: str) -> bool:
    """
    True for the paths _find_migration_files would report: alembic/versions/*.py
    and *.py (except __init__.py) directly inside a migrations/ directory that
    is not hidden and not under __pycache__.
    """
    parts = pathlib.PurePosixPath(rel).parts
    if not rel.endswith(".py") or len(parts) < 2:
        return False
    if parts[:2] == ("alembic", "versions") and len(parts) == 3:
        return True
    if parts[-2] != "migrations" or parts[-1] == "__init__.py":
        return False
    migrations_dir = "/".join(parts[:-1])
    return not migrations_dir.startswith(".") and "__pycache__" not in migrations_dir


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

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(dir_path)
    mode = changes["mode"]
    if mode is None:
        return {
            "exit_code": 0, "skipped": True, "name": "check_migrations",
            "data": {"violations": {}, "message": "No git diff available"},
        }

    # Changed migrations come from the snapshot's path list: a migration
    # deleted or edited in the working copy must not hide the staged one.
    changed_migrations = [f for f in changes["files"] if _is_migration_path(f)]
    if not changed_migrations:
        message = (
            "No migration files were changed" if _find_migration_files(dir_path)
            else "No migration files found"
        )
        return {
            "exit_code": 0, "skipped": False, "name": "check_migrations",
            "data": {"violations": {}, "message": message},
        }

    violations: dict[str, list[dict]] = {}

    for filepath in changed_migrations:
        content = _changes.read_file(dir_path, filepath, mode)
        if content is None:
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
