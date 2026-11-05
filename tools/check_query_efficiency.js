#!/usr/bin/env node
/**
 * Query Efficiency Guard (JS/TS counterpart of check_db_efficiency)
 * Checks the changed JS/TS files whose package (the nearest package.json, or
 * the repository root's) depends on a known data client. Rules, each with its
 * own level (`query_efficiency.severities` in .clckernel.yaml):
 *   n_plus_one        a query call awaited inside a loop body (for, for...of,
 *                     for await, while, do), or any query call inside a
 *                     .forEach( / .map(async / .flatMap(async callback (error)
 *   unbounded_select  supabase-js `.select('*')` without .limit( / .range( /
 *                     .single( / .maybeSingle( in the same statement (warning)
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

/** Loop bodies of masked code: [{ start, end, callback }] (callback: a .forEach/.map(async body). */
function loopBodies(masked) {
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
      const semi = masked.indexOf(';', bodyStart);
      const nl = masked.indexOf('\n', bodyStart);
      const end = semi >= 0 ? semi : (nl >= 0 ? nl : masked.length);
      bodies.push({ start: bodyStart, end, callback: false });
    }
  }
  const callback = /\.\s*(forEach|map|flatMap)\s*\(/g;
  for (const match of masked.matchAll(callback)) {
    const open = match.index + match[0].length - 1;
    const close = matchingClose(masked, open);
    if (close < 0) continue;
    if (match[1] !== 'forEach' && !/^\s*async\b/.test(masked.slice(open + 1, close))) continue;
    bodies.push({ start: open + 1, end: close, callback: true });
  }
  return bodies;
}

/** True when the statement holding `offset` awaits (an `await` since the last ; { or }). */
function awaited(masked, offset) {
  let k = offset - 1;
  while (k >= 0 && !';{}'.includes(masked[k])) k--;
  return /\bawait\b/.test(masked.slice(k + 1, offset));
}

/** End of the statement starting at offset: the next `;`, else the end of the text. */
function statementEnd(masked, offset) {
  const semi = masked.indexOf(';', offset);
  return semi < 0 ? masked.length : semi;
}

/**
 * Findings of one file.
 * @param {string} source
 * @param {RegExp[]} patterns - Query call patterns (global)
 * @param {boolean} supabase - The supabase-js preset applies (unbounded_select)
 * @returns {Array<{ rule: string, lineNo: number, message: string }>}
 */
function analyzeJs(source, patterns, supabase) {
  const { code, masked } = maskJs(source);
  const bodies = loopBodies(masked);
  const findings = [];
  const reported = new Set();

  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const at = match.index;
      const inside = bodies.filter((b) => at > b.start && at < b.end);
      if (inside.length === 0) continue;
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
  const settings = config.query_efficiency;
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
