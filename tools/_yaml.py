"""
Zero-dependency YAML subset parser and glob matcher shared by the Python
guards (twin of tools/yaml.js): same functions, same order, same error
messages. parse_yaml uses PyYAML when it is installed, otherwise the strict
subset parser below.

Self-contained: Python 3.9+ standard library only (PyYAML optional).
"""
from __future__ import annotations

import re
from typing import Any, Optional

# ═══════════════════════════════════════════════════════════════════════
# YAML Parser — PyYAML when available, otherwise the strict subset parser.
# minimal_yaml_parse is the twin of parseYaml in tools/yaml.js: same
# functions, same order, same error messages.
#
# Supported subset (anything else raises ValueError
# "Unsupported YAML syntax at line N: ..."):
#   - block mappings and block sequences, including a sequence at the SAME
#     indent as its key (`rules:` / `- name:`) and multi-key mapping items
#   - scalars: plain, 'single' (only the '' escape), "double" (escapes
#     \\ \" \/ \n \t \r \0)
#   - types: int, float, true/false (+ True/TRUE/False/FALSE),
#     null/Null/NULL/~/empty; ambiguous YAML 1.1 forms (yes/no/on/off, octal,
#     hex, 1_000, 1:30, dates, .5, .inf, ...) are errors — quote them
#   - flow `[...]` / `{...}` of scalars on one line, quote-aware
#   - comments: `#` at line start or preceded by a space, outside quotes
#
# The top level must be a mapping (an empty document parses to {}).
# ═══════════════════════════════════════════════════════════════════════

def parse_yaml(text: str) -> dict:
    """Parse YAML text. Uses PyYAML if available, otherwise the subset parser.

    Parse errors propagate (PyYAML's YAMLError or ValueError) so the caller
    can fail closed.
    """
    try:
        import yaml
    except ImportError:
        return minimal_yaml_parse(text)
    result = yaml.safe_load(text)
    if result is None:
        return {}
    if not isinstance(result, dict):
        raise ValueError('Unsupported YAML syntax at line 1: the top level must be a mapping')
    return result


NULL_WORDS = ('', '~', 'null', 'Null', 'NULL')
TRUE_WORDS = ('true', 'True', 'TRUE')
FALSE_WORDS = ('false', 'False', 'FALSE')
YAML11_BOOL_RE = re.compile(r'^(?:yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$')
INT_RE = re.compile(r'^[-+]?(?:0|[1-9][0-9]*)$')
FLOAT_RE = re.compile(r'^[-+]?[0-9]+\.[0-9]+$')
# Everything PyYAML would resolve to an int/float/timestamp; used to reject
# forms outside the subset instead of silently reading them as strings.
YAML11_INT_RE = re.compile(
    r'^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+'
    r'|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$')
YAML11_FLOAT_RE = re.compile(
    r'^(?:[-+]?[0-9][0-9_]*\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9_]+(?:[eE][-+][0-9]+)?'
    r'|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$')
YAML11_TIMESTAMP_RE = re.compile(r'^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:$|[Tt \t])')
DOUBLE_ESCAPES = {'\\': '\\', '"': '"', '/': '/', 'n': '\n', 't': '\t', 'r': '\r', '0': '\0'}


def _yaml_error(line_no: int, reason: str) -> ValueError:
    """Build the error raised for any input outside the subset."""
    return ValueError(f'Unsupported YAML syntax at line {line_no}: {reason}')


class _Cursor:
    """Cursor over the significant lines of the document."""

    def __init__(self, lines: list) -> None:
        self.lines = lines
        self.index = 0

    def peek(self) -> Optional[dict]:
        return self.lines[self.index] if self.index < len(self.lines) else None

    def advance(self) -> None:
        self.index += 1

    def replace(self, line: dict) -> None:
        """Replace the current line (used to re-read `- key: v` as a mapping)."""
        self.lines[self.index] = line


def minimal_yaml_parse(text: str) -> dict:
    """Parse a YAML string (strict subset) into a dict ({} for an empty document)."""
    cursor = _Cursor(_split_lines(text))
    first = cursor.peek()
    if first is None:
        return {}
    if _is_seq_item(first['text']):
        raise _yaml_error(first['line_no'], 'the top level must be a mapping')
    root = _parse_mapping(cursor, first['indent'])
    rest = cursor.peek()
    if rest is not None:
        raise _yaml_error(rest['line_no'], 'inconsistent indentation')
    return root


