#!/usr/bin/env python3
"""
Modular Audit Orchestrator — Python
The single place that decides which guards run (sdds/unified-discovery):
`clckernel audit` and agents run it, the pre-commit hook runs it with --hook.
Same discovery, same guards, each exactly once:
  - top-level tools/ guards: check_*, scan_*, verify_* or *_guard, .py/.js;
  - every tools/guards/*.py and *.js (project guards).
audit.py runs the .py guards; the .js ones belong to audit.js, unless
tools/audit.js is not installed: then audit.py runs them too, with node.
A top-level guard of this language that defines check() is called in
process; every other guard runs as a process (exit code decides, a JSON
result is optional). A guard listed in the managed registry but missing on
disk fails the run. Results are grouped into 4 lenses.

CLI (sdds/audit-cli): audit.py [targetDir] [--hook] [--change <name>] [--staged]
  (none)           print the 4-lens summary; write nothing
  --change <name>  also write sdds/<name>/05-audit-report.md and
                   audit-receipt.json (<name>: one safe path segment)
  --hook           one line per guard; write nothing (not with --change)
  --staged         the default snapshot, spelled out: the staged changes, or
                   the last commit when nothing is staged (_changes)
Unknown input exits 2. A failing guard whose level is 'warning' (its result's
`level`, overridden by `severities` in .clckernel.yaml) is reported but does
not fail the run; a guard that crashes always does. Self-contained: Python
stdlib plus the sibling _config.py (optional).
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import traceback

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
LENSES = ("correctness", "security", "architecture", "performance")
PROJECT_GUARD_RUNNERS = {".py": sys.executable or "python3", ".js": "node"}
OWN_EXT = ".py"
SIBLING_EXT, SIBLING_ORCHESTRATOR = ".js", "audit.js"
REGISTRY_FILE = ".clckernel-managed.json"
USAGE = "usage: audit.py [targetDir] [--hook] [--change <name>] [--staged]"
CHANGE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
GUARD_STEM = re.compile(r"^(check|scan|verify)_")

# Runs a JS guard that exports a function (module contract) as a process:
# prints its result as JSON and exits with its exitCode.
JS_MODULE_RUNNER = (
    "const p = require('path').resolve(process.argv[1]);"
    "const m = require(p);"
    "const fn = typeof m === 'function' ? m : Object.values(m || {}).find(v => typeof v === 'function');"
    "if (!fn) { console.error('does not export a function'); process.exit(1); }"
    "Promise.resolve(fn(process.cwd())).then(r => {"
    " if (!r || typeof r !== 'object') { console.error('returned ' + (r === null ? 'null' : typeof r)); process.exitCode = 1; return; }"
    " console.log(JSON.stringify(r)); process.exitCode = r.exitCode || 0; },"
    " e => { console.error(e && e.message); process.exitCode = 1; });"
)

# ── Static name → lens mapping (4 RDD lenses) ──────────────────────────────────────────

LENS_MAP = {
    # Correctness
    "verify_tdd": "correctness",
    "check_scope": "correctness",
    "check_a11y": "correctness",
    "check_api_contracts": "correctness",
    "check_openapi_drift": "correctness",
    "pytest": "correctness",
    "tsc": "correctness",
    "lint": "correctness",
    "ruff": "correctness",
    "check_skills": "correctness",
    "check_links": "correctness",
    "check_placeholders": "correctness",
    "check_data_files": "correctness",
    # Security
    "scan_secrets": "security",
    "docker_guard": "security",
    "redis_guard": "security",
    "celery_guard": "security",
    "postgres_guard": "security",
    # Architecture
    "check_architecture": "architecture",
    "check_custom": "architecture",
    "check_ui_reuse": "architecture",
    "check_symlinks": "architecture",
    "check_hitl": "architecture",
    "check_migrations": "architecture",
    "graphify": "architecture",
    "gentle_ai_review": "architecture",
    # Performance
    "check_db_efficiency": "performance",
    "check_performance": "performance",
    "check_seo": "performance",
    "check_responsive": "performance",
    "check_storybook": "performance",
    "check_observability": "performance",
}

def get_lens(guard_name: str) -> str:
    return LENS_MAP.get(guard_name, "architecture")


# ── Helpers ──────────────────────────────────────────────────────────────────

def is_guard_file(name: str) -> bool:
    """A top-level guard file name: check_*, scan_*, verify_* or *_guard, .py or .js."""
    stem, ext = os.path.splitext(name)
    if ext not in (".py", ".js"):
        return False
    return bool(GUARD_STEM.match(stem)) or stem.endswith("_guard")


def _regular_files(directory: pathlib.Path) -> list[pathlib.Path]:
    if not directory.is_dir():
        return []
    return sorted((f for f in directory.iterdir() if f.is_file()), key=lambda f: f.name)


def discover_guards(tools_dir: pathlib.Path) -> list[pathlib.Path]:
    """
    Top-level guards of this orchestrator's language (.py) in tools/,
    alphabetical: check_*, scan_*, verify_* and *_guard (technology guards
    such as docker_guard.py). Helpers (_*) and audit.py never match.
    """
    return [f for f in _regular_files(tools_dir) if is_guard_file(f.name) and f.suffix == OWN_EXT]


def discover_project_guards(tools_dir: pathlib.Path) -> list[pathlib.Path]:
    """
    Project guards (sdds/domain-agnostic, decision 3): every *.py and *.js
    file in tools/guards/, alphabetical.
    """
    return [f for f in _regular_files(tools_dir / "guards") if f.suffix in PROJECT_GUARD_RUNNERS]


def registered_paths(tools_dir: pathlib.Path) -> list[str]:
    """Paths the managed registry lists, in either format (list, or {files: [{path}]})."""
    try:
        data = json.loads((tools_dir / REGISTRY_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if isinstance(data, list):
        entries = data
    elif isinstance(data, dict) and isinstance(data.get("files"), list):
        entries = [f.get("path") for f in data["files"] if isinstance(f, dict)]
    else:
        entries = []
    return [p for p in entries if isinstance(p, str)]


def _defines_check(path: pathlib.Path) -> bool:
    try:
        return re.search(r"^def check\s*\(", path.read_text(encoding="utf-8"), re.M) is not None
    except (OSError, UnicodeDecodeError):
        return False


def _exports_module(path: pathlib.Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return False
    return re.search(r"\bmodule\.exports\b|^\s*exports\.[\w$]+\s*=", text, re.M) is not None


def plan_guards(tools_dir: pathlib.Path) -> list[dict]:
    """
    The guards this orchestrator runs (sdds/unified-discovery), in order:
    top-level guards, then tools/guards/*. mode 'module' = a top-level .py
    guard that defines check(): called in process; 'process' = any other
    guard of a language this orchestrator owns (.py, plus .js when
    tools/audit.js is not installed); 'missing' = registered, not on disk.
    """
    exts = {OWN_EXT}
    if not (tools_dir / SIBLING_ORCHESTRATOR).exists():
        exts.add(SIBLING_EXT)
    plan: list[dict] = []
    top = [f for f in _regular_files(tools_dir) if is_guard_file(f.name) and f.suffix in exts]
    for f in top:
        module = f.suffix == OWN_EXT and _defines_check(f)
        plan.append({"file": f, "label": f.name, "mode": "module" if module else "process"})
    for f in discover_project_guards(tools_dir):
        if f.suffix in exts:
            plan.append({"file": f, "label": f"guards/{f.name}", "mode": "process"})
    present = {f.name for f in top}
    for rel in registered_paths(tools_dir):
        if not rel.startswith("tools/"):
            continue
        name = rel[len("tools/"):]
        if "/" in name or not is_guard_file(name) or os.path.splitext(name)[1] not in exts or name in present:
            continue
        plan.append({"file": tools_dir / name, "label": name, "mode": "missing"})
    return plan


def _missing_guard_result(entry: dict) -> dict:
    name = os.path.splitext(entry["label"])[0]
    return {
        "exit_code": 1, "skipped": False, "crashed": True, "name": name, "lens": get_lens(name),
        "data": {"message": (
            f"Kernel guard missing: tools/{entry['label']} is listed in tools/{REGISTRY_FILE} "
            "but not on disk; restore it with `clckernel update`"
        )},
    }


def _parse_guard_json(stdout: str):
    """The guard's JSON result when its stdout (or its last line) is a JSON object."""
    text = (stdout or "").strip()
    for candidate in (text, text.split("\n")[-1]):
        try:
            value = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    return None


def _last_line(text: str) -> str:
    lines = [line.strip() for line in (text or "").split("\n") if line.strip()]
    return lines[-1] if lines else ""


def run_project_guard(guard_path: pathlib.Path, target_dir: str) -> dict:
    """
    Run one guard as a process with cwd = target_dir. The exit code decides
    (non-zero fails); a JSON result with the standard shape
    ({name, skipped, lens?, data: {message, violations}}) is used for the
    report, plain output is reported by its last line. A .js guard that
    exports a function is called through that contract; when it exits
    non-zero without a JSON result it crashed. Lens: the JSON's, else the
    guard name's, else architecture; level: the JSON's `level`.
    """
    fallback_name = guard_path.stem
    fallback_lens = get_lens(fallback_name)
    runner = PROJECT_GUARD_RUNNERS[guard_path.suffix]
    module_contract = guard_path.suffix == ".js" and _exports_module(guard_path)
    if module_contract:
        args = [runner, "-e", JS_MODULE_RUNNER, str(guard_path)]
    else:
        args = [runner, str(guard_path)]
    try:
        proc = subprocess.run(args, cwd=target_dir, capture_output=True, text=True)
    except OSError as exc:
        return {
            "exit_code": 1, "skipped": False, "crashed": True, "name": fallback_name, "lens": fallback_lens,
            "data": {"message": f"Guard crashed: {exc}"},
        }
    exit_code = proc.returncode
    output = (proc.stdout or "") + (proc.stderr or "")
    if exit_code < 0:
        return {
            "exit_code": 1, "skipped": False, "crashed": True, "name": fallback_name, "lens": fallback_lens,
            "data": {"message": f"Guard crashed: killed by signal {-exit_code}"},
            "output": output,
        }
    result = _parse_guard_json(proc.stdout)
    if result is not None:
        data = result.get("data") if isinstance(result.get("data"), dict) else result
        name = result.get("name")
        return {
            "exit_code": exit_code,
            "skipped": exit_code == 0 and bool(result.get("skipped", False)),
            "crashed": False,
            "level": result.get("level"),
            "name": name if isinstance(name, str) and name else fallback_name,
            "lens": result.get("lens") if result.get("lens") in LENSES else fallback_lens,
            "data": data,
            "output": output,
        }
    line = _last_line(proc.stdout) if exit_code == 0 else (_last_line(proc.stderr) or _last_line(proc.stdout))
    crashed = module_contract and exit_code != 0
    if crashed:
        message = f"Guard crashed: {line or f'exited with code {exit_code}'}"
    else:
        message = line or ("Passed" if exit_code == 0 else f"Exited with code {exit_code}")
    return {
        "exit_code": exit_code, "skipped": False, "crashed": crashed, "name": fallback_name, "lens": fallback_lens,
        "data": {"message": message},
        "output": output,
    }


def run_guard(guard_path: pathlib.Path, target_dir: str) -> dict:
    """
    Run a single guard module by dynamic import and call its check() function.
    Returns a normalized result dict on success, or a FAILED result if it cannot run.
    """
    guard_name = guard_path.stem  # e.g. "check_scope"

    try:
        spec = importlib.util.spec_from_file_location(guard_name, str(guard_path))
        if spec is None or spec.loader is None:
            return {
                "exit_code": 1, "skipped": False, "crashed": True, "name": guard_name,
                "lens": get_lens(guard_name),
                "data": {"message": f"Guard crashed: cannot load module spec for {guard_name}"},
            }

        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        fn = getattr(mod, "check", None)
        if fn is None or not callable(fn):
            return {
                "exit_code": 1, "skipped": False, "crashed": True, "name": guard_name,
                "lens": get_lens(guard_name),
                "data": {"message": f"Guard crashed: {guard_name} does not export a check() function"},
            }

        result = fn(target_dir)

        # Normalize result shape
        if not isinstance(result, dict):
            return {
                "exit_code": 1, "skipped": False, "crashed": True, "name": guard_name,
                "lens": get_lens(guard_name),
                "data": {"message": f"Guard crashed: {guard_name} returned non-dict: {type(result).__name__}"},
            }

        return {
            "exit_code": result.get("exit_code", 0),
            "skipped": bool(result.get("skipped", False)),
            "crashed": False,
            "level": result.get("level"),
            "name": result.get("name", guard_name),
            "lens": get_lens(guard_name),
            "data": result.get("data", result),
        }

    except Exception as exc:
        # A guard that cannot run must never approve a commit (fail closed).
        return {
            "exit_code": 1, "skipped": False, "crashed": True, "name": guard_name,
            "lens": get_lens(guard_name),
            "data": {"message": f"Guard crashed: {exc}"},
        }


# ── Result levels (sdds/audit-cli) ───────────────────────────────────────────

def _is_failed(r: dict) -> bool:
    """A guard that ran and did not pass (skipped guards never fail)."""
    return not r.get("skipped") and r.get("exit_code", 0) != 0


def _is_warning(r: dict) -> bool:
    """A failure reported but not blocking: effective level 'warning'."""
    return _is_failed(r) and r.get("level") == "warning"


def _is_blocking(r: dict) -> bool:
    """A failure that fails the run."""
    return _is_failed(r) and r.get("level") != "warning"


def apply_levels(results: list[dict], severities: dict | None = None) -> list[dict]:
    """
    Set each result's effective level: severities[name] (or [file stem]) from
    .clckernel.yaml, else the guard's own `level` ('warning' only), else
    'error'. A crash is always 'error' (fail closed).
    """
    severities = severities or {}
    for result in results:
        level = "warning" if result.get("level") == "warning" else "error"
        name, stem = result.get("name"), result.get("stem")
        if isinstance(name, str) and name in severities:
            level = severities[name]
        elif isinstance(stem, str) and stem in severities:
            level = severities[stem]
        result["level"] = "error" if result.get("crashed") else level
    return results


def _status_of(result: dict) -> tuple:
    if result.get("skipped"):
        return "⏭️", "SKIPPED"
    if not _is_failed(result):
        return "✅", "PASSED"
    return ("⚠️", "WARNING") if _is_warning(result) else ("❌", "FAILED")


def _verdict_of(results: list[dict]) -> str:
    """FAILED on a blocking failure, PASSED_WITH_WARNINGS on warnings only."""
    if any(_is_blocking(r) for r in results):
        return "FAILED"
    return "PASSED_WITH_WARNINGS" if any(_is_warning(r) for r in results) else "PASSED"


def _message(result: dict, default: str = "") -> str:
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    return data.get("message") or default


# ── Report Generation ────────────────────────────────────────────────────────

def _format_guard_section(name: str, result: dict) -> str:
    """Format a single guard result into a markdown section."""
    lines: list[str] = []
    skipped = result.get("skipped", False)
    exit_code = result.get("exit_code", 0)
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    icon, status = _status_of(result)

    title = name.replace("_", " ").title()
    lines.append(f"### {icon} {title} — {status}")
    lines.append("")

    if skipped:
        lines.append(f"> Skipped: {data.get('message', 'Dependencies not available')}")
    elif exit_code == 0:
        lines.append(f"> {data.get('message', 'All checks passed')}")
    else:
        lines.append(f"> {data.get('message', 'Issues found')}")
        lines.append("")

        lines.extend(_violation_lines(data))

        # Handle list-style data (e.g. scope unauthorized files)
        for key in ("unrelated", "warnings", "authorized"):
            items = data.get(key, [])
            if isinstance(items, list) and items:
                icon_map = {"unrelated": "❌", "warnings": "⚠️", "authorized": "✅"}
                label_map = {"unrelated": "Not in SDD scope", "warnings": "Related warnings", "authorized": "Authorized"}
                lines.append(f"\n{icon_map.get(key, '')} **{label_map.get(key, key)}:**")
                for f in items:
                    lines.append(f"  - `{f}`")

    return "\n".join(lines)


def generate_report(results: list[dict], sdd_dir: pathlib.Path) -> str:
    """Generate the 05-audit-report.md from aggregated guard results grouped by 4 RDD lenses."""
    task_name = sdd_dir.name
    passed = sum(1 for r in results if not r.get("skipped") and r.get("exit_code") == 0)
    failed = sum(1 for r in results if _is_blocking(r))
    warnings = [r for r in results if _is_warning(r)]
    skipped = sum(1 for r in results if r.get("skipped"))
    total = len(results)

    sections: list[str] = []
    sections.append(f"# Code Audit Report: {task_name}")
    sections.append("")
    sections.append("> **Review-Driven Development (RDD) Report:**")
    sections.append("> Results grouped into 4 lenses (Correctness, Security, Architecture, Performance).")
    sections.append("")
    sections.append(f"**Verdict:** {_verdict_of(results)}")
    sections.append("")
    sections.append("---")
    sections.append("")
    sections.append("## Summary")
    sections.append("")
    sections.append("| Metric | Count |")
    sections.append("|--------|-------|")
    sections.append(f"| Total guards | {total} |")
    sections.append(f"| Passed | {passed} |")
    sections.append(f"| Failed | {failed} |")
    sections.append(f"| Warnings | {len(warnings)} |")
    sections.append(f"| Skipped | {skipped} |")
    sections.append("")
    sections.append("---")
    sections.append("")

    if warnings:
        sections.append("## ⚠️ Warnings")
        sections.append("")
        sections.append("_Failed, but not blocking (level `warning`)._")
        sections.append("")
        for r in warnings:
            sections.append(f"- **{r.get('name', 'unknown')}** [{str(r.get('lens', 'architecture')).upper()}]: {_message(r, 'Issues found')}")
        sections.append("")
        sections.append("---")
        sections.append("")

    headers = {
        "correctness": "## 🎯 Correctness Lens",
        "security": "## 🛡️ Security Lens",
        "architecture": "## 🏛️ Architecture Lens",
        "performance": "## ⚡ Performance Lens",
    }

    for lens in LENSES:
        sections.append(headers[lens])
        sections.append("")
        lens_results = [r for r in results if r.get("lens") == lens]
        if not lens_results:
            sections.append("_No guards registered for this lens._\n")
        else:
            for result in lens_results:
                sections.append(_format_guard_section(result.get("name", "unknown"), result))
                sections.append("")
        sections.append("---")
        sections.append("")

    return "\n".join(sections)


def generate_receipt(results: list[dict], target_dir: str) -> dict:
    """
    Generate an immutable machine-readable audit receipt (audit-receipt.json).
    verdict: FAILED | PASSED_WITH_WARNINGS | PASSED; `failed` counts blocking
    failures, `warnings` the non-blocking ones (listed in `warnings`).
    """
    import datetime

    lens_summary = {}
    for lens in LENSES:
        lens_results = [r for r in results if r.get("lens") == lens]
        lens_summary[lens] = {
            "status": _verdict_of(lens_results),
            "passed": sum(1 for r in lens_results if not r.get("skipped") and r.get("exit_code") == 0),
            "failed": sum(1 for r in lens_results if _is_blocking(r)),
            "warnings": sum(1 for r in lens_results if _is_warning(r)),
            "skipped": sum(1 for r in lens_results if r.get("skipped")),
        }

    commit_hash = "UNKNOWN"
    try:
        commit_hash = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=target_dir,
            stderr=subprocess.DEVNULL,
            encoding="utf-8"
        ).strip()
    except Exception:
        pass

    import shutil
    gentle_ai_detected = shutil.which("gentle-ai") is not None

    return {
        "$schema": "https://clckernel.dev/schemas/audit-receipt.v1.json",
        "contract": "clckernel.audit-receipt/v1",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "commitHash": commit_hash,
        "verdict": _verdict_of(results),
        "lenses": lens_summary,
        "warnings": [
            {"name": r.get("name", "unknown"), "lens": r.get("lens", "architecture"), "message": _message(r)}
            for r in results if _is_warning(r)
        ],
        "generator": "clckernel",
        "gentle_ai": {
            "compatible": True,
            "rdd_ready": True,
            "cli_installed": gentle_ai_detected,
        },
    }


# ── Console Summary ──────────────────────────────────────────────────────────

def print_summary(results: list[dict], report_path: pathlib.Path | None = None,
                  receipt_path: pathlib.Path | None = None) -> None:
    """
    Print the 4-lens summary. report_path/receipt_path: where they were
    written, or None when no --change was given (then a hint says how).
    """
    print("\n" + "=" * 65)
    print("  CLC KERNEL — 4-LENS RDD AUDIT SUMMARY")
    print("=" * 65 + "\n")

    labels = {
        "correctness": "🎯 CORRECTNESS LENS",
        "security": "🛡️ SECURITY LENS",
        "architecture": "🏛️ ARCHITECTURE LENS",
        "performance": "⚡ PERFORMANCE LENS",
    }

    for lens in LENSES:
        lens_results = [r for r in results if r.get("lens") == lens]
        print(f"  {labels[lens]}:")
        if not lens_results:
            print("     — No guards active for this lens")
        else:
            for result in lens_results:
                exit_code = result.get("exit_code", 0)
                name = result.get("name", "unknown").replace("_", " ")
                msg = _message(result, "Passed" if exit_code == 0 else "Failed")
                icon, _ = _status_of(result)
                print(f"     {icon} {name}: {msg}")
        print("")

    print(f"Verdict: {_verdict_of(results)}")
    if report_path:
        print(f"📄 Full report: {report_path}")
        if receipt_path:
            print(f"🧾 Audit receipt: {receipt_path}")
    else:
        print("No report written: pass --change <name> to write sdds/<name>/05-audit-report.md and audit-receipt.json.")
    print("=" * 65 + "\n")


# ── Main ─────────────────────────────────────────────────────────────────────

def _violation_lines(data: dict) -> list[str]:
    """One bullet per violation (or finding) of a failed guard."""
    lines: list[str] = []
    violations = data.get("violations") or data.get("findings") or {}
    if isinstance(violations, list):
        for item in violations:
            if isinstance(item, dict):
                where = f"`{item['file']}`: " if item.get("file") else ""
                lines.append(f"- {where}{item.get('message') or item.get('reason') or json.dumps(item)}")
        return lines
    if isinstance(violations, dict):
        for filepath, items in violations.items():
            for item in items if isinstance(items, list) else []:
                if not isinstance(item, dict):
                    continue
                loc = f" (line {item.get('lineNo')})" if item.get("lineNo") else ""
                label = item.get("label") or item.get("rule") or item.get("module") or ""
                msg = item.get("reason") or item.get("message") or ""
                lines.append(f"- `{filepath}`{loc}: {f'[{label}] ' if label else ''}{msg}")
    return lines


def _run_plan(plan: list[dict], dir_path: str) -> list[dict]:
    """Run every planned guard once, in plan order; each result keeps its file stem."""
    results: list[dict] = []
    for entry in plan:
        if entry["mode"] == "missing":
            result = _missing_guard_result(entry)
        elif entry["mode"] == "module":
            result = run_guard(entry["file"], dir_path)
        else:
            result = run_project_guard(entry["file"], dir_path)
        result["stem"] = pathlib.Path(entry["file"]).stem
        results.append(result)
    return results


def _print_hook_summary(results: list[dict]) -> None:
    """--hook output: one line per guard (ok, skip, WARN, FAIL); a failed one also prints its violations or raw output."""
    for result in results:
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        if result.get("skipped"):
            status = "skip"
        elif not _is_failed(result):
            status = "ok  "
        else:
            status = "WARN" if _is_warning(result) else "FAIL"
        print(f"clckernel: {status} {result.get('name', 'unknown')}: {data.get('message', '')}")
        if not _is_failed(result):
            continue
        details = _violation_lines(data) or [l for l in (result.get("output") or "").rstrip().split("\n") if l]
        for line in details:
            print(f"    {line}")


def _load_severities(dir_path: str) -> dict:
    """
    `severities` from the project's .clckernel.yaml, read with the sibling
    _config.py; {} when that module is not installed. An invalid config raises.
    """
    tools_dir = str(pathlib.Path(__file__).resolve().parent)
    if not (pathlib.Path(tools_dir) / "_config.py").is_file():
        return {}
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
    import _config  # noqa: E402
    return _config.load_config(dir_path)["config"].get("severities") or {}


def main(target_dir: str | None = None, hook: bool = False, change: str | None = None) -> int:
    """
    Run all discovered guards. hook: one line per guard; change: also write the
    report and receipt to sdds/<change>/. Returns 1 when a guard failed with
    level error, else 0.
    """
    tools_dir = pathlib.Path(__file__).resolve().parent
    dir_path = os.path.abspath(target_dir or os.getcwd())
    plan = plan_guards(tools_dir)

    try:
        severities = _load_severities(dir_path)
    except ValueError as exc:  # _config.ConfigError
        print(f"clckernel: {exc}", file=sys.stderr)
        return 1

    if hook:
        results = apply_levels(_run_plan(plan, dir_path), severities)
        sys.stdout.flush()
        _print_hook_summary(results)
        return 1 if any(_is_blocking(r) for r in results) else 0

    print("\nRunning CLC Kernel audit...\n")

    if not plan:
        print("No guard tools found in tools/. Nothing to audit.")
        return 0

    names = [os.path.splitext(e["label"])[0] if e["label"].endswith(OWN_EXT) else e["label"] for e in plan]
    print(f"Discovered {len(names)} guard(s): " + ", ".join(names) + "\n")

    results = apply_levels(_run_plan(plan, dir_path), severities)
    sys.stdout.flush()

    report_path = receipt_path = None
    if change:
        sdd_dir = pathlib.Path(dir_path) / "sdds" / change
        sdd_dir.mkdir(parents=True, exist_ok=True)
        report_path = sdd_dir / "05-audit-report.md"
        report_path.write_text(generate_report(results, sdd_dir), encoding="utf-8")
        receipt_path = sdd_dir / "audit-receipt.json"
        receipt_path.write_text(json.dumps(generate_receipt(results, dir_path), indent=2) + "\n", encoding="utf-8")

    print_summary(results, report_path, receipt_path)

    return 1 if any(_is_blocking(r) for r in results) else 0


def parse_args(argv: list[str]) -> dict:
    """
    argv: [targetDir] [--hook] [--change <name>] [--staged], in any order.
    Returns {target_dir, hook, change, staged}, or {error} on invalid input.
    """
    out = {"target_dir": None, "hook": False, "change": None, "staged": False}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--hook":
            out["hook"] = True
        elif arg == "--staged":
            out["staged"] = True
        elif arg == "--change":
            if i + 1 >= len(argv):
                return {"error": "--change needs a name"}
            i += 1
            name = argv[i]
            if not CHANGE_NAME.match(name):
                return {"error": f"invalid --change name {json.dumps(name)}: use one path segment (letters, digits, ., _, -)"}
            out["change"] = name
        elif arg.startswith("-"):
            return {"error": f"unknown option {arg}"}
        elif out["target_dir"] is not None:
            return {"error": f"unexpected argument {arg}"}
        else:
            out["target_dir"] = arg
        i += 1
    if out["hook"] and out["change"]:
        return {"error": "--hook writes nothing; it cannot be combined with --change"}
    return out


if __name__ == "__main__":
    # Unknown input exits 2. Any crash fails closed.
    parsed = parse_args(sys.argv[1:])
    if "error" in parsed:
        print(f"audit.py: {parsed['error']}\n{USAGE}", file=sys.stderr)
        sys.exit(2)
    try:
        sys.exit(main(parsed["target_dir"], hook=parsed["hook"], change=parsed["change"]))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
