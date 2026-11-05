#!/usr/bin/env node
/**
 * Query Efficiency Guard (JS/TS counterpart of check_db_efficiency)
 * Checks the changed JS/TS files whose package (the nearest package.json, or
 * the repository root's) depends on a known data client. Rules, each with its
 * own level (`query_efficiency.severities` in .clckernel.yaml):
 *   n_plus_one        a query call awaited inside a loop body (for, for...of,
 *                     for await, while, do), or any query call inside a
 *                     .forEach( / .map(async / .flatMap(async callback
 *                     (warning: a heuristic). Not reported: a statement that
 *                     paginates (.range( / .offset( / .skip(, skip / offset /
 *                     cursor, SQL OFFSET) and a call inside a function defined
 *                     in the loop body (e.g. a route handler registered per
 *                     iteration)
 *   unbounded_select  supabase-js `.select('*')` without .limit( / .range( /
 *                     .single( / .maybeSingle( in the same statement (warning);
 *                     a statement ends at `;` or at a line break that does not
 *                     continue it (semicolon-less code)
 * Query calls per client: supabase-js `.from(...).select|insert|update|upsert|delete(`
 * and `.rpc(`; drizzle-orm `db.`/`tx.` select|insert|update|delete|execute and
 * `db.query.<t>.findMany|findFirst`; @prisma/client `prisma.<model>.<op>(`;
 * postgres `sql` tagged templates; pg `client|pool|db.query(`. Extra regexes:
 * `query_efficiency.call_patterns` (matched on the code with comments and
 * literal text blanked).
 * A heuristic on source text: a query helper called in a loop, or a client
 * under another variable name, is not seen; a loop that runs a bounded number
 * of times is still reported. Test files and generated types are skipped.
 * Self-contained: uses only Node.js built-ins.
 */
const { changedFiles, readFile, nearestPackageDeps, projectConfig } = require('./_changes');
const { maskJs, matchingClose, lineOf, isTestOrGenerated, JS_EXTENSIONS } = require('./_jscode');

const NAME = 'check_query_efficiency';

/**
 * Settings when the config has no query_efficiency section (an older
 * tools/_config.js): the defaults of GUARD_SECTIONS.query_efficiency there.
 */
const DEFAULTS = { call_patterns: [], severities: { n_plus_one: 'warning', unbounded_select: 'warning' } };

function sectionSettings(config) {
  const own = (config && config.query_efficiency) || {};
  return { ...DEFAULTS, ...own, severities: { ...DEFAULTS.severities, ...(own.severities || {}) } };
}

