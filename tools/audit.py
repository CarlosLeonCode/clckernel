#!/usr/bin/env python3
"""
Modular Audit Orchestrator — Python
Discovers check_*.py and scan_*.py guard scripts at runtime, runs each with
graceful degradation, and generates an English audit report (05-audit-report.md).
Self-contained: uses only Python stdlib.
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import traceback

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

# ── 4 Canonical RDD Lenses Mapping ──────────────────────────────────────────

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
    "check_domain_data": "architecture",
    "check_migrations": "architecture",
    "graphify": "architecture",
    "gentle_ai_review": "architecture",
    # Performance
    "check_db_efficiency": "performance",
    "check_performance": "performance",
    "check_seo": "performance",
    "check_responsive": "performance",
    "check_storybook": "performance",
    "check_test_calendar_sync": "performance",
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


def discover_guards(tools_dir: pathlib.Path) -> list[pathlib.Path]:
    """
    Discover all check_*.py and scan_*.py guard scripts in tools/.
    Excludes audit.py itself. Returns sorted list for deterministic ordering.
    """
    guards: list[pathlib.Path] = []
    for f in sorted(tools_dir.iterdir()):
        if not f.is_file():
            continue
        name = f.name
        if (name.startswith("check_") or name.startswith("scan_") or name.startswith("verify_")) and name.endswith(".py"):
            guards.append(f)
    return guards


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

        # Format violations or findings
        violations = data.get("violations") or data.get("findings") or {}
        if isinstance(violations, dict):
            for filepath, items in violations.items():
                if not isinstance(items, list):
                    continue
                for item in items:
                    loc = f" (line {item.get('lineNo', '')})" if item.get("lineNo") else ""
                    label = item.get("label") or item.get("rule") or item.get("module") or ""
                    msg = item.get("reason") or item.get("message") or ""
                    lines.append(f"- `{filepath}`{loc}: {f'[{label}] ' if label else ''}{msg}")

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
    sections.append("> Segmented across the 4 Canonical Review Lenses (Correctness, Security, Architecture, Performance).")
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

def main(target_dir: str | None = None) -> int:
    """Run all discovered guards and produce the audit report."""
    tools_dir = pathlib.Path(__file__).resolve().parent
    dir_path = target_dir or os.getcwd()

    sdd_dir = find_active_sdd()
    if sdd_dir is None:
        # Create a default SDD dir for the report
        sdds_dir = REPO_ROOT / "sdds"
        sdds_dir.mkdir(parents=True, exist_ok=True)
        sdd_dir = sdds_dir / "audit-run"
        sdd_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nRunning CLC Kernel audit for: {sdd_dir.name}\n")

    guard_paths = discover_guards(tools_dir)

    if not guard_paths:
        print("No guard tools found in tools/. Nothing to audit.")
        return 0

    print(
        f"Discovered {len(guard_paths)} guard(s): "
        + ", ".join(p.stem for p in guard_paths)
        + "\n"
    )

    results: list[dict] = []
    for guard_path in guard_paths:
        result = run_guard(guard_path, dir_path)
        results.append(result)

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
    try:
        target = sys.argv[1] if len(sys.argv) > 1 else None
        sys.exit(main(target))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
