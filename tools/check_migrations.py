#!/usr/bin/env python3
"""
Alembic / Django Migration Reversibility & Safety Guard
Checks that database migration scripts are reversible:
  - Alembic migrations have both upgrade() and downgrade()
  - A destructive op in upgrade() (drop_table/drop_column/drop_index/
    drop_constraint) has a matching create/add op in downgrade()
  - Django RunPython/RunSQL operations pass a reverse (positionally or by keyword)
  - Django migration files are not empty
Self-contained: uses only Python stdlib (ast-based checks; pathlib, subprocess, json).
"""
from __future__ import annotations

import ast
import json
import os
import pathlib
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


# Destructive Alembic ops and the ops in downgrade() that undo each of them.
_DESTRUCTIVE_OPS = {
    "drop_table": ("create_table",),
    "drop_column": ("add_column",),
    "drop_index": ("create_index",),
    "drop_constraint": (
        "create_foreign_key", "create_unique_constraint", "create_check_constraint",
        "create_primary_key", "create_exclude_constraint",
    ),
}


def _method_calls(node: ast.AST | None) -> list[ast.Call]:
    """Every `<receiver>.<method>(...)` call under node (op.x, batch_op.x, ...)."""
    if node is None:
        return []
    return [
        n for n in ast.walk(node)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
    ]


def _module_function(tree: ast.Module, name: str) -> ast.FunctionDef | None:
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def _check_alembic_migration(filepath: str, content: str) -> list[dict]:
    """Check an Alembic migration file for reversibility."""
    violations: list[dict] = []

    try:
        tree = ast.parse(content, filename=filepath)
    except SyntaxError as exc:
        return [{
            "lineNo": exc.lineno or 0,
            "rule": "unparseable-migration",
            "reason": "Migration is not valid Python — reversibility cannot be checked",
        }]

    upgrade = _module_function(tree, "upgrade")
    downgrade = _module_function(tree, "downgrade")

    if upgrade is None:
        violations.append({
            "lineNo": 0,
            "rule": "missing-upgrade",
            "reason": "Migration has no upgrade() function",
        })

    if downgrade is None:
        violations.append({
            "lineNo": 0,
            "rule": "missing-downgrade",
            "reason": "Migration has no downgrade() function — rollback impossible",
        })

    # A destructive op in upgrade() is reversible only when downgrade()
    # recreates what it removed. An empty / `pass` downgrade recreates nothing.
    undo_ops = {call.func.attr for call in _method_calls(downgrade)}
    for call in _method_calls(upgrade):
        op = call.func.attr
        if op in _DESTRUCTIVE_OPS and not undo_ops.intersection(_DESTRUCTIVE_OPS[op]):
            violations.append({
                "lineNo": call.lineno,
                "rule": f"destructive-{op}",
                "reason": (
                    f"upgrade() calls {op}() but downgrade() has no "
                    f"{' / '.join(_DESTRUCTIVE_OPS[op])}() — the migration is not reversible"
                ),
            })

    return violations


# Django operations that need a reverse, with the keyword that supplies it.
# The reverse is also accepted as the second positional argument.
_DJANGO_REVERSIBLE = {
    "RunPython": ("reverse_code", "run-python-no-reverse",
                  "RunPython without reverse_code — rollback may fail"),
    "RunSQL": ("reverse_sql", "run-sql-no-reverse",
               "RunSQL without reverse_sql — rollback may fail"),
}


def _call_name(call: ast.Call) -> str:
    func = call.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def _check_django_migration(filepath: str, content: str) -> list[dict]:
    """Check a Django migration file for reversibility."""
    violations: list[dict] = []

    # Check for empty migration
    if len(content.strip()) < 50:
        violations.append({
            "lineNo": 0,
            "rule": "empty-migration",
            "reason": "Migration file appears empty or near-empty",
        })

    try:
        tree = ast.parse(content, filename=filepath)
    except SyntaxError as exc:
        violations.append({
            "lineNo": exc.lineno or 0,
            "rule": "unparseable-migration",
            "reason": "Migration is not valid Python — reversibility cannot be checked",
        })
        return violations

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        spec = _DJANGO_REVERSIBLE.get(_call_name(node))
        if spec is None:
            continue
        keyword, rule, reason = spec
        has_reverse = len(node.args) >= 2 or any(kw.arg == keyword for kw in node.keywords)
        if not has_reverse:
            violations.append({"lineNo": node.lineno, "rule": rule, "reason": reason})

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
