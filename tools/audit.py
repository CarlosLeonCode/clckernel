#!/usr/bin/env python3
"""
Modular Audit Orchestrator — Python
The single place that decides which guards run (sdds/unified-discovery):
`clckernel audit` runs it to write a report, the pre-commit hook runs it with
--hook. Same discovery, same guards, each exactly once:
  - top-level tools/ guards: check_*, scan_*, verify_* or *_guard, .py/.js;
  - every tools/guards/*.py and *.js (project guards).
audit.py runs the .py guards; the .js ones belong to audit.js, unless
tools/audit.js is not installed: then audit.py runs them too, with node.
A top-level guard of this language that defines check() is called in
process; every other guard runs as a process (exit code decides, a JSON
result is optional). A guard listed in the managed registry but missing on
disk fails the run. Without --hook an English report (05-audit-report.md) and
a receipt (audit-receipt.json) are written; --hook writes nothing and prints
one line per guard. Self-contained: uses only Python stdlib.
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
GUARD_STEM = re.compile(r"^(check|scan|verify)_")

# Runs a JS guard that exports a function (module contract) as a process:
# prints its result as JSON and exits with its exitCode.
JS_MODULE_RUNNER = (
    "const p = require('path').resolve(process.argv[1]);"
    "const m = require(p);"
    "const fn = typeof m === 'function' ? m : Object.values(m || {}).find(v => typeof v === 'function');"
    "if (!fn) { console.error('does not export a function'); process.exit(1); }"
    "Promise.resolve(fn(process.cwd())).then(r => {"
    " console.log(JSON.stringify(r)); process.exitCode = (r && r.exitCode) || 0; },"
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

def find_active_sdd(change_name: str | None = None) -> pathlib.Path | None:
    """Find the active SDD directory by name or pick the sole candidate."""
    sdds_dir = REPO_ROOT / "sdds"
    if not sdds_dir.exists():
        return None
    if change_name:
        target = sdds_dir / change_name
        return target if target.is_dir() else None
    candidates = [p for p in sdds_dir.iterdir() if p.is_dir()]
    if len(candidates) == 1:
        return candidates[0]
    return None


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
        "exit_code": 1, "skipped": False, "name": name, "lens": get_lens(name),
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
    exports a function is called through that contract. Lens: the JSON's,
    else the guard name's, else architecture.
    """
    fallback_name = guard_path.stem
    fallback_lens = get_lens(fallback_name)
    runner = PROJECT_GUARD_RUNNERS[guard_path.suffix]
    if guard_path.suffix == ".js" and _exports_module(guard_path):
        args = [runner, "-e", JS_MODULE_RUNNER, str(guard_path)]
    else:
        args = [runner, str(guard_path)]
    try:
        proc = subprocess.run(args, cwd=target_dir, capture_output=True, text=True)
    except OSError as exc:
        return {
            "exit_code": 1, "skipped": False, "name": fallback_name, "lens": fallback_lens,
            "data": {"message": f"Guard crashed: {exc}"},
        }
    exit_code = proc.returncode
    output = (proc.stdout or "") + (proc.stderr or "")
    result = _parse_guard_json(proc.stdout)
    if result is not None:
        data = result.get("data") if isinstance(result.get("data"), dict) else result
        name = result.get("name")
        return {
            "exit_code": exit_code,
            "skipped": exit_code == 0 and bool(result.get("skipped", False)),
            "name": name if isinstance(name, str) and name else fallback_name,
            "lens": result.get("lens") if result.get("lens") in LENSES else fallback_lens,
            "data": data,
            "output": output,
        }
    line = _last_line(proc.stdout) if exit_code == 0 else (_last_line(proc.stderr) or _last_line(proc.stdout))
    return {
        "exit_code": exit_code, "skipped": False, "name": fallback_name, "lens": fallback_lens,
        "data": {"message": line or ("Passed" if exit_code == 0 else f"Exited with code {exit_code}")},
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
                "exit_code": 1, "skipped": False, "name": guard_name,
                "lens": get_lens(guard_name),
                "data": {"message": f"Guard crashed: cannot load module spec for {guard_name}"},
            }

        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        fn = getattr(mod, "check", None)
        if fn is None or not callable(fn):
            return {
                "exit_code": 1, "skipped": False, "name": guard_name,
                "lens": get_lens(guard_name),
                "data": {"message": f"Guard crashed: {guard_name} does not export a check() function"},
            }

        result = fn(target_dir)

        # Normalize result shape
        if not isinstance(result, dict):
            return {
                "exit_code": 1, "skipped": False, "name": guard_name,
                "lens": get_lens(guard_name),
                "data": {"message": f"Guard crashed: {guard_name} returned non-dict: {type(result).__name__}"},
            }

        return {
            "exit_code": result.get("exit_code", 0),
            "skipped": bool(result.get("skipped", False)),
            "name": result.get("name", guard_name),
            "lens": get_lens(guard_name),
            "data": result.get("data", result),
        }

    except Exception as exc:
        # A guard that cannot run must never approve a commit (fail closed).
        return {
            "exit_code": 1, "skipped": False, "name": guard_name,
            "lens": get_lens(guard_name),
            "data": {"message": f"Guard crashed: {exc}"},
        }


