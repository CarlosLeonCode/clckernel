#!/usr/bin/env python3
"""
Custom Rules Guard — Python
Reads .clckernel.yaml and executes user-defined regex rules against changed files.
Self-contained: Python stdlib + optional PyYAML, and the sibling helpers
_changes.py and _yaml.py (the YAML subset parser, shared with _config.py).
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import sys
from typing import Any, Optional

# Sibling helper shipped next to the guards; works both as a script and when
# loaded by audit.py through importlib.
_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _changes  # noqa: E402


def _yaml_module():
    """The shared parser (tools/_yaml.py), imported only when a config exists.

    Install ships it next to _changes.py; an older install without it fails
    closed (run `clckernel update`).
    """
    try:
        import _yaml
    except ImportError as exc:
        raise RuntimeError(
            "tools/_yaml.py is missing: run `clckernel update` so the guards can read the config"
        ) from exc
    return _yaml


# ═══════════════════════════════════════════════════════════════════════
# Main Guard Contract
# ═══════════════════════════════════════════════════════════════════════

# Lookup order: the canonical name first, then older names kept for compatibility.
CONFIG_NAMES = ['.clckernel.yaml', '.clckernel.yml', '.clc-forge.yaml', '.clc-forge.yml']
CANONICAL_CONFIG = CONFIG_NAMES[0]
DEPRECATED_PREFIX = '.clc-forge.'


def check(target_dir: Optional[str] = None) -> dict:
    """
    Custom rules guard entry point.
    Reads .clckernel.yaml and executes user-defined regex rules.
    Returns: {exit_code, skipped, name, data: {violations, message[, warnings]}}
    """
    dir_path = pathlib.Path(target_dir or os.getcwd())
    config_path = next((dir_path / c for c in CONFIG_NAMES if (dir_path / c).exists()), None)

    # ── 1. Load config ──────────────────────────────────────────────
    if not config_path:
        return {
            "exit_code": 0,
            "skipped": True,
            "name": "check_custom",
            "data": {"violations": {}, "message": f"No {CANONICAL_CONFIG} found"},
        }

    config_name = config_path.name
    result = _run_rules(dir_path, config_path, config_name)
    if config_name.startswith(DEPRECATED_PREFIX):
        result["data"]["warnings"] = [f"{config_name}: deprecated config name, rename to {CANONICAL_CONFIG}"]
    return result


def _run_rules(dir_path: pathlib.Path, config_path: pathlib.Path, config_name: str) -> dict:
    """Validate the rules in one config file and run them against changed files."""

    def config_error(message: str) -> dict:
        return {
            "exit_code": 1,
            "skipped": False,
            "name": "check_custom",
            "data": {"violations": {}, "message": f"Config error in {config_name}: {message}"},
        }

    try:
        yaml_module = _yaml_module()
        config = yaml_module.parse_yaml(config_path.read_text(encoding='utf-8'))
    except Exception as e:
        # Fail closed: rules we cannot read must not turn into a silent PASS.
        return {
            "exit_code": 1,
            "skipped": False,
            "name": "check_custom",
            "data": {"violations": {}, "message": f"Config parse error in {config_name}: {e}"},
        }

    rules = config.get('rules') if isinstance(config, dict) else None
    if rules is not None and not isinstance(rules, list):
        return config_error('"rules" must be a list')
    if not isinstance(rules, list) or len(rules) == 0:
        return {
            "exit_code": 0,
            "skipped": False,
            "name": "check_custom",
            "data": {"violations": {}, "message": "No custom rules defined"},
        }

    # ── 2. Validate rules: shape and regex; any invalid rule fails the guard ──
    validated = []
    errors = []
    for i, rule in enumerate(rules):
        problems = _validate_rule(rule)
        is_named = isinstance(rule, dict) and isinstance(rule.get('name'), str)
        label = f'"{rule["name"]}"' if is_named else f'#{i + 1}'
        if problems:
            errors.append(f"rule {label}: {', '.join(problems)}")
            continue
        try:
            regex = re.compile(rule['pattern'], re.MULTILINE)
        except re.error as e:
            errors.append(f'rule {label}: invalid pattern: {e}')
            continue
        validated.append({
            'name': rule['name'],
            'pattern': rule['pattern'],
            'message': rule['message'],
            'severity': rule.get('severity') or 'error',
            'exclude': rule.get('exclude') or [],
            'regex': regex,
            'scope_re': yaml_module.glob_to_regex(rule.get('scope') or '**/*'),
            'exclude_re': [yaml_module.glob_to_regex(ex) for ex in rule.get('exclude') or []],
        })

    if errors:
        return config_error('; '.join(errors))

    # ── 3. Changed files of the snapshot being verified ─────────────
    # The index, or HEAD when nothing is staged; never the working copy.
    changes = _changes.changed_files(str(dir_path))
    mode, files = changes["mode"], changes["files"]
    if mode is None:
        return {
            "exit_code": 0,
            "skipped": True,
            "name": "check_custom",
            "data": {"violations": {}, "message": "No git diff available"},
        }
    if len(files) == 0:
        return {
            "exit_code": 0,
            "skipped": False,
            "name": "check_custom",
            "data": {"violations": {}, "message": "No files to check"},
        }

    # ── 4. Run rules against files ──────────────────────────────────
    violations = {}
    has_error = False

    for file in files:
        content = _changes.read_file(str(dir_path), file, mode)
        if content is None:
            continue  # missing or binary in the snapshot — skip

        for rule in validated:
            if not rule['scope_re'].match(file):
                continue
            if any(re.match(str(ex.pattern), file) for ex in rule['exclude_re']):
                continue

            # Empty matches (e.g. `x*`, `^`) are violations too; check_custom.js
            # steps over them one code point at a time to report the same ones.
            for m in rule['regex'].finditer(content):
                line_no = content[:m.start()].count('\n') + 1
                if file not in violations:
                    violations[file] = []
                violations[file].append({
                    "lineNo": line_no,
                    "rule": rule['name'],
                    "message": rule['message'],
                    "severity": rule['severity'],
                })
                if rule['severity'] == 'error':
                    has_error = True

    # ── 5. Build result ─────────────────────────────────────────────
    total_count = sum(len(v) for v in violations.values())
    file_count = len(violations)
    if total_count > 0:
        msg = f"{total_count} custom rule violation(s) in {file_count} file(s)"
    else:
        msg = "No custom rule violations"

    return {
        "exit_code": 1 if has_error else 0,
        "skipped": False,
        "name": "check_custom",
        "data": {"violations": violations, "message": msg},
    }


def _validate_rule(rule: Any) -> list:
    """Shape problems of one rule (empty list when valid)."""
    if not isinstance(rule, dict):
        return ['must be a mapping']
    problems = []
    for field in ('name', 'pattern', 'message'):
        if not isinstance(rule.get(field), str) or rule.get(field) == '':
            problems.append(f'"{field}" must be a non-empty string')
    if rule.get('severity') is not None and rule.get('severity') not in ('error', 'warning'):
        problems.append('"severity" must be "error" or "warning"')
    if rule.get('scope') is not None and not isinstance(rule.get('scope'), str):
        problems.append('"scope" must be a string')
    exclude = rule.get('exclude')
    if exclude is not None and not (isinstance(exclude, list) and all(isinstance(e, str) for e in exclude)):
        problems.append('"exclude" must be a list of strings')
    return problems


# ═══════════════════════════════════════════════════════════════════════
# CLI entry point
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else None
    result = check(target)
    for warning in result["data"].get("warnings", []):
        print(f"[check_custom] warning: {warning}", file=sys.stderr)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
