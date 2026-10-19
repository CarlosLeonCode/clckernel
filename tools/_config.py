"""
Project configuration shared by the Python guards (twin of _config.js):
finds .clckernel.yaml in the project root, parses it with the sibling
_yaml.py (PyYAML when installed), validates it and fills in the defaults.
The defaults reproduce the behaviour of a project without the key. See
_config.js for the schema.

The `hitl.markers` regexes are compiled by the JavaScript guard check_hitl;
here they are only checked to be strings.

Self-contained: Python 3.9+ standard library only (PyYAML optional).
"""
from __future__ import annotations

import json
import os
import posixpath
import sys
from typing import Any, Callable, Optional

_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)
import _yaml  # noqa: E402

# Lookup order: the canonical name first, then older names kept for compatibility.
CONFIG_NAMES = ['.clckernel.yaml', '.clckernel.yml', '.clc-forge.yaml', '.clc-forge.yml']

KEYS = ["rules", "exclude_paths", "mirrors", "hitl", "update", "tdd", "severities"]
LEVELS = ["error", "warning"]

DEPRECATED_KEYS = {
    "active_guards": "guards are chosen by the stack, the registry and `clckernel update --add-guards`",
    "phases": "the workflow phases are agent instructions in AGENTS.md",
    "gate_mode": "every installed guard blocks the commit when it fails",
    "layers": "layer rules live in the architecture guards",
    "scope": "use exclude_paths to keep paths out of the guards",
}


class ConfigError(ValueError):
    """An invalid value; the message names the file and the key."""

    def __init__(self, key: str, message: str, file: str = CONFIG_NAMES[0], allowed: Optional[list] = None):
        allowed = allowed or []
        suffix = f" (allowed: {', '.join(allowed)})" if allowed else ""
        super().__init__(f'Invalid {file}: key "{key}" — {message}{suffix}')
        self.key = key
        self.file = file
        self.allowed = allowed


def default_config() -> dict:
    return {
        "rules": [],
        "exclude_paths": [],
        "mirrors": {"list": None, "required": False},
        "hitl": {"markers": None, "paths": None, "optOut": None},
        "update": {"exclude": []},
        "tdd": {"code": [], "ignore": []},
        "severities": {},
    }


def _type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, list):
        return "a list"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    return "object"


def _string_list(value: Any, key: str, file: str, check: Optional[Callable] = None) -> list:
    if not isinstance(value, list):
        raise ConfigError(key, f"expected a list of strings, got {_type_name(value)}", file)
    for i, item in enumerate(value):
        if not isinstance(item, str) or item.strip() == "":
            raise ConfigError(f"{key}[{i}]", "each item must be a non-empty string", file)
        if check:
            check(item, f"{key}[{i}]")
    return list(value)


def _section(raw: dict, key: str, known: list, file: str, label: Optional[str] = None) -> dict:
    label = label or key
    value = raw.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(label, f"expected a mapping, got {_type_name(value)}", file)
    for sub in value:
        if sub not in known:
            raise ConfigError(f"{label}.{sub}", "unknown key", file, [f"{label}.{k}" for k in known])
    return value


def _validate_rules(rules: Any, file: str) -> list:
    if rules is None:
        return []
    if not isinstance(rules, list):
        raise ConfigError("rules", f"expected a list, got {_type_name(rules)}", file)
    seen = set()
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ConfigError(f"rules[{i}]", "each rule must be a mapping", file)
        name = rule.get("name")
        if not isinstance(name, str) or name.strip() == "":
            raise ConfigError(f"rules[{i}].name", "each rule requires a non-empty name", file)
        if name in seen:
            raise ConfigError(f"rules[{i}].name", f'duplicate rule name "{name}"', file)
        seen.add(name)
        severity = rule.get("severity")
        if severity is not None and severity not in ("error", "warning"):
            raise ConfigError(f"rules[{i}].severity", f'invalid severity "{severity}"', file, ["error", "warning"])
    return rules


