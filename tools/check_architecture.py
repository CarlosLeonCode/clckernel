#!/usr/bin/env python3
"""
Clean Architecture / Django Layer Boundary Guard
Validates that Python code respects architectural layer boundaries:
  - Domain layer should not import from Application or Infrastructure
  - Application layer should not import from Infrastructure or Routes
  - Routes/API should not import from Domain directly (go through Application)
For Django: checks that models don't import from views, views don't import from urls, etc.
Self-contained: uses only Python stdlib (ast, pathlib, subprocess, json).
"""
from __future__ import annotations

import ast
import json
import os
import re
import sys

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402


def _detect_framework(target_dir: str, mode: str | None) -> str:
    """Detect whether this is a Django, FastAPI, or generic Python project (from the snapshot)."""
    if _changes.exists(target_dir, "manage.py", mode):
        return "django"

    for name in ("pyproject.toml", "requirements.txt"):
        text = _changes.read_file(target_dir, name, mode)
        if text is None:
            continue
        text = text.lower()
        if "django" in text:
            return "django"
        if "fastapi" in text:
            return "fastapi"

    return "generic"


def _check_django_layers(
    filepath: str, content: str, tree: ast.Module,
) -> list[dict]:
    """Check Django layer boundary violations."""
    violations: list[dict] = []
    rel_path = filepath

    # Determine file layer from path
    if "/models" in rel_path or rel_path.endswith("/models.py"):
        file_layer = "models"
    elif "/views" in rel_path or rel_path.endswith("/views.py"):
        file_layer = "views"
    elif "/urls" in rel_path or rel_path.endswith("/urls.py"):
        file_layer = "urls"
    elif "/serializers" in rel_path or rel_path.endswith("/serializers.py"):
        file_layer = "serializers"
    elif "/forms" in rel_path or rel_path.endswith("/forms.py"):
        file_layer = "forms"
    elif "/admin" in rel_path or rel_path.endswith("/admin.py"):
        file_layer = "admin"
    elif "/tasks" in rel_path or rel_path.endswith("/tasks.py"):
        file_layer = "tasks"
    else:
        return violations  # Can't determine layer, skip

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.ImportFrom) and node.module:
                imported = node.module
            elif isinstance(node, ast.Import):
                imported = node.names[0].name if node.names else ""
            else:
                continue

            # Django models should not import from views, urls, admin
            if file_layer == "models":
                bad_targets = ("views", "urls", "admin", "serializers", "forms")
                for bad in bad_targets:
                    if f".{bad}" in imported or imported == bad:
                        violations.append({
                            "lineNo": getattr(node, "lineno", 0),
                            "module": imported,
                            "reason": (
                                f"Model imports from {bad} layer — "
                                f"models must not depend on presentation or routing"
                            ),
                        })

            # Views should not import from other views or urls
            if file_layer == "views":
                if ".urls" in imported or imported.endswith("urls"):
                    violations.append({
                        "lineNo": getattr(node, "lineno", 0),
                        "module": imported,
                        "reason": "View imports from urls — views should not depend on URL configuration",
                    })

            # URLs should not import from models directly
            if file_layer == "urls":
                if ".models" in imported or imported.endswith("models"):
                    violations.append({
                        "lineNo": getattr(node, "lineno", 0),
                        "module": imported,
                        "reason": "URL module imports models directly — route through views",
                    })

    return violations


def _check_clean_architecture(
    filepath: str, content: str, tree: ast.Module,
) -> list[dict]:
    """Check Clean Architecture boundary violations for generic Python projects."""
    violations: list[dict] = []

    # Detect layer from path
    if "/domain" in filepath:
        file_layer = "domain"
    elif "/application" in filepath or "/use_cases" in filepath:
        file_layer = "application"
    elif "/infrastructure" in filepath or "/adapters" in filepath:
        file_layer = "infrastructure"
    elif "/routes" in filepath or "/api" in filepath:
        file_layer = "routes"
    else:
        return violations  # Can't determine layer

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.ImportFrom) and node.module:
                imported = node.module
            elif isinstance(node, ast.Import):
                imported = node.names[0].name if node.names else ""
            else:
                continue

            # Domain must not import from application, infrastructure, or routes
            if file_layer == "domain":
                bad = ("application", "use_cases", "infrastructure", "adapters", "routes", "api")
                for b in bad:
                    if f".{b}" in imported or imported.startswith(b):
                        violations.append({
                            "lineNo": getattr(node, "lineno", 0),
                            "module": imported,
                            "reason": (
                                f"Domain layer imports from '{b}' — "
                                f"domain must be framework-independent"
                            ),
                        })

            # Application must not import from infrastructure or routes
            if file_layer == "application":
                bad = ("infrastructure", "adapters", "routes", "api")
                for b in bad:
                    if f".{b}" in imported or imported.startswith(b):
                        violations.append({
                            "lineNo": getattr(node, "lineno", 0),
                            "module": imported,
                            "reason": (
                                f"Application layer imports from '{b}' — "
                                f"use dependency inversion"
                            ),
                        })

    return violations


def check(target_dir: str | None = None) -> dict:
    """
    Validate architecture layer boundaries in changed Python files.

    Returns:
        dict with keys: exit_code, skipped, name, data
        data.violations maps filepath -> list of {lineNo, module, reason}
    """
    dir_path = target_dir or os.getcwd()

    # The snapshot being verified: the index, or HEAD when nothing is staged.
    changes = _changes.changed_files(dir_path, extensions=[".py"])
    mode, files = changes["mode"], changes["files"]
    if mode is None:
        return {
            "exit_code": 0, "skipped": True, "name": "check_architecture",
            "data": {"violations": {}, "message": "No git diff available"},
        }

    if not files:
        return {
            "exit_code": 0, "skipped": False, "name": "check_architecture",
            "data": {"violations": {}, "message": "No Python files changed"},
        }

    framework = _detect_framework(dir_path, mode)
    violations: dict[str, list[dict]] = {}

    for filepath in files:
        content = _changes.read_file(dir_path, filepath, mode)
        if content is None:
            continue

        try:
            tree = ast.parse(content, filename=filepath)
        except SyntaxError:
            continue

        if framework == "django":
            file_violations = _check_django_layers(filepath, content, tree)
        else:
            file_violations = _check_clean_architecture(filepath, content, tree)

        if file_violations:
            violations[filepath] = file_violations

    total = sum(len(v) for v in violations.values())
    if total:
        msg = (
            f"{total} architecture violation(s) found in "
            f"{len(violations)} file(s)"
        )
    else:
        msg = "All architecture checks passed"

    return {
        "exit_code": 1 if total else 0,
        "skipped": False,
        "name": "check_architecture",
        "data": {"violations": violations, "message": msg},
    }


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
