/**
 * JavaScript/TypeScript source helpers shared by check_query_efficiency and
 * check_mcp_contracts. Not a parser: a scanner that blanks comments and
 * literal text so the guards' patterns only see code.
 *
 *   maskJs(source) -> { code, masked }
 *     code:   comments replaced by spaces (string literals kept)
 *     masked: comments AND the contents of string, template and regex
 *             literals replaced by spaces (the delimiters are kept)
 *   Both have the source's length and line breaks, so offsets and line
 *   numbers stay valid. Template literals are blanked whole, `${...}`
 *   included. A `/` starts a regex literal after an operator, an opening
 *   bracket, a comma or one of return/typeof/case/... (the usual heuristic).
 *
 * Self-contained: Node.js built-ins; the generated-file globs come from the
 * sibling _config.js (with yaml.js), installed next to every JS guard.
 */

const REGEX_PREFIX_CHARS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_PREFIX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/**
 * @param {string} source
 * @returns {{ code: string, masked: string }}
 */
function maskJs(source) {
  const code = source.split('');
  const masked = source.split('');
  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < arr.length; k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
  };
  const n = source.length;

  /** End (exclusive) of a quoted string starting at i. */
  const stringEnd = (i, quote) => {
    let j = i + 1;
    while (j < n && source[j] !== quote && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, n);
  };

  /** End (exclusive) of a template literal starting at i, `${}` nesting included. */
  const templateEnd = (i) => {
    let j = i + 1;
    while (j < n) {
      if (source[j] === '\\') { j += 2; continue; }
      if (source[j] === '`') return j + 1;
      if (source[j] === '$' && source[j + 1] === '{') { j = codeEnd(j + 2); continue; }
      j++;
    }
    return n;
  };

  /** End (exclusive) of the code inside `${ ... }` starting at i (after the brace). */
  const codeEnd = (i) => {
    let depth = 1;
    let j = i;
    while (j < n && depth > 0) {
      const ch = source[j];
      if (ch === '`') { j = templateEnd(j); continue; }
      if (ch === '"' || ch === "'") { j = stringEnd(j, ch); continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    return j;
  };

  const regexAllowed = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(source[k])) k--;
    if (k < 0) return true;
    if (REGEX_PREFIX_CHARS.has(source[k])) return true;
    const word = /[A-Za-z_$][\w$]*$/.exec(source.slice(Math.max(0, k - 12), k + 1));
    return Boolean(word && REGEX_PREFIX_WORDS.has(word[0]));
  };

  let i = 0;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      let j = source.indexOf('\n', i);
      if (j < 0) j = n;
      blank(code, i, j);
      blank(masked, i, j);
      i = j;
    } else if (ch === '/' && next === '*') {
      let j = source.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(code, i, j);
      blank(masked, i, j);
      i = j;
    } else if (ch === '"' || ch === "'") {
      const j = stringEnd(i, ch);
      blank(masked, i + 1, j - 1);
      i = j;
    } else if (ch === '`') {
      const j = templateEnd(i);
      blank(masked, i + 1, j - 1);
      i = j;
    } else if (ch === '/' && regexAllowed(i)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j++;
      }
      blank(masked, i + 1, j);
      j++;
      while (j < n && /[a-z]/i.test(source[j])) j++;
      i = j;
    } else {
      i++;
    }
  }
  return { code: code.join(''), masked: masked.join('') };
}

/**
 * Index of the bracket closing the one at `open` in masked text, or -1.
 * @param {string} masked
 * @param {number} open - Index of '(', '{' or '['
 * @returns {number}
 */
function matchingClose(masked, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** 1-based line of an offset. */
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** Test files and type declarations the JS guards skip. */
const TEST_FILE_RES = [
  /(^|\/)(__tests__|__mocks__)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.d\.[cm]?ts$/,
];

/**
 * Generated code: the GENERATED_FILES globs of the sibling _config.js, the one
 * list verify_tdd uses too. An older _config.js without the export yields none.
 */
let generated = null;
function isGenerated(file) {
  if (generated === null) {
    try {
      const { globToRegex } = require('./yaml.js');
      generated = (require('./_config.js').GENERATED_FILES || []).map(globToRegex);
    } catch {
      generated = [];
    }
  }
  return generated.some((re) => re.test(file));
}

/** True for a test file, a type declaration or a generated file. */
function isTestOrGenerated(file) {
  return TEST_FILE_RES.some((re) => re.test(file)) || isGenerated(file);
}

/** Extensions of the JS/TS sources the guards read. */
const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

module.exports = { maskJs, matchingClose, lineOf, isTestOrGenerated, JS_EXTENSIONS };
