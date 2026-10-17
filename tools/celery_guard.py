#!/usr/bin/env python3
"""
Celery Guard
Checks for Celery task security issues in changed Python files.
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


class CeleryVisitor(ast.NodeVisitor):
    """AST visitor that detects Celery task security issues."""

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

    def _is_broker_url(self, node: ast.expr) -> bool:
        """Check if expression looks like a broker URL."""
        return self._is_redis_url(node)

    def visit_Call(self, node: ast.Call):
        # Check for Celery() instantiation with broker_url or result_backend
        if isinstance(node.func, ast.Name) and node.func.id == 'Celery':
            for keyword in node.keywords:
                if keyword.arg == 'broker_url':
                    if self._is_broker_url(keyword.value):
                        self._add_violation(
                            node.lineno or 0,
                            "hardcoded_broker_url",
                            f"Celery broker_url directly in code"
                        )
                if keyword.arg == 'result_backend':
                    if not isinstance(keyword.value, ast.Constant) or keyword.value.value is None:
                        pass  # Skip None defaults
                    elif isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                        val = keyword.value.value.lower()
                        if val and val not in ('None', 'null', ''):
                            self._add_violation(
                                node.lineno or 0,
                                "hardcoded_result_backend",
                                f"Celery result_backend directly in code"
                            )

        # Check for @shared_task or @celery.task decorators
        # Handle @shared_task(...) or @shared_task
        try:
            for decorator in node.decorator_list:
                dec_name = ''
                dec_args: list[ast.expr] = []
                if isinstance(decorator, ast.Call):
                    if isinstance(decorator.func, ast.Name):
                        dec_name = decorator.func.id
                    elif isinstance(decorator.func, ast.Attribute):
                        dec_name = decorator.func.attr
                    dec_args = decorator.args
                elif isinstance(decorator, ast.Name):
                    dec_name = decorator.id
                elif isinstance(decorator, ast.Attribute):
                    dec_name = decorator.attr

                if dec_name in ('shared_task', 'task'):
                    # Check if ignore_result=True is missing
                    ignore_found = False
                    for arg in dec_args:
                        if isinstance(arg, ast.keyword) and arg.arg == 'ignore_result':
                            if isinstance(arg.value, ast.Constant) and arg.value.value is True:
                                ignore_found = True
                    if not ignore_found:
                        # Check decorators with keyword args
                        for decorator_node in node.decorator_list:
                            if isinstance(decorator_node, ast.Call):
                                for kw in decorator_node.keywords:
                                    if kw.arg == 'ignore_result':
                                        if isinstance(kw.value, ast.Constant) and kw.value.value is True:
                                            ignore_found = True
                        if not ignore_found:
                            snippet = f"@{dec_name} without ignore_result=True"
                            self._add_violation(node.lineno or 0, "missing_ignore_result", snippet)
        except Exception:
            pass

        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef):
        # Check function body for broker URL strings
        for stmt in ast.walk(node):
            if isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if isinstance(target, ast.Name):
                        var_name = target.id.lower()
                        if 'broker' in var_name or 'url' in var_name:
                            if isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
                                val = stmt.value.value.lower()
                                if 'redis://' in val or 'rediss://' in val:
                                    self._add_violation(
                                        stmt.lineno or 0,
                                        "broker_url_in_variable",
                                        f"Broker URL assigned to variable {target.id}"
                                    )
        self.generic_visit(node)


def check(target_dir: str | None = None) -> dict:
    """
    Scan changed Python files for Celery security issues.

    Returns:
        dict with keys: exit_code, skipped, name, data
    """
    dir_path = target_dir or os.getcwd()

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(dir_path, extensions=[".py"])
    mode, files = changes["mode"], changes["files"]
    if mode is None:
        return {
            "exit_code": 0, "skipped": True, "name": "celery_guard",
            "data": {"findings": [], "message": "No git diff available"},
        }

    if not files:
        return {
            "exit_code": 0, "skipped": False, "name": "celery_guard",
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

        visitor = CeleryVisitor(filepath)
        visitor.visit(tree)
        all_violations.extend(visitor.violations)

    total = len(all_violations)
    if total:
        msg = f"{total} Celery violation(s) found"
    else:
        msg = "No Celery violations found"

    return {
        "exit_code": 1 if total else 0,
        "skipped": False,
        "name": "celery_guard",
        "data": {"findings": all_violations, "message": msg},
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