def _split_lines(text: str) -> list:
    """
    Split the source into significant lines: {indent, text, line_no}.
    Drops blank and comment-only lines; rejects tabs in indentation and
    document markers.
    """
    lines = []
    for i, raw in enumerate(text.split('\n')):
        line_no = i + 1
        line = raw[:-1] if raw.endswith('\r') else raw
        content = line.lstrip(' \t')
        if content == '' or content.startswith('#'):
            continue
        leading = line[:len(line) - len(content)]
        if '\t' in leading:
            raise _yaml_error(line_no, 'tabs are not allowed in indentation')
        body = content.rstrip(' \t')
        if leading == '' and re.match(r'^(?:---|\.\.\.)(?:[ \t]|$)', body):
            raise _yaml_error(line_no, 'multiple documents (---/...) are not supported')
        lines.append({'indent': len(leading), 'text': body, 'line_no': line_no})
    return lines


def _is_seq_item(text: str) -> bool:
    """`- item` or a bare `-`."""
    return text == '-' or text.startswith('- ')


def _parse_block(cursor: _Cursor, indent: int) -> Any:
    """Parse the block that starts at the current line, whose indent is `indent`."""
    if _is_seq_item(cursor.peek()['text']):
        return _parse_sequence(cursor, indent)
    return _parse_mapping(cursor, indent)


def _parse_mapping(cursor: _Cursor, indent: int) -> dict:
    """Parse a block mapping whose keys sit at exactly `indent`."""
    obj: dict = {}
    line = cursor.peek()
    while line is not None:
        if line['indent'] < indent:
            break
        if line['indent'] > indent:
            raise _yaml_error(line['line_no'], 'inconsistent indentation')
        if _is_seq_item(line['text']):
            raise _yaml_error(line['line_no'], 'sequence item where a mapping key was expected')
        entry = _split_mapping_entry(line['text'], line['line_no'])
        if entry is None:
            _assert_node_start(line['text'], 0, line['line_no'], False)
            raise _yaml_error(line['line_no'], 'expected "key: value"')
        key, rest = entry
        if key in obj:
            raise _yaml_error(line['line_no'], f'duplicate key "{key}"')
        cursor.advance()
        empty, value = _parse_inline_value(rest, line['line_no'])
        obj[key] = _parse_child(cursor, indent, True) if empty else value
        line = cursor.peek()
    return obj


def _parse_sequence(cursor: _Cursor, indent: int) -> list:
    """Parse a block sequence whose `-` markers sit at exactly `indent`."""
    arr: list = []
    line = cursor.peek()
    while line is not None:
        if line['indent'] < indent:
            break
        if line['indent'] > indent:
            raise _yaml_error(line['line_no'], 'inconsistent indentation')
        if not _is_seq_item(line['text']):
            break
        rest = line['text'][1:].lstrip(' ')
        column = line['indent'] + (len(line['text']) - len(rest))
        if rest == '' or rest.startswith('#'):
            cursor.advance()
            arr.append(_parse_child(cursor, indent, False))
        elif _is_seq_item(rest):
            raise _yaml_error(line['line_no'], 'nested sequences on one line are not supported')
        elif _split_mapping_entry(rest, line['line_no']) is not None:
            cursor.replace({'indent': column, 'text': rest, 'line_no': line['line_no']})
            arr.append(_parse_mapping(cursor, column))
        else:
            cursor.advance()
            arr.append(_parse_inline_value(rest, line['line_no'])[1])
        line = cursor.peek()
    return arr


def _parse_child(cursor: _Cursor, parent_indent: int, allow_same_indent_seq: bool) -> Any:
    """
    Value of a `key:` or `-` with nothing after it: a nested block, a sequence
    at the same indent (only after a key), or None.
    """
    nxt = cursor.peek()
    if nxt is None:
        return None
    if nxt['indent'] > parent_indent:
        return _parse_block(cursor, nxt['indent'])
    if allow_same_indent_seq and nxt['indent'] == parent_indent and _is_seq_item(nxt['text']):
        return _parse_sequence(cursor, parent_indent)
    return None


def _split_mapping_entry(text: str, line_no: int) -> Optional[tuple]:
    """
    Split `key: rest` on the first mapping indicator outside quotes.
    Returns (key, rest), or None when the text is not a mapping entry.
    """
    first = text[0]
    if first in '[{':
        return None
    if first in '\'"':
        key, end = _parse_quoted(text, 0, line_no)
        colon = _skip_spaces(text, end)
        if colon < len(text) and text[colon] == ':' and _is_blank_or_end(text, colon + 1):
            return key, text[colon + 1:]
        return None
    for i, ch in enumerate(text):
        if ch == '#' and i > 0 and text[i - 1] == ' ':
            return None
        if ch == ':' and _is_blank_or_end(text, i + 1):
            return _parse_plain_key(text[:i].rstrip(' \t'), line_no), text[i + 1:]
    return None


