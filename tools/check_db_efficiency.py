#!/usr/bin/env python3
"""
Backend Database Efficiency & N+1 Heuristic
Python AST scanner detecting:
1. ORM-like query calls inside loops/comprehensions (N+1 heuristic for SQLAlchemy, Django ORM, SQLModel)
2. Blocking time.sleep() calls inside async functions

Self-contained: uses only Python standard library (ast, subprocess, pathlib).
"""
from __future__ import annotations

import ast
import os
import pathlib
import subprocess
import sys


QUERY_METHODS = {
    "filter", "get", "all", "first", "execute", "scalars", "scalar",
    "fetch", "fetchall", "fetchone", "query", "raw"
}

QUERY_CALLERS = {
    "db", "session", "objects", "cursor", "connection", "repo", "repository"
}


class LoopQueryVisitor(ast.NodeVisitor):
    def __init__(self, filename: str):
        self.filename = filename
        self.violations: list[dict] = []
        self._loop_depth = 0
        self._is_async_func = False

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        prev = self._is_async_func
        self._is_async_func = True
        self.generic_visit(node)
        self._is_async_func = prev

    def visit_FunctionDef(self, node: ast.FunctionDef):
        prev = self._is_async_func
        self._is_async_func = False
        self.generic_visit(node)
        self._is_async_func = prev

    def visit_For(self, node: ast.For):
        self._loop_depth += 1
        self.generic_visit(node)
        self._loop_depth -= 1

    def visit_While(self, node: ast.While):
        self._loop_depth += 1
        self.generic_visit(node)
        self._loop_depth -= 1

    def visit_ListComp(self, node: ast.ListComp):
        self._loop_depth += 1
        self.generic_visit(node)
        self._loop_depth -= 1

    def visit_DictComp(self, node: ast.DictComp):
        self._loop_depth += 1
        self.generic_visit(node)
        self._loop_depth -= 1

    def visit_GeneratorExp(self, node: ast.GeneratorExp):
        self._loop_depth += 1
        self.generic_visit(node)
        self._loop_depth -= 1

    def visit_Call(self, node: ast.Call):
        # 1. Detect time.sleep in async def
        if self._is_async_func:
            if isinstance(node.func, ast.Attribute) and node.func.attr == "sleep":
                if isinstance(node.func.value, ast.Name) and node.func.value.id == "time":
                    self.violations.append({
                        "lineNo": node.lineno,
                        "rule": "sync-blocking-sleep",
                        "message": "Blocking time.sleep() called inside async function. Use 'await asyncio.sleep()' instead to avoid starving the event loop."
                    })

        # 2. Detect DB queries inside loops (N+1 query hazard)
        if self._loop_depth > 0:
            if isinstance(node.func, ast.Attribute):
                attr_name = node.func.attr
                val = node.func.value

                # Match session.execute(), db.query(), Model.objects.filter(), etc.
                is_db_call = False
                caller_name = ""

                if isinstance(val, ast.Name):
                    caller_name = val.id.lower()
                    if caller_name in QUERY_CALLERS or attr_name in QUERY_METHODS:
                        is_db_call = True
                elif isinstance(val, ast.Attribute):
                    caller_name = val.attr.lower()
                    if caller_name in QUERY_CALLERS or attr_name in QUERY_METHODS:
                        is_db_call = True

                if is_db_call and attr_name in QUERY_METHODS:
                    self.violations.append({
                        "lineNo": node.lineno,
                        "rule": "db-query-in-loop",
                        "message": f"Database query call '.{attr_name}()' detected inside loop/comprehension. Causes N+1 performance bottleneck. Use bulk queries or eager loading (selectinload/joinedload/select_related)."
                    })

        self.generic_visit(node)


def check(target_dir: str | None = None) -> dict:
    dir_path = pathlib.Path(target_dir or os.getcwd()).resolve()

    # Get changed python files
    files: list[str] = []
    try:
        # Staged changes first (what is being committed); HEAD~1 only when nothing is staged.
        out = subprocess.check_output(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            cwd=dir_path,
            stderr=subprocess.PIPE,
            text=True
        )
        if not out.strip():
            out = subprocess.check_output(
                ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD~1"],
                cwd=dir_path,
                stderr=subprocess.PIPE,
                text=True
            )
        files = [f.strip() for f in out.splitlines() if f.strip().endswith(".py")]
    except Exception:
        try:
            out = subprocess.check_output(
                ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
                cwd=dir_path,
                stderr=subprocess.PIPE,
                text=True
            )
            files = [f.strip() for f in out.splitlines() if f.strip().endswith(".py")]
        except Exception:
            return {
                "exit_code": 0,
                "skipped": True,
                "name": "check_db_efficiency",
                "data": {"message": "No git diff available"}
            }

    if not files:
        return {
            "exit_code": 0,
            "skipped": False,
            "name": "check_db_efficiency",
            "data": {"violations": {}, "message": "No Python backend files changed"}
        }

    violations: dict[str, list[dict]] = {}

    for file_rel in files:
        file_path = dir_path / file_rel
        if not file_path.is_file():
            continue

        try:
            source = file_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(file_path))
        except Exception:
            continue

        visitor = LoopQueryVisitor(file_rel)
        visitor.visit(tree)

        if visitor.violations:
            violations[file_rel] = visitor.violations

    total_count = sum(len(v) for v in violations.values())
    return {
        "exit_code": 1 if total_count > 0 else 0,
        "skipped": False,
        "name": "check_db_efficiency",
        "data": {
            "violations": violations,
            "message": f"{total_count} DB efficiency / N+1 issue(s) found in {len(violations)} file(s)"
            if total_count > 0 else "All database efficiency & performance checks passed"
        }
    }


if __name__ == "__main__":
    import json
    target = sys.argv[1] if len(sys.argv) > 1 else None
    result = check(target)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
