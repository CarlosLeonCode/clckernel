#!/usr/bin/env python3
"""
PostgreSQL Guard
Checks for PostgreSQL security issues (SQL injection, hstore misuse) in changed Python files.
Self-contained: uses only Python stdlib (ast, pathlib, subprocess, json, sys).
"""
from __future__ import annotations

import ast
import json
import os
import sys

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402


class PostgresVisitor(ast.NodeVisitor):
    """AST visitor that detects PostgreSQL security issues."""

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

    def _is_sql_method(self, node: ast.expr) -> bool:
        """Check if expression is a SQL-related method call."""
        if isinstance(node, ast.Attribute):
            return node.attr in ('execute', 'executemany', 'callproc', 'cursor')
        return False

    def _has_formatted_sql(self, node: ast.Call) -> bool:
        """Check if a SQL call has formatted (injected) string arguments."""
        for arg in node.args:
            # f-string SQL
            if isinstance(arg, ast.JoinedStr):
                return True
            # % formatted string
            if isinstance(arg, ast.BinOp) and isinstance(arg.op, ast.Mod):
                return True
            # str.format() call
            if isinstance(arg, ast.Call):
                if isinstance(arg.func, ast.Attribute) and arg.func.attr == 'format':
                    return True
        return False

    def _check_hstore_raw(self, node: ast.Call) -> bool:
        """Check for raw hstore usage that bypasses parameterized queries."""
        # Look for cursor.execute("...::hstore...") patterns
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                if '::hstore' in arg.value or "hstore('" in arg.value:
                    return True
        return False

    def visit_Call(self, node: ast.Call):
        # Check for cursor.execute(), connection.execute(), etc.
        # The method name lives on the callee (node.func), not on the Call node.
        if self._is_sql_method(node.func):
            # Check for raw SQL with string formatting (f-string, %, .format())
            if self._has_formatted_sql(node):
                self._add_violation(
                    node.lineno or 0,
                    "sql_string_formatting",
                    "SQL query uses string formatting (f-string, %, .format()) - SQL injection risk"
                )

            # Check for raw hstore usage
            if self._check_hstore_raw(node):
                self._add_violation(
                    node.lineno or 0,
                    "hstore_raw_usage",
                    "Raw hstore expression bypasses parameterized queries"
                )

            # Check for string concatenation in SQL
            for arg in node.args:
                if isinstance(arg, ast.BinOp) and isinstance(arg.op, ast.Add):
                    # String concatenation like "SELECT * FROM " + table
                    if isinstance(arg.left, ast.Constant) or isinstance(arg.right, ast.Constant):
                        self._add_violation(
                            node.lineno or 0,
                            "sql_string_concatenation",
                            "SQL query uses string concatenation - SQL injection risk"
                        )
                        break

        # Check for psycopg2 sql.SQL() with .format() or .compose()
        if isinstance(node.func, ast.Attribute):
            if node.func.attr in ('sql', 'SQL'):
                # Check if composed with format
                for keyword in node.keywords:
                    if keyword.arg in ('format', 'compose'):
                        self._add_violation(
                            node.lineno or 0,
                            "sql_composition_risk",
                            "psycopg2 sql.SQL composition may bypass escaping"
                        )

        self.generic_visit(node)


def check(target_dir: str | None = None) -> dict:
    """
    Scan changed Python files for PostgreSQL security issues.

    Returns:
        dict with keys: exit_code, skipped, name, data
    """
    dir_path = target_dir or os.getcwd()

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(dir_path, extensions=[".py"])
    mode, files = changes["mode"], changes["files"]
    if mode is None:
        return {
            "exit_code": 0, "skipped": True, "name": "postgres_guard",
            "data": {"findings": [], "message": "No git diff available"},
        }

    if not files:
        return {
            "exit_code": 0, "skipped": False, "name": "postgres_guard",
            "data": {"findings": [], "message": "No changed Python files to scan"},
        }

    all_violations: list[dict] = []

    for filepath in files:
        content = _changes.read_file(dir_path, filepath, mode)
        if content is None:
            continue

        try:
            tree = ast.parse(content, filename=filepath)
        except SyntaxError:
            continue

        visitor = PostgresVisitor(filepath)
        visitor.visit(tree)
        all_violations.extend(visitor.violations)

    total = len(all_violations)
    if total:
        msg = f"{total} PostgreSQL violation(s) found"
    else:
        msg = "No PostgreSQL violations found"

    return {
        "exit_code": 1 if total else 0,
        "skipped": False,
        "name": "postgres_guard",
        "data": {"findings": all_violations, "message": msg},
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