def _validate_severities(value: Any, file: str) -> dict:
    """severities: a mapping of guard name -> 'error' | 'warning'."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError("severities", f"expected a mapping of guard name to level, got {_type_name(value)}", file)
    out = {}
    for name, level in value.items():
        if not isinstance(name, str) or name.strip() == "":
            raise ConfigError("severities", "guard names must be non-empty", file)
        if not isinstance(level, str) or level not in LEVELS:
            raise ConfigError(f"severities.{name}", f"invalid level {json.dumps(level)}", file, LEVELS)
        out[name] = level
    return out


def _check_mirror_path(item: str, key: str, file: str) -> None:
    segments = item.replace("\\", "/").split("/")
    if os.path.isabs(item) or item.startswith("/") or ".." in segments:
        raise ConfigError(key, f'"{item}" must be a path inside the project', file)
    if posixpath.normpath(item) == "AGENTS.md":
        raise ConfigError(key, "AGENTS.md is the source, not a mirror", file)


def validate_config(raw: Any, file: str = CONFIG_NAMES[0]) -> tuple:
    """Validate a parsed config and fill in the defaults: (config, warnings)."""
    if not isinstance(raw, dict):
        raise ConfigError("<root>", "expected a mapping at the top level", file)
    config = default_config()
    warnings = []
    for key in raw:
        if key in DEPRECATED_KEYS:
            warnings.append(f'{file}: key "{key}" is deprecated and has no effect ({DEPRECATED_KEYS[key]}); remove it')
        elif key not in KEYS:
            warnings.append(f'{file}: unknown key "{key}" is ignored (known keys: {", ".join(KEYS)})')

    config["rules"] = _validate_rules(raw.get("rules"), file)
    if raw.get("exclude_paths") is not None:
        config["exclude_paths"] = _string_list(raw["exclude_paths"], "exclude_paths", file)

    mirrors = _section(raw, "mirrors", ["list", "required"], file)
    if mirrors.get("list") is not None:
        config["mirrors"]["list"] = _string_list(
            mirrors["list"], "mirrors.list", file, lambda item, key: _check_mirror_path(item, key, file))
    if mirrors.get("required") is not None:
        if not isinstance(mirrors["required"], bool):
            raise ConfigError("mirrors.required", f"expected true or false, got {_type_name(mirrors['required'])}", file)
        config["mirrors"]["required"] = mirrors["required"]

    hitl = _section(raw, "hitl", ["markers", "paths", "optOut"], file)
    if hitl.get("markers") is not None:
        config["hitl"]["markers"] = _string_list(hitl["markers"], "hitl.markers", file)
    if hitl.get("paths") is not None:
        config["hitl"]["paths"] = _string_list(hitl["paths"], "hitl.paths", file)
    if hitl.get("optOut") is not None:
        opt_out = _section(hitl, "optOut", ["key", "value"], file, "hitl.optOut")
        key = opt_out.get("key")
        if not isinstance(key, str) or key.strip() == "":
            raise ConfigError("hitl.optOut.key", "expected a non-empty frontmatter key", file)
        value = opt_out.get("value")
        if isinstance(value, bool):
            value = "true" if value else "false"
        elif isinstance(value, (int, float)):
            value = str(value)
        elif not isinstance(value, str):
            raise ConfigError("hitl.optOut.value", "expected the frontmatter value that exempts a file", file)
        config["hitl"]["optOut"] = {"key": key, "value": value}

    update = _section(raw, "update", ["exclude"], file)
    if update.get("exclude") is not None:
        config["update"]["exclude"] = _string_list(update["exclude"], "update.exclude", file)

    tdd = _section(raw, "tdd", ["code", "ignore"], file)
    if tdd.get("code") is not None:
        config["tdd"]["code"] = _string_list(tdd["code"], "tdd.code", file)
    if tdd.get("ignore") is not None:
        config["tdd"]["ignore"] = _string_list(tdd["ignore"], "tdd.ignore", file)

    config["severities"] = _validate_severities(raw.get("severities"), file)

    return config, warnings


def parse_config_text(text: Optional[str], file: str = CONFIG_NAMES[0]) -> dict:
    if text is None or text.strip() == "":
        return {}
    try:
        raw = _yaml.parse_yaml(text)
    except Exception as exc:  # PyYAML's YAMLError or the subset parser's ValueError
        raise ConfigError("<root>", f"YAML parse error: {exc}", file) from exc
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ConfigError("<root>", "expected a mapping at the top level", file)
    return raw


def find_config_file(target_dir: Optional[str] = None) -> Optional[str]:
    root = str(target_dir or os.getcwd())
    for name in CONFIG_NAMES:
        candidate = os.path.join(root, name)
        if os.path.exists(candidate):
            return candidate
    return None


_CACHE: dict = {}


def load_config(target_dir: Optional[str] = None, cache: bool = True) -> dict:
    """
    Load the config of the project at target_dir (read from the working tree).

    Returns {"file", "path", "config", "warnings"}; raises ConfigError.
    """
    root = os.path.abspath(str(target_dir or os.getcwd()))
    if cache and root in _CACHE:
        return _CACHE[root]
    config_path = find_config_file(root)
    if config_path is None:
        loaded = {"file": None, "path": None, "config": default_config(), "warnings": []}
    else:
        file = os.path.basename(config_path)
        with open(config_path, encoding="utf-8") as handle:
            raw = parse_config_text(handle.read(), file)
        config, warnings = validate_config(raw, file)
        loaded = {"file": file, "path": config_path, "config": config, "warnings": warnings}
    if cache:
        _CACHE[root] = loaded
    return loaded


def glob_matcher(globs: Optional[list]) -> Callable[[str], bool]:
    """A predicate telling whether a root-relative POSIX path matches one of the globs."""
    regexes = [_yaml.glob_to_regex(g) for g in globs or []]
    return lambda rel: any(r.match(rel) for r in regexes)


_REPORTED: set = set()


def report_warnings(loaded: dict) -> None:
    """Print each warning once per process, on stderr (guards keep stdout for JSON)."""
    for warning in loaded["warnings"]:
        if warning in _REPORTED:
            continue
        _REPORTED.add(warning)
        print(f"clckernel: warning: {warning}", file=sys.stderr)
