/**
 * CLC Kernel — Zero-Dependency strict YAML subset parser.
 * Uses only Node.js built-ins (no npm deps). Twin of `minimal_yaml_parse` in
 * tools/_yaml.py: same functions, same order, same error messages.
 *
 * Supported subset (anything else throws `Unsupported YAML syntax at line N`):
 *   - block mappings and block sequences, including a sequence at the SAME
 *     indent as its key (`rules:` / `- name:`) and multi-key mapping items
 *   - scalars: plain, 'single' (only the '' escape), "double" (escapes
 *     \\ \" \/ \n \t \r \0)
 *   - types: int, float, true/false (+ True/TRUE/False/FALSE),
 *     null/Null/NULL/~/empty; ambiguous YAML 1.1 forms (yes/no/on/off, octal,
 *     hex, 1_000, 1:30, dates, .5, .inf, ...) are errors — quote them
 *   - flow `[...]` / `{...}` of scalars on one line, quote-aware
 *   - comments: `#` at line start or preceded by a space, outside quotes
 *
 * The top level must be a mapping (an empty document parses to {}).
 *
 * @module yaml
 */

const NULL_WORDS = ['', '~', 'null', 'Null', 'NULL'];
const TRUE_WORDS = ['true', 'True', 'TRUE'];
const FALSE_WORDS = ['false', 'False', 'FALSE'];
const YAML11_BOOL_RE = /^(?:yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/;
const INT_RE = /^[-+]?(?:0|[1-9][0-9]*)$/;
const FLOAT_RE = /^[-+]?[0-9]+\.[0-9]+$/;
// Everything PyYAML would resolve to an int/float/timestamp; used to reject
// forms outside the subset instead of silently reading them as strings.
const YAML11_INT_RE = /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;
const YAML11_FLOAT_RE = /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9_]+(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const YAML11_TIMESTAMP_RE = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:$|[Tt \t])/;
const DOUBLE_ESCAPES = { '\\': '\\', '"': '"', '/': '/', n: '\n', t: '\t', r: '\r', 0: '\0' };

/**
 * Build the error thrown for any input outside the subset.
 * @param {number} lineNo - 1-based line number.
 * @param {string} reason - What is not supported.
 * @returns {Error}
 */
function yamlError(lineNo, reason) {
  return new Error(`Unsupported YAML syntax at line ${lineNo}: ${reason}`);
}

/** Cursor over the significant lines of the document. */
class Cursor {
  constructor(lines) {
    this.lines = lines;
    this.index = 0;
  }

  peek() {
    return this.index < this.lines.length ? this.lines[this.index] : null;
  }

  advance() {
    this.index += 1;
  }

  /** Replace the current line (used to re-read `- key: v` as a mapping). */
  replace(line) {
    this.lines[this.index] = line;
  }
}

/**
 * Parse a YAML string (strict subset) into a plain object.
 * @param {string} text - Raw YAML source.
 * @returns {object} Parsed mapping ({} for an empty document).
 * @throws {Error} `Unsupported YAML syntax at line N: ...` outside the subset.
 */
function parseYaml(text) {
  const cursor = new Cursor(splitLines(text));
  const first = cursor.peek();
  if (first === null) return {};
  if (isSeqItem(first.text)) throw yamlError(first.lineNo, 'the top level must be a mapping');
  const root = parseMapping(cursor, first.indent);
  const rest = cursor.peek();
  if (rest !== null) throw yamlError(rest.lineNo, 'inconsistent indentation');
  return root;
}

/**
 * Split the source into significant lines: { indent, text, lineNo }.
 * Drops blank and comment-only lines; rejects tabs in indentation and
 * document markers.
 */
function splitLines(text) {
  const lines = [];
  text.split('\n').forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/\r$/, '');
    const content = line.replace(/^[ \t]+/, '');
    if (content === '' || content.startsWith('#')) return;
    const leading = line.slice(0, line.length - content.length);
    if (leading.includes('\t')) throw yamlError(lineNo, 'tabs are not allowed in indentation');
    const body = content.replace(/[ \t]+$/, '');
    if (leading === '' && /^(?:---|\.\.\.)(?:[ \t]|$)/.test(body)) {
      throw yamlError(lineNo, 'multiple documents (---/...) are not supported');
    }
    lines.push({ indent: leading.length, text: body, lineNo });
  });
  return lines;
}

/** `- item` or a bare `-`. */
function isSeqItem(text) {
  return text === '-' || text.startsWith('- ');
}

/**
 * Parse the block that starts at the current line, whose indent is `indent`.
 * @returns {object|Array}
 */