# ── Report Generation ────────────────────────────────────────────────────────

def _format_guard_section(name: str, result: dict) -> str:
    """Format a single guard result into a markdown section."""
    lines: list[str] = []
    skipped = result.get("skipped", False)
    exit_code = result.get("exit_code", 0)
    data = result.get("data", {})

    if skipped:
        icon, status = "\u23ed\ufe0f", "SKIPPED"
    elif exit_code == 0:
        icon, status = "\u2705", "PASSED"
    else:
        icon, status = "\u274c", "FAILED"

    title = name.replace("_", " ").title()
    lines.append(f"### {icon} {title} \u2014 {status}")
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
                icon_map = {"unrelated": "\u274c", "warnings": "\u26a0\ufe0f", "authorized": "\u2705"}
                label_map = {"unrelated": "Not in SDD scope", "warnings": "Related warnings", "authorized": "Authorized"}
                lines.append(f"\n{icon_map.get(key, '')} **{label_map.get(key, key)}:**")
                for f in items:
                    lines.append(f"  - `{f}`")

    return "\n".join(lines)


def generate_report(results: list[dict], sdd_dir: pathlib.Path) -> str:
    """Generate the 05-audit-report.md from aggregated guard results grouped by 4 RDD lenses."""
    task_name = sdd_dir.name
    passed = sum(1 for r in results if not r.get("skipped") and r.get("exit_code") == 0)
    failed = sum(1 for r in results if not r.get("skipped") and r.get("exit_code") != 0)
    skipped = sum(1 for r in results if r.get("skipped"))
    total = len(results)

    sections: list[str] = []
    sections.append(f"# Code Audit Report: {task_name}")
    sections.append("")
    sections.append("> **Review-Driven Development (RDD) Report:**")
    sections.append("> Results grouped into 4 lenses (Correctness, Security, Architecture, Performance).")
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
    sections.append(f"| Skipped | {skipped} |")
    sections.append("")
    sections.append("---")
    sections.append("")

    lenses = ["correctness", "security", "architecture", "performance"]
    headers = {
        "correctness": "## 🎯 Correctness Lens",
        "security": "## 🛡️ Security Lens",
        "architecture": "## 🏛️ Architecture Lens",
        "performance": "## ⚡ Performance Lens",
    }

    for lens in lenses:
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
    """Generate an immutable machine-readable audit receipt (audit-receipt.json)."""
    import datetime

    lenses = ["correctness", "security", "architecture", "performance"]
    lens_summary = {}
    has_failure = False

    for lens in lenses:
        lens_results = [r for r in results if r.get("lens") == lens]
        passed = sum(1 for r in lens_results if not r.get("skipped") and r.get("exit_code") == 0)
        failed = sum(1 for r in lens_results if not r.get("skipped") and r.get("exit_code") != 0)
        skipped = sum(1 for r in lens_results if r.get("skipped"))
        if failed > 0:
            has_failure = True
        lens_summary[lens] = {
            "status": "FAILED" if failed > 0 else "PASSED",
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
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
        "verdict": "FAILED" if has_failure else "PASSED",
        "lenses": lens_summary,
        "generator": "clckernel",
        "gentle_ai": {
            "compatible": True,
            "rdd_ready": True,
            "cli_installed": gentle_ai_detected,
        },
    }


# ── Console Summary ──────────────────────────────────────────────────────────