/** Query call patterns per data client package. */
const PRESETS = {
  '@supabase/supabase-js': [
    /(?:[A-Za-z_$][\w$]*|\))\s*\.\s*from\s*\([^()]*\)\s*\.\s*(?:select|insert|update|upsert|delete)\s*\(/g,
    /\.\s*rpc\s*\(/g,
  ],
  'drizzle-orm': [
    /\b(?:db|tx)\s*\.\s*(?:select|selectDistinct|insert|update|delete|execute)\s*\(/g,
    /\b(?:db|tx)\s*\.\s*query\s*\.\s*[\w$]+\s*\.\s*find(?:Many|First)\s*\(/g,
  ],
  '@prisma/client': [
    /\b(?:prisma|tx)\s*\.\s*[a-z][\w$]*\s*\.\s*(?:find\w*|create\w*|update\w*|delete\w*|upsert|count|aggregate|groupBy)\s*\(/g,
    /\b(?:prisma|tx)\s*\.\s*\$(?:queryRaw|executeRaw)\w*/g,
  ],
  postgres: [/\bsql\s*`/g],
  pg: [/\b(?:client|pool|db|pg|conn|connection)\s*\.\s*query\s*\(/g],
};

/** Index of the bracket opening the one at `close` (scanning back), or -1. */
function matchingOpen(masked, close) {
  const pairs = { ')': '(', '}': '{', ']': '[' };
  const stack = [];
  for (let i = close; i >= 0; i--) {
    const ch = masked[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === '(' || ch === '{' || ch === '[') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** End of an expression starting at offset: the first , ; or unbalanced closing bracket at depth 0. */
function expressionEnd(masked, offset) {
  let depth = 0;
  for (let i = offset; i < masked.length; i++) {
    const ch = masked[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return i;
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) return i;
  }
  return masked.length;
}

/**
 * Function bodies of masked code: [{ header, start, end }], header = where the
 * function starts (`async`, `function`, its parameters), start/end = its body
 * (a block, or an arrow's expression).
 */
function functionBodies(masked) {
  const fns = [];
  const withAsync = (index) => {
    const before = /\basync\s*$/.exec(masked.slice(Math.max(0, index - 12), index));
    return before ? index - before[0].length : index;
  };
  for (const match of masked.matchAll(/\bfunction\b\s*\*?\s*[\w$]*\s*\(/g)) {
    const close = matchingClose(masked, match.index + match[0].length - 1);
    if (close < 0) continue;
    let open = close + 1;
    while (open < masked.length && /\s/.test(masked[open])) open++;
    if (masked[open] !== '{') continue;
    const end = matchingClose(masked, open);
    if (end > 0) fns.push({ header: withAsync(match.index), start: open, end });
  }
  for (const match of masked.matchAll(/=>/g)) {
    let k = match.index - 1;
    while (k >= 0 && /\s/.test(masked[k])) k--;
    let header = k;
    if (masked[k] === ')') header = matchingOpen(masked, k);
    else while (header > 0 && /[\w$]/.test(masked[header - 1])) header--;
    if (header < 0) continue;
    let start = match.index + 2;
    while (start < masked.length && /\s/.test(masked[start])) start++;
    const end = masked[start] === '{' ? matchingClose(masked, start) : expressionEnd(masked, start);
    if (end > 0) fns.push({ header: withAsync(header), start, end });
  }
  return fns;
}

/**
 * Loop bodies of masked code: [{ start, end, callback }] (callback: a
 * .forEach/.map(async body, which starts at its callback function's body).
 */
function loopBodies(masked, fns) {
  const bodies = [];
  const keyword = /\b(for|while)\s*(?:await\s*)?\(|\bdo\s*\{/g;
  for (const match of masked.matchAll(keyword)) {
    let bodyStart;
    if (match[0].startsWith('do')) {
      bodyStart = match.index + match[0].length - 1;
    } else {
      const close = matchingClose(masked, match.index + match[0].length - 1);
      if (close < 0) continue;
      bodyStart = close + 1;
      while (bodyStart < masked.length && /\s/.test(masked[bodyStart])) bodyStart++;
    }
    if (masked[bodyStart] === '{') {
      const end = matchingClose(masked, bodyStart);
      if (end > 0) bodies.push({ start: bodyStart, end, callback: false });
    } else {
      bodies.push({ start: bodyStart, end: statementEnd(masked, bodyStart), callback: false });
    }
  }
  const callback = /\.\s*(forEach|map|flatMap)\s*\(/g;
  for (const match of masked.matchAll(callback)) {
    const open = match.index + match[0].length - 1;
    const close = matchingClose(masked, open);
    if (close < 0) continue;
    if (match[1] !== 'forEach' && !/^\s*async\b/.test(masked.slice(open + 1, close))) continue;
    let first = open + 1;
    while (first < close && /\s/.test(masked[first])) first++;
    const own = fns.find((fn) => fn.header === first);
    bodies.push({ start: own ? own.start : open + 1, end: close, callback: true });
  }
  return bodies;
}

/** Start of the statement holding offset: after the last ; { or }. */
function statementStart(masked, offset) {
  let k = offset - 1;
  while (k >= 0 && !';{}'.includes(masked[k])) k--;
  return k + 1;
}

/** True when the statement holding `offset` awaits (an `await` since the last ; { or }). */
function awaited(masked, offset) {
  return /\bawait\b/.test(masked.slice(statementStart(masked, offset), offset));
}

/**
 * End of the statement holding offset: a `;` at bracket depth 0, the bracket
 * closing the enclosing block, or a line break at depth 0 that does not
 * continue the statement (the next line starts with `.` or `?`, or the line
 * ends with an operator, a comma or an opening bracket).
 */
function statementEnd(masked, offset) {
  let depth = 0;
  for (let i = offset; i < masked.length; i++) {
    const ch = masked[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return i;
      depth--;
    } else if (ch === ';' && depth === 0) return i;
    else if (ch === '\n' && depth === 0) {
      const next = /^\s*(\S)/.exec(masked.slice(i + 1, i + 400));
      const prev = /(\S)\s*$/.exec(masked.slice(Math.max(0, i - 400), i));
      const continues = (next && /[.?]/.test(next[1])) || (prev && /[=,(+\-*/&|?:[{.<>]/.test(prev[1]));
      if (!continues) return i;
    }
  }
  return masked.length;
}

/**
 * Pagination in a statement: a page of rows per iteration, not one query per
 * row. supabase-js .range(, drizzle .offset(, a .skip( call, prisma skip /
 * cursor arguments, SQL OFFSET, a cursor variable.
 */
const PAGINATION = /\.\s*(?:range|offset|skip)\s*\(|\b(?:skip|offset|cursor)\b/i;

/**
 * Findings of one file.
 * @param {string} source
 * @param {RegExp[]} patterns - Query call patterns (global)
 * @param {boolean} supabase - The supabase-js preset applies (unbounded_select)
 * @returns {Array<{ rule: string, lineNo: number, message: string }>}
 */
function analyzeJs(source, patterns, supabase) {
  const { code, masked } = maskJs(source);
  const fns = functionBodies(masked);
  const bodies = loopBodies(masked, fns);
  // A function defined inside a loop body (a handler registered per route)
  // runs when it is called, not once per iteration: the loop does not hold
  // the calls in it. A callback loop's own function is its body.
  const holds = (body, at) => at >= body.start && at < body.end &&
    !fns.some((fn) => fn.start > body.start && fn.start <= at && at < fn.end);
  const findings = [];
  const reported = new Set();

  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const at = match.index;
      const inside = bodies.filter((b) => holds(b, at));
      if (inside.length === 0) continue;
      if (PAGINATION.test(code.slice(statementStart(masked, at), statementEnd(masked, at)))) continue;
      const hit = inside.some((b) => b.callback) || awaited(masked, at);
      const line = lineOf(masked, at);
      if (!hit || reported.has(line)) continue;
      reported.add(line);
      const call = code.slice(at, at + match[0].length).replace(/\s+/g, '');
      findings.push({
        rule: 'n_plus_one', lineNo: line,
        message: `query call \`${call}\` runs once per loop iteration (N+1): fetch the rows in one query (an IN list, a join or an RPC) before the loop`,
      });
    }
  }

  if (supabase) {
    for (const match of code.matchAll(/\.\s*select\s*\(\s*(['"`])\s*\*\s*\1\s*\)/g)) {
      const end = statementEnd(masked, match.index);
      if (/\.\s*(?:limit|range|single|maybeSingle)\s*\(/.test(masked.slice(match.index, end))) continue;
      findings.push({
        rule: 'unbounded_select', lineNo: lineOf(code, match.index),
        message: "select('*') with no .limit()/.range(): select the columns you use and bound the rows of list queries",
      });
    }
  }
  return findings.sort((a, b) => a.lineNo - b.lineNo);
}

const check = async function checkQueryEfficiency(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: JS_EXTENSIONS });
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: NAME, data: { violations: {}, message: 'No git diff available' } };
  }
  const config = projectConfig(dir) || require('./_config.js').defaultConfig();
  const settings = sectionSettings(config);
  const custom = settings.call_patterns.map((p) => new RegExp(p, 'g'));
  const pkgCache = new Map();
  const rootDeps = nearestPackageDeps(dir, 'package.json', mode, pkgCache) || {};

  const violations = {};
  for (const file of files.filter((f) => !isTestOrGenerated(f))) {
    const deps = { ...rootDeps, ...(nearestPackageDeps(dir, file, mode, pkgCache) || {}) };
    const clients = Object.keys(PRESETS).filter((name) => Object.prototype.hasOwnProperty.call(deps, name));
    const patterns = [...clients.flatMap((name) => PRESETS[name]), ...custom];
    if (patterns.length === 0) continue;
    const content = readFile(dir, file, mode);
    if (content === null) continue;
    for (const finding of analyzeJs(content, patterns, clients.includes('@supabase/supabase-js'))) {
      const severity = settings.severities[finding.rule];
      if (severity === 'off') continue;
      (violations[file] = violations[file] || []).push({ ...finding, severity, label: severity === 'warning' ? `${finding.rule}, warning` : finding.rule });
    }
  }

  const all = Object.values(violations).flat();
  const errors = all.filter((v) => v.severity === 'error').length;
  return {
    exitCode: all.length > 0 ? 1 : 0,
    skipped: false,
    name: NAME,
    level: all.length > 0 && errors === 0 ? 'warning' : 'error',
    data: {
      violations,
      message: all.length > 0
        ? `${all.length} query efficiency issue(s) (${errors} error(s)) in ${Object.keys(violations).length} file(s)`
        : 'Query efficiency checks passed',
    },
  };
};

check.analyzeJs = analyzeJs;
module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
