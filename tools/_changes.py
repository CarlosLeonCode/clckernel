"""
Snapshot helpers shared by the diff-based guards (twin of _changes.js).

A guard evaluates exactly the snapshot being verified:
  - "staged":      something is staged (a pre-commit) -> the index
  - "last-commit": nothing staged (a manual run)      -> HEAD, diffed against HEAD~1
                   (a root commit lists every file of HEAD)
  - None:          no git repository / git unavailable
File content always comes from that snapshot, never from the working copy.

Self-contained: Python 3.9+ standard library only. Git runs with argument
lists, never through a shell; paths are read NUL-separated (-z), so spaces and
non-ASCII names survive.
"""
from __future__ import annotations

import os
import subprocess
from typing import Optional

BINARY_PROBE_BYTES = 8000


def _git(cwd: str, *args: str) -> Optional[bytes]:
    """Run git in cwd; stdout bytes on success, None on any failure."""
    try:
        proc = subprocess.run(
            ["git", *args], cwd=cwd,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    except (OSError, ValueError):
        return None
    return proc.stdout if proc.returncode == 0 else None


def _split_nul(out: bytes) -> list:
    return [p for p in out.decode("utf-8", errors="surrogateescape").split("\0") if p]


def _has_commit(cwd: str, rev: str) -> bool:
    return _git(cwd, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}") is not None


def changed_files(target_dir: Optional[str] = None, extensions=None) -> dict:
    """
    List the files added, copied, modified or renamed in the snapshot.

    Returns {"mode": "staged" | "last-commit" | None, "files": [...]}; when
    extensions is given, only paths ending in one of them are kept.
    """
    cwd = str(target_dir or os.getcwd())
    any_staged = _git(cwd, "diff", "--cached", "--name-only", "-z")
    if any_staged is None:
        return {"mode": None, "files": []}

    if any_staged:
        mode = "staged"
        out = _git(cwd, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR")
    elif not _has_commit(cwd, "HEAD"):
        # No commits and nothing staged: the index holds nothing to evaluate.
        return {"mode": "staged", "files": []}
    else:
        mode = "last-commit"
        if _has_commit(cwd, "HEAD~1"):
            out = _git(cwd, "diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD~1", "HEAD")
        else:
            out = _git(cwd, "ls-tree", "-r", "-z", "--name-only", "--full-tree", "HEAD")
    if out is None:
        return {"mode": None, "files": []}

    files = _split_nul(out)
    if extensions:
        files = [f for f in files if f.endswith(tuple(extensions))]
    return {"mode": mode, "files": files}


def _object_name(file: str, mode: str) -> str:
    """Object name of a path in the snapshot (paths are relative to the repo root)."""
    return f":0:{file}" if mode == "staged" else f"HEAD:{file}"


def read_file(target_dir: Optional[str], file: str, mode: Optional[str]) -> Optional[str]:
    """
    Read a file from the snapshot: UTF-8 text, or None when missing or binary.
    With mode None (no git) the working copy is the only source there is.
    """
    cwd = str(target_dir or os.getcwd())
    if mode is None:
        try:
            with open(os.path.join(cwd, file), "rb") as fh:
                data = fh.read()
        except OSError:
            return None
    else:
        data = _git(cwd, "cat-file", "blob", _object_name(file, mode))
        if data is None:
            return None
    if b"\0" in data[:BINARY_PROBE_BYTES]:
        return None
    return data.decode("utf-8", errors="replace")


def exists(target_dir: Optional[str], file: str, mode: Optional[str]) -> bool:
    """True when the path exists in the snapshot (the working copy when mode is None)."""
    cwd = str(target_dir or os.getcwd())
    if mode is None:
        return os.path.exists(os.path.join(cwd, file))
    return _git(cwd, "cat-file", "-e", _object_name(file, mode)) is not None