def _parse_plain_key(raw: str, line_no: int) -> str:
    """Validate a plain (unquoted) mapping key: it must resolve to a string."""
    if raw == '':
        raise _yaml_error(line_no, 'empty mapping key')
    _assert_node_start(raw, 0, line_no, False)
    if raw == '<<':
        raise _yaml_error(line_no, 'merge keys (<<) are not supported')
    if not isinstance(_resolve_plain(raw, line_no), str):
        raise _yaml_error(line_no, f'key "{raw}" is not a string; quote it')
    return raw


def _parse_inline_value(text: str, line_no: int) -> tuple:
    """
    Parse what follows `key:` or `- ` on the same line.
    Returns (empty, value); empty is True when only spaces/comment remain.
    """
    start = _skip_spaces(text, 0)
    if start >= len(text) or text[start] == '#':
        return True, None
    first = text[start]
    if first in '[{':
        value, end = _parse_flow(text, start, line_no)
    elif first in '\'"':
        value, end = _parse_quoted(text, start, line_no)
    else:
        _assert_node_start(text, start, line_no, False)
        raw, end = _read_plain(text, start, False, line_no)
        if ': ' in raw or raw.endswith(':'):
            raise _yaml_error(line_no, 'mapping values are not allowed inside a plain scalar; quote it')
        value = _resolve_plain(raw, line_no)
    _assert_end_of_line(text, end, line_no)
    return False, value


def _parse_flow(text: str, pos: int, line_no: int) -> tuple:
    """
    Parse a one-line flow collection of scalars starting at `pos` (`[` or `{`).
    Returns (value, index after the closer).
    """
    is_seq = text[pos] == '['
    close = ']' if is_seq else '}'
    result: Any = [] if is_seq else {}
    i = _skip_spaces(text, pos + 1)
    if _char_at(text, i) == close:
        return result, i + 1
    while True:
        i = _skip_spaces(text, i)
        if is_seq:
            item, i = _parse_flow_scalar(text, i, line_no)
            result.append(item)
        else:
            key, i = _parse_flow_scalar(text, i, line_no, True)
            i = _skip_spaces(text, i)
            if _char_at(text, i) != ':':
                raise _yaml_error(line_no, 'expected ":" in flow mapping')
            i = _skip_spaces(text, i + 1)
            value = None
            if _char_at(text, i) not in (',', close):
                value, i = _parse_flow_scalar(text, i, line_no)
            if key in result:
                raise _yaml_error(line_no, f'duplicate key "{key}"')
            result[key] = value
        i = _skip_spaces(text, i)
        ch = _char_at(text, i)
        if ch == ',':
            i = _skip_spaces(text, i + 1)
            if _char_at(text, i) == close:
                return result, i + 1
        elif ch == close:
            return result, i + 1
        elif ch in ('', '#'):
            raise _yaml_error(line_no, 'unclosed flow collection (flow must fit on one line)')
        else:
            raise _yaml_error(line_no, f'expected "," or "{close}" in flow collection')


def _parse_flow_scalar(text: str, pos: int, line_no: int, is_key: bool = False) -> tuple:
    """Parse one scalar inside a flow collection. Returns (value, index after it)."""
    if pos >= len(text):
        raise _yaml_error(line_no, 'unclosed flow collection (flow must fit on one line)')
    first = text[pos]
    if first in '[{':
        raise _yaml_error(line_no, 'nested flow collections are not supported')
    if first in '\'"':
        return _parse_quoted(text, pos, line_no)
    _assert_node_start(text, pos, line_no, True)
    raw, end = _read_plain(text, pos, True, line_no)
    if raw == '':
        raise _yaml_error(line_no, 'empty entry in flow collection')
    return (_parse_plain_key(raw, line_no) if is_key else _resolve_plain(raw, line_no)), end


