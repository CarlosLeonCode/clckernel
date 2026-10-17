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
import sys

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402


QUERY_METHODS = {
    "filter", "get", "all", "first", "execute", "scalars", "scalar",
    "fetch", "fetchall", "fetchone", "query", "raw"
}

# Receiver names (case-insensitive) that hold an ORM session / connection:
# session.get(...), db.execute(...), self.session.scalars(...).
SESSION_NAMES = {"session", "db", "db_session"}


def _is_orm_receiver(node: ast.AST) -> bool:
    """
    True when a method call on `node` looks like an ORM query:
      - the attribute chain contains `.objects` (Django manager),
      - it ends in a session-like name (session, db, db_session; self.session),
      - it is the result of a `.query(...)` call (SQLAlchemy Query chain),
      - it is `Model.query` (Flask-SQLAlchemy).
    Anything else (dict.get, requests.get, config.get) is not a query.
    """
    if isinstance(node, ast.Name):
        return node.id.lower() in SESSION_NAMES
    if isinstance(node, ast.Attribute):
        if node.attr == "objects" or node.attr == "query":
            return True
        if node.attr.lower() in SESSION_NAMES:
            # Django's request.session is a dict-like store, not an ORM session.
            return not (isinstance(node.value, ast.Name) and node.value.id == "request")
        return _is_orm_receiver(node.value)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        if node.func.attr == "query":
            return True
        return _is_orm_receiver(node.func.value)
    return False


def _chain_calls(node: ast.AST) -> list[ast.Call]:
    """Calls inside the receiver chain of `node` (x.query(...).filter(...) -> both calls)."""
    calls: list[ast.Call] = []
    while isinstance(node, (ast.Attribute, ast.Call)):
        if isinstance(node, ast.Call):
            calls.append(node)
            node = node.func
        else:
            node = node.value
    return calls


class LoopQueryVisitor(ast.NodeVisitor):
    def __init__(self, filename: str):
        self.filename = filename
        self.violations: list[dict] = []
        self._loop_depth = 0
        self._is_async_func = False
        # Calls already covered by an enclosing query chain (one finding per chain).
        self._reported: set[int] = set()

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
        if (
            self._loop_depth > 0
            and id(node) not in self._reported
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in QUERY_METHODS
            and _is_orm_receiver(node.func.value)
        ):
            attr_name = node.func.attr
            self._reported.update(id(c) for c in _chain_calls(node.func.value))
            self.violations.append({
                "lineNo": node.lineno,
                "rule": "db-query-in-loop",
                "message": f"Database query call '.{attr_name}()' detected inside loop/comprehension. Causes N+1 performance bottleneck. Use bulk queries or eager loading (selectinload/joinedload/select_related)."
            })

        self.generic_visit(node)


def check(target_dir: str | None = None) -> dict:
    dir_path = pathlib.Path(target_dir or os.getcwd()).resolve()

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(str(dir_path), extensions=[".py"])
    mode, files = changes["mode"], changes["files"]
    if mode is None:
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
        source = _changes.read_file(str(dir_path), file_rel, mode)
        if source is None:
            continue
        try:
            tree = ast.parse(source, filename=file_rel)
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