function parseBlock(cursor, indent) {
  if (isSeqItem(cursor.peek().text)) return parseSequence(cursor, indent);
  return parseMapping(cursor, indent);
}

/** Parse a block mapping whose keys sit at exactly `indent`. */
function parseMapping(cursor, indent) {
  const obj = {};
  for (let line = cursor.peek(); line !== null; line = cursor.peek()) {
    if (line.indent < indent) break;
    if (line.indent > indent) throw yamlError(line.lineNo, 'inconsistent indentation');
    if (isSeqItem(line.text)) throw yamlError(line.lineNo, 'sequence item where a mapping key was expected');
    const entry = splitMappingEntry(line.text, line.lineNo);
    if (entry === null) {
      assertNodeStart(line.text, 0, line.lineNo, false);
      throw yamlError(line.lineNo, 'expected "key: value"');
    }
    if (Object.prototype.hasOwnProperty.call(obj, entry.key)) {
      throw yamlError(line.lineNo, `duplicate key "${entry.key}"`);
    }
    cursor.advance();
    const inline = parseInlineValue(entry.rest, line.lineNo);
    obj[entry.key] = inline.empty ? parseChild(cursor, indent, true) : inline.value;
  }
  return obj;
}

/** Parse a block sequence whose `-` markers sit at exactly `indent`. */
function parseSequence(cursor, indent) {
  const arr = [];
  for (let line = cursor.peek(); line !== null; line = cursor.peek()) {
    if (line.indent < indent) break;
    if (line.indent > indent) throw yamlError(line.lineNo, 'inconsistent indentation');
    if (!isSeqItem(line.text)) break;
    const rest = line.text.slice(1).replace(/^ +/, '');
    const column = line.indent + (line.text.length - rest.length);
    if (rest === '' || rest.startsWith('#')) {
      cursor.advance();
      arr.push(parseChild(cursor, indent, false));
    } else if (isSeqItem(rest)) {
      throw yamlError(line.lineNo, 'nested sequences on one line are not supported');
    } else if (splitMappingEntry(rest, line.lineNo) !== null) {
      cursor.replace({ indent: column, text: rest, lineNo: line.lineNo });
      arr.push(parseMapping(cursor, column));
    } else {
      cursor.advance();
      arr.push(parseInlineValue(rest, line.lineNo).value);
    }
  }
  return arr;
}

/**
 * Value of a `key:` or `-` with nothing after it: a nested block, a sequence
 * at the same indent (only after a key), or null.
 */
function parseChild(cursor, parentIndent, allowSameIndentSeq) {
  const next = cursor.peek();
  if (next === null) return null;
  if (next.indent > parentIndent) return parseBlock(cursor, next.indent);
  if (allowSameIndentSeq && next.indent === parentIndent && isSeqItem(next.text)) {
    return parseSequence(cursor, parentIndent);
  }
  return null;
}

/**
 * Split `key: rest` on the first mapping indicator outside quotes.
 * @returns {{key: string, rest: string}|null} null when the text is not a mapping entry.
 */
function splitMappingEntry(text, lineNo) {
  const first = text[0];
  if (first === '[' || first === '{') return null;
  if (first === "'" || first === '"') {
    const [key, end] = parseQuoted(text, 0, lineNo);
    const colon = skipSpaces(text, end);
    if (text[colon] === ':' && isBlankOrEnd(text, colon + 1)) {
      return { key, rest: text.slice(colon + 1) };
    }
    return null;
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '#' && i > 0 && text[i - 1] === ' ') return null;
    if (text[i] === ':' && isBlankOrEnd(text, i + 1)) {
      return { key: parsePlainKey(text.slice(0, i).replace(/[ \t]+$/, ''), lineNo), rest: text.slice(i + 1) };
    }
  }
  return null;
}

/** Validate a plain (unquoted) mapping key: it must resolve to a string. */
function parsePlainKey(raw, lineNo) {
  if (raw === '') throw yamlError(lineNo, 'empty mapping key');
  assertNodeStart(raw, 0, lineNo, false);
  if (raw === '<<') throw yamlError(lineNo, 'merge keys (<<) are not supported');
  if (typeof resolvePlain(raw, lineNo) !== 'string') {
    throw yamlError(lineNo, `key "${raw}" is not a string; quote it`);
  }
  return raw;
}

/**
 * Parse what follows `key:` or `- ` on the same line.
 * @returns {{empty: boolean, value: *}} empty when only spaces/comment remain.
 */
