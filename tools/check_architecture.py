#!/usr/bin/env python3
"""
Clean Architecture / Django Layer Boundary Guard
Validates that Python code respects architectural layer boundaries:
  - Domain layer should not import from Application or Infrastructure
  - Application layer should not import from Infrastructure or Routes
  - Routes/API should not import from Domain directly (go through Application)
For Django: checks that models don't import from views, views don't import from urls, etc.
The framework is decided per changed file, from its nearest project root in the
snapshot (manage.py / pyproject.toml / setup.cfg / requirements*.txt), so each
part of a monorepo gets its own rules.
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


# Files that make their directory a Python project root (requirements*.txt too).
_ROOT_MARKERS = ("manage.py", "pyproject.toml", "setup.cfg")


def _is_requirements(name: str) -> bool:
    return name.startswith("requirements") and name.endswith(".txt")


def _markers_by_dir(target_dir: str, mode: str | None) -> dict[str, list[str]]:
    """Project-marker file names of the snapshot, by directory ("" for the repository root)."""
    by_dir: dict[str, list[str]] = {}
    for rel in _changes.list_files(target_dir, mode):
        head, _, name = rel.rpartition("/")
        if name in _ROOT_MARKERS or _is_requirements(name):
            by_dir.setdefault(head, []).append(name)
    return by_dir


def _framework_of(target_dir: str, mode: str | None, directory: str, names: list[str]) -> str:
    """Framework of the project rooted at directory, from its marker files (snapshot content)."""
    if "manage.py" in names:
        return "django"
    found = "generic"
    for name in sorted(names):
        text = _changes.read_file(target_dir, f"{directory}/{name}" if directory else name, mode)
        if text is None:
            continue
        text = text.lower()
        if "django" in text:
            return "django"
        if "fastapi" in text:
            found = "fastapi"
    return found


def _nearest_framework(
    target_dir: str, mode: str | None, filepath: str,
    markers: dict[str, list[str]], cache: dict[str, str],
) -> str:
    """
    Framework of the nearest project root of a repository path: the file's
    directory, then each parent up to the repository root; the first one
    holding a project marker decides (a monorepo part's own manifest wins over
    the root one). Memoized per directory in cache.
    """
    visited: list[str] = []
    current = filepath.rpartition("/")[0]
    framework = "generic"
    while True:
        if current in cache:
            framework = cache[current]
            break
        visited.append(current)
        if current in markers:
            framework = _framework_of(target_dir, mode, current, markers[current])
            break
        if not current:
            break
        current = current.rpartition("/")[0]
    for directory in visited:
        cache[directory] = framework
    return framework


def _package_parts(filepath: str) -> list[str]:
    """Directory segments of a file: the package a relative import resolves against."""
    return [part for part in filepath.replace("\\", "/").split("/")[:-1] if part]


def _imported_modules(node: ast.AST, filepath: str, with_names: bool = True) -> list[str]:
    """
    Every module an import statement reaches, as dotted absolute names.

    `import a, b` yields a and b; `from m import x` yields m and m.x (x may be a
    submodule; only with with_names); relative imports are resolved against
    the file's package path.
    """
    if isinstance(node, ast.Import):
        return [alias.name for alias in node.names]
    if not isinstance(node, ast.ImportFrom):
        return []

    if node.level:
        package = _package_parts(filepath)
        keep = max(0, len(package) - (node.level - 1))
        base = package[:keep]
    else:
        base = []
    if node.module:
        base = base + node.module.split(".")

    modules = [".".join(base)] if base else []
    if not with_names:
        return modules
    for alias in node.names:
        if alias.name != "*":
            modules.append(".".join(base + [alias.name]))
    return modules


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
        for imported in _imported_modules(node, filepath, with_names=False):
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


# Clean Architecture layers: the directory names that mark each one.
_LAYER_DIRS = {
    "domain": ("domain",),
    "application": ("application", "use_cases"),
    "infrastructure": ("infrastructure", "adapters"),
    "routes": ("routes", "api"),
}

# For each layer, the directory names its code must not import from.
_FORBIDDEN = {
    "domain": ("application", "use_cases", "infrastructure", "adapters", "routes", "api"),
    "application": ("infrastructure", "adapters", "routes", "api"),
}

_REASONS = {
    "domain": "Domain layer imports from '{0}' — domain must be framework-independent",
    "application": "Application layer imports from '{0}' — use dependency inversion",
}


def _file_layer(filepath: str) -> str | None:
    """The layer of a file: the first layer (by priority) whose name is a path segment."""
    segments = set(_package_parts(filepath))
    for layer, names in _LAYER_DIRS.items():
        if segments.intersection(names):
            return layer
    return None


def _own_prefix_len(module_parts: list[str], package: list[str]) -> int:
    """Leading segments an imported module shares with the importing file's package."""
    n = 0
    for a, b in zip(module_parts, package):
        if a != b:
            break
        n += 1
    return n


def _check_clean_architecture(
    filepath: str, content: str, tree: ast.Module,
) -> list[dict]:
    """Check Clean Architecture boundary violations for generic Python projects."""
    violations: list[dict] = []

    file_layer = _file_layer(filepath)
    if file_layer not in _FORBIDDEN:
        return violations  # Unknown layer, or one with no outgoing restriction

    package = _package_parts(filepath)
    forbidden = _FORBIDDEN[file_layer]

    for node in ast.walk(tree):
        reported: set[str] = set()
        for imported in _imported_modules(node, filepath):
            parts = imported.split(".")
            # Segments shared with the file's own package (e.g. a root package
            # named `api`) are the file's location, not the imported layer.
            tail = parts[_own_prefix_len(parts, package):]
            for b in forbidden:
                if b in tail and b not in reported:
                    reported.add(b)
                    violations.append({
                        "lineNo": getattr(node, "lineno", 0),
                        "module": imported,
                        "reason": _REASONS[file_layer].format(b),
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

    # Each file is judged by its own project part (Django in backend/, FastAPI in api/, ...).
    markers = _markers_by_dir(dir_path, mode)
    frameworks: dict[str, str] = {}
    violations: dict[str, list[dict]] = {}

    for filepath in files:
        content = _changes.read_file(dir_path, filepath, mode)
        if content is None:
            continue

        try:
            tree = ast.parse(content, filename=filepath)
        except SyntaxError:
            continue

        if _nearest_framework(dir_path, mode, filepath, markers, frameworks) == "django":
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
