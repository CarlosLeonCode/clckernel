#!/usr/bin/env python3
"""
Custom Rules Guard — Python
Reads .clc-forge.yml and executes user-defined regex rules against changed files.
Self-contained: uses only Python stdlib + optional pyyaml.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
from typing import Any, Optional

# ═══════════════════════════════════════════════════════════════════════
# YAML Parser — try pyyaml first, fallback to inline minimal parser
# ═══════════════════════════════════════════════════════════════════════

def _parse_yaml(text: str) -> dict:
    """Parse YAML text. Uses PyYAML if available, otherwise inline minimal parser."""
    try:
        import yaml
        result = yaml.safe_load(text)
        return result if isinstance(result, dict) else {}
    except ImportError:
        pass
    except Exception:
        raise

    return _minimal_yaml_parse(text)


def _minimal_yaml_parse(text: str) -> dict:
    """
    Minimal YAML parser (~80 lines).
    Supports: scalars, block sequences, block mappings, inline flow sequences,
    comments. No anchors/aliases, no multiple documents.
    """
    lines = text.split('\n')
    root: dict = {}
    # Stack entries: (obj, indent, parent_obj, parent_key)
    stack: list[tuple[dict, int, Optional[dict], Optional[str]]] = [
        (root, -1, None, None)
    ]

    for line_text in lines:
        # Strip comments (but not inside quoted strings)
        stripped = line_text.rstrip()
        comment_idx = _find_comment(stripped)
        if comment_idx != -1:
            stripped = stripped[:comment_idx]
        if not stripped or stripped.isspace():
            continue

        indent = len(stripped) - len(stripped.lstrip())
        trimmed = stripped.lstrip()

        # Pop stack back to correct parent
        while len(stack) > 1 and stack[-1][1] >= indent:
            stack.pop()
        entry = stack[-1]
        obj = entry[0]
        parent_obj = entry[2]
        parent_key = entry[3]

        # ── Sequence item: "- rest" ──
        if trimmed.startswith('- '):
            rest = trimmed[2:].strip()

            if ': ' in rest:
                # "- key: value" — mapping inside a sequence
                arr = _get_or_create_array(parent_obj, parent_key, obj)
                if arr is not None:
                    item = {}
                    colon_idx = rest.index(': ')
                    k = rest[:colon_idx].strip()
                    v = rest[colon_idx + 2:].strip()
                    item[k] = _parse_scalar(v)
                    arr.append(item)
                    stack.append((item, indent, arr, None))
            elif parent_obj is not None and parent_key is not None:
                # "- scalar" inside a sequence
                pk = parent_obj.get(parent_key)
                if isinstance(pk, list):
                    pk.append(_parse_scalar(rest))
            continue

        # ── key: value pair ──
        kv_match = re.match(r'^([^:]+):\s*(.*)$', trimmed)
        if kv_match:
            key = kv_match.group(1).strip()
            val = kv_match.group(2).strip()

            if not val or val == '|' or val == '>':
                # Empty value → children follow
                if key not in obj or not isinstance(obj[key], (dict, list)):
                    obj[key] = {}
                stack.append((obj[key] if isinstance(obj[key], dict) else {}, indent, obj, key))
            elif val.startswith('[') and val.endswith(']'):
                inner = val[1:-1].strip()
                if inner:
                    obj[key] = [_parse_scalar(s.strip()) for s in inner.split(',')]
                else:
                    obj[key] = []
            elif val.startswith('{') and val.endswith('}'):
                obj[key] = _parse_flow_mapping(val)
            else:
                obj[key] = _parse_scalar(val)
            continue

    return root


def _find_comment(line: str) -> int:
    """Find index of comment character not inside quotes."""
    in_single = False
    in_double = False
    for i, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == '#' and not in_single and not in_double:
            return i
    return -1


def _get_or_create_array(parent_obj, parent_key, current_obj):
    """Get or create an array for sequence items."""
    if parent_obj is None or parent_key is None:
        return None
    pk = parent_obj.get(parent_key)
    if isinstance(pk, list):
        return pk
    if isinstance(pk, dict) and len(pk) == 0:
        parent_obj[parent_key] = []
        return parent_obj[parent_key]
    return None


def _parse_scalar(val: str) -> Any:
    """Parse a YAML scalar value."""
    if val == '' or val == '~' or val == 'null':
        return None
    if val == 'true':
        return True
    if val == 'false':
        return False
    if re.match(r'^-?\d+$', val):
        return int(val)
    if re.match(r'^-?\d+\.\d+$', val):
        return float(val)
    # Strip quotes and unescape
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        return val[1:-1].replace('\\', '')
    return val


def _parse_flow_mapping(s: str) -> dict:
    """Parse a YAML inline flow mapping {key: value, ...}."""
    inner = s[1:-1].strip()
    if not inner:
        return {}
    obj = {}
    for pair in inner.split(','):
        colon_idx = pair.find(':')
        if colon_idx == -1:
            continue
        k = pair[:colon_idx].strip()
        v = pair[colon_idx + 1:].strip()
        obj[k] = _parse_scalar(v)
    return obj


# ═══════════════════════════════════════════════════════════════════════
# Glob-to-Regex Converter
# Handles: **/, trailing **, *, ?, {a,b} alternation; everything else literal
# ═══════════════════════════════════════════════════════════════════════

def _glob_to_regex(glob_pattern: str) -> re.Pattern:
    """
    Convert a glob pattern to a compiled, fully anchored regex.

    - ``**/`` matches zero or more leading directories
    - ``**`` (trailing or standalone) matches anything, separators included
    - ``*`` matches any run of characters except ``/``
    - ``?`` matches exactly one character except ``/``
    - ``{a,b}`` matches either alternative (alternatives are literal)
    - every other character is matched literally
    """
    out = []
    i = 0
    n = len(glob_pattern)
    while i < n:
        ch = glob_pattern[i]
        if glob_pattern.startswith('**/', i):
            out.append('(?:.+/)?')
            i += 3
        elif glob_pattern.startswith('**', i):
            out.append('.*')
            i += 2
        elif ch == '*':
            out.append('[^/]*')
            i += 1
        elif ch == '?':
            out.append('[^/]')
            i += 1
        elif ch == '{' and '}' in glob_pattern[i + 1:]:
            close = glob_pattern.index('}', i + 1)
            alternatives = glob_pattern[i + 1:close].split(',')
            out.append('(?:' + '|'.join(re.escape(a) for a in alternatives) + ')')
            i = close + 1
        else:
            out.append(re.escape(ch))
            i += 1
    return re.compile('^' + ''.join(out) + '$')


# ═══════════════════════════════════════════════════════════════════════
# Main Guard Contract
# ═══════════════════════════════════════════════════════════════════════

def check(target_dir: Optional[str] = None) -> dict:
    """
    Custom rules guard entry point.
    Reads .clc-forge.yml and executes user-defined regex rules.
    Returns: {exit_code, skipped, name, data: {violations, message}}
    """
    dir_path = pathlib.Path(target_dir or os.getcwd())
    candidates = ['.clckernel.yml', '.clckernel.yaml', '.clc-forge.yml', '.clc-forge.yaml']
    config_path = next((dir_path / c for c in candidates if (dir_path / c).exists()), None)

    # ── 1. Load config ──────────────────────────────────────────────
    if not config_path:
        return {
            "exit_code": 0,
            "skipped": True,
            "name": "check_custom",
            "data": {"violations": {}, "message": "No .clckernel.yml or .clc-forge.yml found"},
        }

    try:
        config = _parse_yaml(config_path.read_text(encoding='utf-8'))
    except Exception as e:
        return {
            "exit_code": 0,
            "skipped": True,
            "name": "check_custom",
            "data": {"violations": {}, "message": f"Config parse error: {e}"},
        }

    rules = config.get('rules') if isinstance(config, dict) else None
    if rules is not None and not isinstance(rules, list):
        return {
            "exit_code": 0,
            "skipped": True,
            "name": "check_custom",
            "data": {"violations": {}, "message": 'Config error: "rules" must be a list'},
        }
    if not isinstance(rules, list) or len(rules) == 0:
        return {
            "exit_code": 0,
            "skipped": False,
            "name": "check_custom",
            "data": {"violations": {}, "message": "No custom rules defined"},
        }

    # ── 2. Validate rules: compile regexes, check required fields ───
    validated = []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        if not rule.get('name') or not rule.get('pattern') or not rule.get('message'):
            continue
        try:
            regex = re.compile(rule['pattern'], re.MULTILINE)
            scope_re = _glob_to_regex(rule.get('scope', '**/*'))
            exclude_re = [_glob_to_regex(ex) for ex in rule.get('exclude', [])]
            validated.append({
                'name': rule['name'],
                'pattern': rule['pattern'],
                'message': rule['message'],
                'severity': rule.get('severity', 'error'),
                'exclude': rule.get('exclude', []),
                'regex': regex,
                'scope_re': scope_re,
                'exclude_re': exclude_re,
            })
        except re.error:
            # Invalid regex — skip this rule silently
            continue

    if len(validated) == 0:
        return {
            "exit_code": 0,
            "skipped": False,
            "name": "check_custom",
            "data": {"violations": {}, "message": "No valid custom rules after validation"},
        }

    # ── 3. Get changed files via git diff ───────────────────────────
    files = _get_changed_files(dir_path)
    if files is None:
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
        file_path = pathlib.Path(dir_path) / file
        try:
            content = file_path.read_text(encoding='utf-8')
        except (PermissionError, OSError):
            continue  # permission denied or unreadable — skip

        for rule in validated:
            if not rule['scope_re'].match(file):
                continue
            if any(re.match(str(ex.pattern), file) for ex in rule['exclude_re']):
                continue

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


def _get_changed_files(dir_path: str) -> Optional[list[str]]:
    """Get list of changed files via git diff. Returns None if no diff available."""
    # Staged changes first (what is being committed); HEAD~1 only when nothing is staged.
    try:
        result = subprocess.run(
            ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'],
            cwd=dir_path, capture_output=True, text=True, timeout=10,
        )
        files = [f for f in result.stdout.split('\n') if f.strip()]
        if files:
            return files
    except Exception:
        pass

    try:
        result = subprocess.run(
            ['git', 'diff', '--name-only', '--diff-filter=ACMR', 'HEAD~1'],
            cwd=dir_path, capture_output=True, text=True, timeout=10,
        )
        files = [f for f in result.stdout.split('\n') if f.strip()]
        return files if files else []
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════════════
# CLI entry point
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else None
    result = check(target)
    print(json.dumps(result, indent=2))
    sys.exit(result["exit_code"])