function parseInlineValue(text, lineNo) {
  const start = skipSpaces(text, 0);
  if (start >= text.length || text[start] === '#') return { empty: true, value: null };
  const first = text[start];
  let value;
  let end;
  if (first === '[' || first === '{') {
    [value, end] = parseFlow(text, start, lineNo);
  } else if (first === "'" || first === '"') {
    [value, end] = parseQuoted(text, start, lineNo);
  } else {
    assertNodeStart(text, start, lineNo, false);
    const [raw, stop] = readPlain(text, start, false, lineNo);
    if (raw.includes(': ') || raw.endsWith(':')) {
      throw yamlError(lineNo, 'mapping values are not allowed inside a plain scalar; quote it');
    }
    value = resolvePlain(raw, lineNo);
    end = stop;
  }
  assertEndOfLine(text, end, lineNo);
  return { empty: false, value };
}

/**
 * Parse a one-line flow collection of scalars starting at `pos` (`[` or `{`).
 * @returns {[Array|object, number]} value and the index after the closer.
 */
function parseFlow(text, pos, lineNo) {
  const isSeq = text[pos] === '[';
  const close = isSeq ? ']' : '}';
  const result = isSeq ? [] : {};
  let i = skipSpaces(text, pos + 1);
  if (text[i] === close) return [result, i + 1];
  for (;;) {
    i = skipSpaces(text, i);
    if (isSeq) {
      let item;
      [item, i] = parseFlowScalar(text, i, lineNo);
      result.push(item);
    } else {
      let key;
      [key, i] = parseFlowScalar(text, i, lineNo, true);
      i = skipSpaces(text, i);
      if (text[i] !== ':') throw yamlError(lineNo, 'expected ":" in flow mapping');
      i = skipSpaces(text, i + 1);
      let value = null;
      if (text[i] !== ',' && text[i] !== close) [value, i] = parseFlowScalar(text, i, lineNo);
      if (Object.prototype.hasOwnProperty.call(result, key)) throw yamlError(lineNo, `duplicate key "${key}"`);
      result[key] = value;
    }
    i = skipSpaces(text, i);
    if (text[i] === ',') {
      i = skipSpaces(text, i + 1);
      if (text[i] === close) return [result, i + 1];
    } else if (text[i] === close) {
      return [result, i + 1];
    } else if (i >= text.length || text[i] === '#') {
      throw yamlError(lineNo, 'unclosed flow collection (flow must fit on one line)');
    } else {
      throw yamlError(lineNo, `expected "," or "${close}" in flow collection`);
    }
  }
}

/**
 * Parse one scalar inside a flow collection.
 * @returns {[*, number]} value and the index after it.
 */
function parseFlowScalar(text, pos, lineNo, isKey = false) {
  if (pos >= text.length) throw yamlError(lineNo, 'unclosed flow collection (flow must fit on one line)');
  const first = text[pos];
  if (first === '[' || first === '{') throw yamlError(lineNo, 'nested flow collections are not supported');
  if (first === "'" || first === '"') return parseQuoted(text, pos, lineNo);
  assertNodeStart(text, pos, lineNo, true);
  const [raw, end] = readPlain(text, pos, true, lineNo);
  if (raw === '') throw yamlError(lineNo, 'empty entry in flow collection');
  return [isKey ? parsePlainKey(raw, lineNo) : resolvePlain(raw, lineNo), end];
}

/**
 * Parse a single- or double-quoted scalar starting at `pos`.
 * @returns {[string, number]} value and the index after the closing quote.
 */
function parseQuoted(text, pos, lineNo) {
  const quote = text[pos];
  let out = '';
  let i = pos + 1;
  while (i < text.length) {
    const ch = text[i];
    if (quote === "'" && ch === "'") {
      if (text[i + 1] !== "'") return [out, i + 1];
      out += "'";
      i += 2;
    } else if (quote === '"' && ch === '"') {
      return [out, i + 1];
    } else if (quote === '"' && ch === '\\') {
      const esc = text[i + 1];
      if (esc === undefined) throw yamlError(lineNo, 'unclosed double-quoted scalar');
      if (!Object.prototype.hasOwnProperty.call(DOUBLE_ESCAPES, esc)) {
        throw yamlError(lineNo, `unsupported escape "\\${esc}" in double-quoted scalar`);
      }
      out += DOUBLE_ESCAPES[esc];
      i += 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  throw yamlError(lineNo, `unclosed ${quote === "'" ? 'single' : 'double'}-quoted scalar`);
}

/**
 * Read a plain scalar starting at `pos`; stops at a comment and, inside flow
 * collections, at flow indicators and `: `.
 * @returns {[string, number]} trimmed raw text and the index where it stopped.
 */
function readPlain(text, pos, inFlow, lineNo) {
  let i = pos;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '#' && text[i - 1] === ' ') break;
    if (ch === '#' && text[i - 1] === '\t') throw yamlError(lineNo, 'tabs are not allowed before comments');
    if (inFlow && ',[]{}?'.includes(ch)) break;
    if (inFlow && ch === ':' && (i + 1 >= text.length || ' \t,[]{}'.includes(text[i + 1]))) break;
    i += 1;
  }
  return [text.slice(pos, i).replace(/[ \t]+$/, ''), i];
}

