"""
Snapshot helpers shared by the diff-based guards (twin of _changes.js).

A guard evaluates exactly the snapshot being verified:
  - "staged":      something is staged (a pre-commit) -> the index
  - "last-commit": nothing staged (a manual run)      -> HEAD, diffed against HEAD~1
                   (a root commit lists every file of HEAD)
  - None:          no git repository / git unavailable
File content always comes from that snapshot, never from the working copy.

Files the harness installed itself are listed in tools/.clckernel-managed.json
(written by `clckernel` install/update). changed_files drops every listed path,
so no guard evaluates the harness's own code. Without a registry (e.g. the
clckernel repository, where tools/ is source code) nothing is excluded.

The project's `exclude_paths` (.clckernel.yaml) are dropped too, for every
guard. The config is read through the sibling _config.py, which install ships
next to this file; an older install without it fails closed when a config file
appears (run `clckernel update`). An invalid config raises its
ConfigError: a guard never runs on a config it cannot read.

Self-contained: Python 3.9+ standard library only. Git runs with argument
lists, never through a shell; paths are read NUL-separated (-z), so spaces and
non-ASCII names survive.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Callable, Optional

BINARY_PROBE_BYTES = 8000
MANAGED_REGISTRY = "tools/.clckernel-managed.json"
CONFIG_NAMES = ('.clckernel.yaml', '.clckernel.yml', '.clc-forge.yaml', '.clc-forge.yml')


def project_config(target_dir: Optional[str] = None) -> Optional[dict]:
    """
    The project's validated config (defaults filled in), or None when the
    project has no config file. Deprecation warnings go to stderr once.

    Raises ConfigError on an invalid config, RuntimeError when the sibling
    _config.py (or _yaml.py) is missing.
    """
    root = str(target_dir or os.getcwd())
    if not any(os.path.exists(os.path.join(root, name)) for name in CONFIG_NAMES):
        return None
    tools_dir = os.path.dirname(os.path.abspath(__file__))
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
    try:
        import _config
    except ImportError as exc:
        raise RuntimeError(
            f"The project config needs tools/_config.py and tools/_yaml.py ({exc}): "
            "run `clckernel update` so the guards can read it"
        ) from exc
    loaded = _config.load_config(root)
    _config.report_warnings(loaded)
    return loaded["config"]


def glob_matcher(globs) -> Callable[[str], bool]:
    """A predicate for root-relative paths matching one of the globs (always False without globs)."""
    if not globs:
        return lambda rel: False
    import _config
    return _config.glob_matcher(globs)


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

    Returns {"mode": "staged" | "last-commit" | None, "files": [...]}, minus
    the registry-listed files and the config's exclude_paths; when extensions
    is given, only paths ending in one of them are kept.
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

    managed = _managed_files(cwd, mode)
    config = project_config(cwd)
    excluded = glob_matcher(config["exclude_paths"] if config else [])
    files = [f for f in _split_nul(out) if f not in managed and not excluded(f)]
    if extensions:
        files = [f for f in files if f.endswith(tuple(extensions))]
    return {"mode": mode, "files": files}


def pure_renames(target_dir: Optional[str], mode: Optional[str]) -> set:
    """
    New paths of the PURE renames in the snapshot: files whose content is
    identical to a file removed in the same change (same blob, git R100). The
    pair compared is the one changed_files uses: HEAD -> index when staged,
    HEAD~1 -> HEAD in last-commit mode; a root commit (or an index with no HEAD)
    has no renames. A rename with any content change is not listed.
    """
    cwd = str(target_dir or os.getcwd())
    raw = ("--raw", "-z", "--no-abbrev", "-M", "--diff-filter=R")
    out = None
    if mode == "staged" and _has_commit(cwd, "HEAD"):
        out = _git(cwd, "diff", "--cached", *raw, "HEAD")
    elif mode == "last-commit" and _has_commit(cwd, "HEAD~1"):
        out = _git(cwd, "diff", *raw, "HEAD~1", "HEAD")
    renamed: set = set()
    if out is None:
        return renamed
    # Each record: ":<src mode> <dst mode> <src blob> <dst blob> R<score>" NUL old NUL new NUL.
    parts = _split_nul(out)
    for i in range(0, len(parts) - 2, 3):
        fields = parts[i].lstrip(":").split(" ")
        if len(fields) == 5 and fields[2] == fields[3]:
            renamed.add(parts[i + 2])
    return renamed


def _managed_files(cwd: str, mode: Optional[str]) -> set:
    """
    Paths listed in the harness registry: read from the snapshot being evaluated,
    falling back to the working copy at the repository root. A missing or
    malformed registry excludes nothing.
    """
    text = read_file(cwd, MANAGED_REGISTRY, mode)
    if text is None and mode is not None:
        top = _git(cwd, "rev-parse", "--show-toplevel")
        root = top.decode("utf-8", errors="surrogateescape").strip() if top else cwd
        text = read_file(root, MANAGED_REGISTRY, None)
    if text is None:
        return set()
    try:
        data = json.loads(text)
    except ValueError:
        return set()
    # Older installs wrote a list of paths; current ones {kernelVersion, files: [{path, sha256}]}.
    if isinstance(data, list):
        return {f for f in data if isinstance(f, str)}
    if isinstance(data, dict) and isinstance(data.get("files"), list):
        paths = {f.get("path") for f in data["files"] if isinstance(f, dict)}
        return {p for p in paths if isinstance(p, str)} | {MANAGED_REGISTRY}
    return set()


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


def list_files(target_dir: Optional[str], mode: Optional[str]) -> list:
    """
    List every file of the snapshot, for whole-repository facts (e.g. a name
    that must be unique, a link target that must exist): the index in staged
    mode, HEAD in last-commit mode. Paths are relative to the repository root
    and sorted; nothing is excluded. With mode None (no git) nothing is listed.
    """
    cwd = str(target_dir or os.getcwd())
    if mode == "staged":
        out = _git(cwd, "ls-files", "-z", "--cached", "--full-name", "--", ":/")
    elif mode == "last-commit":
        out = _git(cwd, "ls-tree", "-r", "-z", "--name-only", "--full-tree", "HEAD")
    else:
        return []
    if out is None:
        return []
    return sorted(set(_split_nul(out)))
