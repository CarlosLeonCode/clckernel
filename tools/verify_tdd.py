#!/usr/bin/env python3
"""
Red -> Green TDD Verifier (pytest)

Proves that a change to Python production code ships with tests that
FAIL without the change (red) and PASS with it (green).

Two trees are compared:
  - something staged:  BASE = HEAD,   CANDIDATE = the index (staged content)
  - nothing staged:    BASE = HEAD~1, CANDIDATE = HEAD
Both trees are materialized from git into temporary directories, so the
working copy is never evaluated and the caller's index/HEAD/worktree are
never touched.

Self-contained: Python 3.9+ standard library only.
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile

NAME = "verify_tdd"
DEFAULT_TIMEOUT = 300
OUTPUT_TAIL_LINES = 40
TEST_DIRS = {"tests", "test"}
# Collected test-support files: overlaid on BASE, never passed to pytest.
SUPPORT_NAMES = {"conftest.py", "__init__.py"}


class GitError(Exception):
    """Raised when a git command fails."""


def _git(repo: str, *args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], cwd=repo, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise GitError(str(exc)) from exc


def _rev_exists(repo: str, rev: str) -> bool:
    try:
        _git(repo, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}")
        return True
    except GitError:
        return False


def _empty_tree(repo: str) -> str:
    return _git(repo, "hash-object", "-t", "tree", os.devnull).strip()


def _lines(out: str) -> list[str]:
    return [line.strip() for line in out.splitlines() if line.strip()]


def _resolve_trees(repo: str) -> dict | None:
    """Pick BASE/CANDIDATE and list the changed files (deletions ignored)."""
    has_head = _rev_exists(repo, "HEAD")
    head_or_empty = "HEAD" if has_head else _empty_tree(repo)

    if _lines(_git(repo, "diff", "--cached", "--name-only", head_or_empty)):
        changed = _git(repo, "diff", "--cached", "--name-only", "--diff-filter=ACMR", head_or_empty)
        return {"mode": "staged", "base": head_or_empty if has_head else None,
                "candidate": None, "changed": _lines(changed)}

    if not has_head:
        return None
    base = "HEAD~1" if _rev_exists(repo, "HEAD~1") else None
    changed = _git(repo, "diff", "--name-only", "--diff-filter=ACMR",
                   base or _empty_tree(repo), "HEAD")
    return {"mode": "manual", "base": base, "candidate": "HEAD", "changed": _lines(changed)}


def _is_test_path(rel: str) -> bool:
    parts = pathlib.PurePosixPath(rel).parts
    name = parts[-1]
    return (
        name.startswith("test_")
        or name.endswith("_test.py")
        or any(part in TEST_DIRS for part in parts[:-1])
    )


def _classify(changed: list[str]) -> dict:
    tests: list[str] = []
    support: list[str] = []
    code: list[str] = []
    for rel in changed:
        if not rel.endswith(".py"):
            continue
        name = pathlib.PurePosixPath(rel).name
        if name == "conftest.py":
            support.append(rel)
        elif _is_test_path(rel):
            (support if name in SUPPORT_NAMES else tests).append(rel)
        else:
            code.append(rel)
    return {"tests": tests, "support": support, "code": code}


def _materialize(repo: str, rev: str | None, dest: str) -> None:
    """Write a tree into dest: the index when rev is None, else a commit."""
    if rev is None:
        _git(repo, "checkout-index", "-a", f"--prefix={dest.rstrip(os.sep)}{os.sep}")
        return
    proc = subprocess.Popen(
        ["git", "archive", "--format=tar", rev], cwd=repo,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    root = os.path.realpath(dest)
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
            for member in tar:
                target = os.path.realpath(os.path.join(root, member.name))
                if target != root and not target.startswith(root + os.sep):
                    raise GitError(f"unsafe path in archive: {member.name}")
                if hasattr(tarfile, "data_filter"):
                    tar.extract(member, root, filter="data")
                else:
                    tar.extract(member, root)
    finally:
        if proc.stdout:
            proc.stdout.close()
        stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        if proc.wait() != 0:
            raise GitError(f"git archive {rev} failed: {stderr.strip()}")


def _overlay(src_root: str, dest_root: str, files: list[str]) -> None:
    for rel in files:
        dest = os.path.join(dest_root, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(os.path.join(src_root, rel), dest)


def _timeout() -> float:
    try:
        value = float(os.environ.get("CLC_TDD_TIMEOUT", DEFAULT_TIMEOUT))
        return value if value > 0 else DEFAULT_TIMEOUT
    except ValueError:
        return DEFAULT_TIMEOUT


def _tail(text: str) -> str:
    return "\n".join(text.splitlines()[-OUTPUT_TAIL_LINES:])


def _run_pytest(tree: str, tests: list[str]) -> dict:
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    # Put the materialized tree ahead of anything installed (e.g. an editable
    # install pointing at the working copy).
    roots = [tree] + ([os.path.join(tree, "src")] if os.path.isdir(os.path.join(tree, "src")) else [])
    env["PYTHONPATH"] = os.pathsep.join(roots + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else []))
    cmd = [sys.executable, "-m", "pytest", *tests, "-q", "-p", "no:cacheprovider"]
    try:
        proc = subprocess.run(
            cmd, cwd=tree, env=env, timeout=_timeout(),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        return {"exit_code": proc.returncode, "timed_out": False, "output": _tail(proc.stdout)}
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout.decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        return {"exit_code": None, "timed_out": True, "output": _tail(out)}


def _result(exit_code: int, data: dict, skipped: bool = False) -> dict:
    return {"exit_code": exit_code, "skipped": skipped, "name": NAME, "data": data}


def _verify(repo: str, trees: dict, groups: dict, data: dict) -> dict:
    if importlib.util.find_spec("pytest") is None:
        data["message"] = (
            f"pytest is not importable by {sys.executable}: red->green cannot be verified. "
            "Install it with `pip install pytest`."
        )
        return _result(1, data)

    run_files = groups["tests"]
    overlay_files = groups["tests"] + groups["support"]
    with tempfile.TemporaryDirectory(prefix="clc-verify-tdd-") as tmp:
        candidate_dir = os.path.join(tmp, "candidate")
        base_dir = os.path.join(tmp, "base")
        os.makedirs(candidate_dir)
        os.makedirs(base_dir)
        _materialize(repo, trees["candidate"], candidate_dir)
        if trees["base"] is not None:
            _materialize(repo, trees["base"], base_dir)

        green = _run_pytest(candidate_dir, run_files)
        data["green"] = green
        if green["exit_code"] != 0:
            reason = "timed out" if green["timed_out"] else f"pytest exit {green['exit_code']}"
            data["message"] = f"Changed tests do not pass with the change ({reason})."
            return _result(1, data)

        _overlay(candidate_dir, base_dir, overlay_files)
        red = _run_pytest(base_dir, run_files)
        data["red"] = red
        if red["exit_code"] in (1, 2):
            data["message"] = (
                f"TDD red->green verified: {len(run_files)} test file(s) fail without the change "
                f"and pass with it."
            )
            return _result(0, data)
        if red["exit_code"] == 0:
            data["message"] = (
                "Changed tests pass without the change: they do not prove the new behavior."
            )
            return _result(1, data)
        reason = "timed out" if red["timed_out"] else f"pytest exit {red['exit_code']}"
        data["message"] = f"Red run on BASE did not fail cleanly ({reason}); see red output."
        return _result(1, data)


def check(target_dir: str | None = None) -> dict:
    """
    Verify red->green for the current change.

    Returns:
        dict with keys exit_code, skipped, name, data. data includes mode,
        base, candidate, changed_tests, changed_support, changed_code,
        message and, when tests ran, green/red pytest results.
    """
    dir_path = target_dir or os.getcwd()
    try:
        repo = _git(dir_path, "rev-parse", "--show-toplevel").strip()
        trees = _resolve_trees(repo)
    except GitError:
        return _result(0, {"message": "Not a git repository: nothing to verify"}, skipped=True)
    if trees is None:
        return _result(0, {"message": "No commits and nothing staged: nothing to verify"}, skipped=True)

    groups = _classify(trees["changed"])
    data = {
        "mode": trees["mode"],
        "base": trees["base"] or "(empty tree)",
        "candidate": trees["candidate"] or "(index)",
        "changed_tests": groups["tests"],
        "changed_support": groups["support"],
        "changed_code": groups["code"],
    }

    if not groups["code"]:
        if groups["tests"]:
            data["message"] = "Only tests changed: characterization tests allowed."
            data["warning"] = "No production code changed, so red->green was not verified."
        else:
            data["message"] = "No Python production code changed: nothing to verify."
        return _result(0, data)

    if not groups["tests"]:
        data["message"] = (
            f"No test evidence: {len(groups['code'])} Python code file(s) changed "
            "without any changed test file."
        )
        return _result(1, data)

    try:
        return _verify(repo, trees, groups, data)
    except (GitError, OSError) as exc:
        data["message"] = f"Could not materialize the trees to verify: {exc}"
        return _result(1, data)


if __name__ == "__main__":
    result = check(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