/** Resolve a plain scalar to null / boolean / number / string. */
function resolvePlain(raw, lineNo) {
  if (NULL_WORDS.includes(raw)) return null;
  if (TRUE_WORDS.includes(raw)) return true;
  if (FALSE_WORDS.includes(raw)) return false;
  if (YAML11_BOOL_RE.test(raw)) throw yamlError(lineNo, `ambiguous boolean "${raw}"; use true/false or quote it`);
  if (INT_RE.test(raw)) return Number(raw) + 0; // + 0 turns -0 into 0
  if (FLOAT_RE.test(raw)) return Number(raw);
  if (YAML11_INT_RE.test(raw) || YAML11_FLOAT_RE.test(raw) || YAML11_TIMESTAMP_RE.test(raw) || raw === '=' || raw === '<<') {
    throw yamlError(lineNo, `ambiguous scalar "${raw}"; quote it`);
  }
  return raw;
}

/** Reject indicators that cannot start a node in the subset. */
function assertNodeStart(text, pos, lineNo, inFlow) {
  const ch = text[pos];
  const spaced = isBlankOrEnd(text, pos + 1);
  if (ch === '&' || ch === '*') throw yamlError(lineNo, 'anchors/aliases are not supported');
  if (ch === '!') throw yamlError(lineNo, 'tags (!) are not supported');
  if (ch === '|' || ch === '>') throw yamlError(lineNo, 'block scalars (| and >) are not supported');
  if (ch === '?' && spaced) throw yamlError(lineNo, 'complex keys (? ) are not supported');
  if (ch === '-' && spaced) throw yamlError(lineNo, 'a sequence is not allowed here');
  if (ch === ':' && spaced) throw yamlError(lineNo, 'unexpected ":"');
  if ('%@`,]}#'.includes(ch)) throw yamlError(lineNo, `a plain scalar cannot start with "${ch}"; quote it`);
  if (inFlow && (ch === '[' || ch === '{')) throw yamlError(lineNo, 'nested flow collections are not supported');
}

/** After a value only spaces and a ` #` comment may follow. */
function assertEndOfLine(text, pos, lineNo) {
  const i = skipSpaces(text, pos);
  if (i >= text.length) return;
  if (text[i] === '#' && text[i - 1] === ' ') return;
  throw yamlError(lineNo, `unexpected content after value: "${text.slice(i)}"`);
}

function skipSpaces(text, pos) {
  let i = pos;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
  return i;
}

function isBlankOrEnd(text, pos) {
  return pos >= text.length || text[pos] === ' ' || text[pos] === '\t';
}

// ═══════════════════════════════════════════════════════════════════════
// Glob-to-Regex Converter (twin of glob_to_regex in tools/_yaml.py)
// Handles: **/, trailing **, *, ?, {a,b} alternation; everything else literal
// ═══════════════════════════════════════════════════════════════════════

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/**
 * Convert a glob pattern to a fully anchored RegExp.
 * - `**\/` matches zero or more leading directories
 * - `**` (trailing or standalone) matches anything, separators included
 * - `*` matches any run of characters except `/`
 * - `?` matches exactly one character except `/`
 * - `{a,b}` matches either alternative (alternatives are literal)
 * - every other character is matched literally
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegex(glob) {
  const out = [];
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (glob.startsWith('**/', i)) {
      out.push('(?:.+/)?');
      i += 3;
    } else if (glob.startsWith('**', i)) {
      out.push('.*');
      i += 2;
    } else if (ch === '*') {
      out.push('[^/]*');
      i += 1;
    } else if (ch === '?') {
      out.push('[^/]');
      i += 1;
    } else if (ch === '{' && glob.indexOf('}', i + 1) !== -1) {
      const close = glob.indexOf('}', i + 1);
      const alternatives = glob.slice(i + 1, close).split(',');
      out.push('(?:' + alternatives.map(escapeRegex).join('|') + ')');
      i = close + 1;
    } else {
      out.push(escapeRegex(ch));
      i += 1;
    }
  }
  return new RegExp('^' + out.join('') + '$');
}

module.exports = { parseYaml, globToRegex };