def print_summary(results: list[dict], report_path: pathlib.Path, receipt_path: pathlib.Path | None = None) -> None:
    """Print an educational summary to the terminal."""
    print("\n" + "=" * 65)
    print("  CLC KERNEL — 4-LENS RDD AUDIT SUMMARY")
    print("=" * 65 + "\n")

    lenses = ["correctness", "security", "architecture", "performance"]
    labels = {
        "correctness": "🎯 CORRECTNESS LENS",
        "security": "🛡️ SECURITY LENS",
        "architecture": "🏛️ ARCHITECTURE LENS",
        "performance": "⚡ PERFORMANCE LENS",
    }

    for lens in lenses:
        lens_results = [r for r in results if r.get("lens") == lens]
        print(f"  {labels[lens]}:")
        if not lens_results:
            print("     — No guards active for this lens")
        else:
            for result in lens_results:
                skipped = result.get("skipped", False)
                exit_code = result.get("exit_code", 0)
                name = result.get("name", "unknown").replace("_", " ")
                msg = result.get("data", {}).get("message", "Passed" if exit_code == 0 else "Failed")
                icon = "⏭️" if skipped else ("✅" if exit_code == 0 else "❌")
                print(f"     {icon} {name}: {msg}")
        print("")

    print(f"📄 Full report: {report_path}")
    if receipt_path:
        print(f"🧾 Audit receipt: {receipt_path}")
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
    results: list[dict] = []
    for entry in plan:
        if entry["mode"] == "missing":
            results.append(_missing_guard_result(entry))
        elif entry["mode"] == "module":
            results.append(run_guard(entry["file"], dir_path))
        else:
            results.append(run_project_guard(entry["file"], dir_path))
    return results


def _print_hook_summary(results: list[dict]) -> None:
    """--hook output: one line per guard; a failed one also prints its violations or raw output."""
    for result in results:
        skipped = result.get("skipped", False)
        exit_code = result.get("exit_code", 0)
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        status = "skip" if skipped else ("ok  " if exit_code == 0 else "FAIL")
        print(f"clckernel: {status} {result.get('name', 'unknown')}: {data.get('message', '')}")
        if skipped or exit_code == 0:
            continue
        details = _violation_lines(data) or [l for l in (result.get("output") or "").rstrip().split("\n") if l]
        for line in details:
            print(f"    {line}")


def main(target_dir: str | None = None, hook: bool = False) -> int:
    """Run all discovered guards; without --hook also write the report and receipt."""
    tools_dir = pathlib.Path(__file__).resolve().parent
    dir_path = target_dir or os.getcwd()
    plan = plan_guards(tools_dir)

    if hook:
        results = _run_plan(plan, dir_path)
        sys.stdout.flush()
        _print_hook_summary(results)
        return 1 if any(not r.get("skipped") and r.get("exit_code", 0) != 0 for r in results) else 0

    sdd_dir = find_active_sdd()
    if sdd_dir is None:
        # Create a default SDD dir for the report
        sdds_dir = REPO_ROOT / "sdds"
        sdds_dir.mkdir(parents=True, exist_ok=True)
        sdd_dir = sdds_dir / "audit-run"
        sdd_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nRunning CLC Kernel audit for: {sdd_dir.name}\n")

    if not plan:
        print("No guard tools found in tools/. Nothing to audit.")
        return 0

    names = [os.path.splitext(e["label"])[0] if e["label"].endswith(OWN_EXT) else e["label"] for e in plan]
    print(f"Discovered {len(names)} guard(s): " + ", ".join(names) + "\n")

    results = _run_plan(plan, dir_path)

    # Generate and write report
    report_content = generate_report(results, sdd_dir)
    report_path = sdd_dir / "05-audit-report.md"
    report_path.write_text(report_content, encoding="utf-8")

    # Generate and write receipt
    receipt = generate_receipt(results, dir_path)
    receipt_path = sdd_dir / "audit-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")

    # Print summary
    print_summary(results, report_path, receipt_path)

    # Exit with failure if any guard failed (not skipped)
    has_failure = any(
        not r.get("skipped") and r.get("exit_code", 0) != 0
        for r in results
    )
    return 1 if has_failure else 0


if __name__ == "__main__":
    # argv: [target_dir] [--hook], in any order. Any crash fails closed.
    try:
        args = sys.argv[1:]
        target = next((a for a in args if not a.startswith("--")), None)
        sys.exit(main(target, hook="--hook" in args))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