def _parse_quoted(text: str, pos: int, line_no: int) -> tuple:
    """
    Parse a single- or double-quoted scalar starting at `pos`.
    Returns (value, index after the closing quote).
    """
    quote = text[pos]
    out = []
    i = pos + 1
    while i < len(text):
        ch = text[i]
        if quote == "'" and ch == "'":
            if _char_at(text, i + 1) != "'":
                return ''.join(out), i + 1
            out.append("'")
            i += 2
        elif quote == '"' and ch == '"':
            return ''.join(out), i + 1
        elif quote == '"' and ch == '\\':
            esc = _char_at(text, i + 1)
            if esc == '':
                raise _yaml_error(line_no, 'unclosed double-quoted scalar')
            if esc not in DOUBLE_ESCAPES:
                raise _yaml_error(line_no, f'unsupported escape "\\{esc}" in double-quoted scalar')
            out.append(DOUBLE_ESCAPES[esc])
            i += 2
        else:
            out.append(ch)
            i += 1
    kind = 'single' if quote == "'" else 'double'
    raise _yaml_error(line_no, f'unclosed {kind}-quoted scalar')


def _read_plain(text: str, pos: int, in_flow: bool, line_no: int) -> tuple:
    """
    Read a plain scalar starting at `pos`; stops at a comment and, inside flow
    collections, at flow indicators and `: `.
    Returns (trimmed raw text, index where it stopped).
    """
    i = pos
    while i < len(text):
        ch = text[i]
        prev = text[i - 1] if i > 0 else ''
        if ch == '#' and prev == ' ':
            break
        if ch == '#' and prev == '\t':
            raise _yaml_error(line_no, 'tabs are not allowed before comments')
        if in_flow and ch in ',[]{}?':
            break
        if in_flow and ch == ':' and (i + 1 >= len(text) or text[i + 1] in ' \t,[]{}'):
            break
        i += 1
    return text[pos:i].rstrip(' \t'), i


def _resolve_plain(raw: str, line_no: int) -> Any:
    """Resolve a plain scalar to None / bool / int / float / str."""
    if raw in NULL_WORDS:
        return None
    if raw in TRUE_WORDS:
        return True
    if raw in FALSE_WORDS:
        return False
    if YAML11_BOOL_RE.match(raw):
        raise _yaml_error(line_no, f'ambiguous boolean "{raw}"; use true/false or quote it')
    if INT_RE.match(raw):
        return int(raw)
    if FLOAT_RE.match(raw):
        return float(raw)
    if (YAML11_INT_RE.match(raw) or YAML11_FLOAT_RE.match(raw) or YAML11_TIMESTAMP_RE.match(raw)
            or raw in ('=', '<<')):
        raise _yaml_error(line_no, f'ambiguous scalar "{raw}"; quote it')
    return raw


def _assert_node_start(text: str, pos: int, line_no: int, in_flow: bool) -> None:
    """Reject indicators that cannot start a node in the subset."""
    ch = text[pos]
    spaced = _is_blank_or_end(text, pos + 1)
    if ch in '&*':
        raise _yaml_error(line_no, 'anchors/aliases are not supported')
    if ch == '!':
        raise _yaml_error(line_no, 'tags (!) are not supported')
    if ch in '|>':
        raise _yaml_error(line_no, 'block scalars (| and >) are not supported')
    if ch == '?' and spaced:
        raise _yaml_error(line_no, 'complex keys (? ) are not supported')
    if ch == '-' and spaced:
        raise _yaml_error(line_no, 'a sequence is not allowed here')
    if ch == ':' and spaced:
        raise _yaml_error(line_no, 'unexpected ":"')
    if ch in '%@`,]}#':
        raise _yaml_error(line_no, f'a plain scalar cannot start with "{ch}"; quote it')
    if in_flow and ch in '[{':
        raise _yaml_error(line_no, 'nested flow collections are not supported')


def _assert_end_of_line(text: str, pos: int, line_no: int) -> None:
    """After a value only spaces and a ` #` comment may follow."""
    i = _skip_spaces(text, pos)
    if i >= len(text):
        return
    if text[i] == '#' and text[i - 1] == ' ':
        return
    raise _yaml_error(line_no, f'unexpected content after value: "{text[i:]}"')


def _skip_spaces(text: str, pos: int) -> int:
    i = pos
    while i < len(text) and text[i] in ' \t':
        i += 1
    return i


def _is_blank_or_end(text: str, pos: int) -> bool:
    return pos >= len(text) or text[pos] in ' \t'


def _char_at(text: str, pos: int) -> str:
    """Character at `pos`, or '' past the end (JS `text[pos]` semantics)."""
    return text[pos] if pos < len(text) else ''


# ═══════════════════════════════════════════════════════════════════════
# Glob-to-Regex Converter
# Handles: **/, trailing **, *, ?, {a,b} alternation; everything else literal
# ═══════════════════════════════════════════════════════════════════════

def glob_to_regex(glob_pattern: str) -> re.Pattern:
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
