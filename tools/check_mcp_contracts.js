#!/usr/bin/env node
/**
 * MCP Contract Guard
 * Checks the changed JS/TS files of packages that depend on
 * @modelcontextprotocol/sdk. A tool registration is a call
 * `<x>.registerTool("name", { inputSchema, ... }, cb)` (the SDK's current API)
 * or the deprecated `<x>.tool("name", [description], [schema], [annotations], cb)`
 * whose first argument is a string literal. Rules, each with its own level
 * (`mcp_contracts.severities` in .clckernel.yaml):
 *   inline_schema  the input schema is written inline (z.object(...), z.*, or
 *                  a raw shape object with zod members) (error)
 *   schema_source  the input schema's identifier is not imported from one of
 *                  `mcp_contracts.contracts_modules` (or a subpath); with no
 *                  modules configured, it must at least be imported (error)
 *   data_client    a file registering tools imports a data client
 *                  (@supabase/supabase-js, drizzle-orm, @prisma/client,
 *                  postgres, pg; type-only imports included) while
 *                  `mcp_contracts.forbid_data_clients` is true (error):
 *                  tools call use cases
 * A heuristic on source text: a config object passed as a variable, or a
 * schema re-exported through a local file, is not followed. Test files are
 * skipped. Self-contained: uses only Node.js built-ins.
 */
const { changedFiles, readFile, nearestPackageDeps, projectConfig } = require('./_changes');
const { maskJs, matchingClose, lineOf, isTestOrGenerated, JS_EXTENSIONS } = require('./_jscode');

const NAME = 'check_mcp_contracts';
const MCP_SDK = '@modelcontextprotocol/sdk';
const DATA_CLIENTS = ['@supabase/supabase-js', 'drizzle-orm', '@prisma/client', 'postgres', 'pg'];

const underModule = (spec, mod) => spec === mod || spec.startsWith(`${mod}/`);

/** Local name -> module specifier of every import / require in the code. */
function importsOf(code) {
  const bindings = new Map();
  const specs = [];
  const importRe = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*(['"])([^'"]+)\2/g;
  for (const match of code.matchAll(importRe)) {
    const clause = match[1];
    const spec = match[3];
    specs.push({ spec, at: match.index });
    const ns = /\*\s*as\s+([\w$]+)/.exec(clause);
    if (ns) bindings.set(ns[1], spec);
    const named = /\{([\s\S]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1].split(',')) {
        const words = part.replace(/\btype\s+/, '').trim().split(/\s+as\s+/);
        const local = (words[1] || words[0] || '').trim();
        if (local) bindings.set(local, spec);
      }
    }
    const def = /^\s*([\w$]+)\s*(?:,|$)/.exec(clause);
    if (def && def[1] !== 'type') bindings.set(def[1], spec);
  }
  for (const match of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) specs.push({ spec: match[2], at: match.index });
  const requireRe = /\b(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+import|require)\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
  for (const match of code.matchAll(requireRe)) {
    const spec = match[3];
    specs.push({ spec, at: match.index });
    const names = match[1].startsWith('{')
      ? match[1].slice(1, -1).split(',').map((p) => (p.split(':')[1] || p.split(':')[0]).trim())
      : [match[1]];
    for (const name of names) if (name) bindings.set(name, spec);
  }
  for (const match of code.matchAll(/\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) specs.push({ spec: match[2], at: match.index });
  return { bindings, specs };
}

/** Top-level comma-separated pieces of masked[from, to): [{ start, end }]. */
function splitArgs(masked, from, to) {
  const pieces = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const ch = masked[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      pieces.push({ start, end: i });
      start = i + 1;
    }
  }
  if (masked.slice(start, to).trim()) pieces.push({ start, end: to });
  return pieces.map(({ start: s, end: e }) => {
    const lead = masked.slice(s, e).length - masked.slice(s, e).trimStart().length;
    return { start: s + lead, end: s + lead + masked.slice(s, e).trim().length };
  });
}

/** The `inputSchema` value of an object literal at masked[start, end), or null. */
function inputSchemaOf(masked, start, end) {
  const props = splitArgs(masked, start + 1, end - 1);
  for (const prop of props) {
    const text = masked.slice(prop.start, prop.end);
    const kv = /^inputSchema\s*:\s*/.exec(text);
    if (kv) return { start: prop.start + kv[0].length, end: prop.end };
    if (/^inputSchema$/.test(text)) return prop;
  }
  return null;
}

const ZOD_MEMBER = /\b(?:z|zod)\s*\.\s*[\w$]+/;

/**
 * The finding for one schema expression, or null when it is compliant.
 * @returns {{ rule: string, message: string }|null}
 */
function schemaFinding(tool, code, masked, expr, bindings, modules) {
  const text = masked.slice(expr.start, expr.end).trim();
  if (/^(?:z|zod)\s*\./.test(text) || (text.startsWith('{') && ZOD_MEMBER.test(text))) {
    return { rule: 'inline_schema', message: `tool "${tool}" declares its input schema inline: import it from ${modules.length ? modules.join(' or ') : 'a contracts module'}` };
  }
  if (text.startsWith('{')) return null; // annotations object (tool() overloads)
  const root = /^[A-Za-z_$][\w$]*/.exec(text);
  if (!root) return null;
  const spec = bindings.get(root[0]);
  const ok = spec !== undefined && spec !== 'zod' && (modules.length === 0 || modules.some((m) => underModule(spec, m)));
  if (ok) return null;
  const where = spec === undefined ? 'is declared in this file' : `comes from "${spec}"`;
  return {
    rule: 'schema_source',
    message: `tool "${tool}" input schema \`${code.slice(expr.start, expr.end).trim()}\` ${where}: import it from ${modules.length ? modules.join(' or ') : 'a shared contracts module'}`,
  };
}

/**
 * Findings of one file.
 * @param {string} source
 * @param {{ contracts_modules: string[], forbid_data_clients: boolean }} settings
 * @returns {Array<{ rule: string, lineNo: number, message: string }>}
 */
function analyzeMcp(source, settings) {
  const { code, masked } = maskJs(source);
  const { bindings, specs } = importsOf(code);
  const modules = settings.contracts_modules;
  const findings = [];
  let registrations = 0;

  for (const match of masked.matchAll(/\.\s*(registerTool|tool)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchingClose(masked, open);
    if (close < 0) continue;
    const args = splitArgs(masked, open + 1, close);
    if (args.length < 2 || !/^['"`]/.test(masked[args[0].start])) continue;
    registrations++;
    const tool = code.slice(args[0].start + 1, args[0].end - 1);
    const lineNo = lineOf(masked, match.index);
    let schemas = [];
    if (match[1] === 'registerTool') {
      const config = args[1];
      if (masked[config.start] === '{') {
        const schema = inputSchemaOf(masked, config.start, config.end);
        if (schema) schemas = [schema];
      }
    } else {
      // tool(name, [description], [schema | annotations], [annotations], cb)
      schemas = args.slice(1, -1).filter((a) => !/^['"`]/.test(masked[a.start])).slice(0, 1);
    }
    for (const expr of schemas) {
      const finding = schemaFinding(tool, code, masked, expr, bindings, modules);
      if (finding) findings.push({ ...finding, lineNo });
    }
  }

  if (registrations > 0 && settings.forbid_data_clients) {
    const seen = new Set();
    for (const { spec, at } of specs) {
      const client = DATA_CLIENTS.find((c) => underModule(spec, c));
      if (!client || seen.has(spec)) continue;
      seen.add(spec);
      findings.push({
        rule: 'data_client', lineNo: lineOf(code, at),
        message: `this file registers MCP tools and imports the data client "${spec}": tools call use cases, which reach the database through their adapters`,
      });
    }
  }
  return findings.sort((a, b) => a.lineNo - b.lineNo);
}

const check = async function checkMcpContracts(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: JS_EXTENSIONS });
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: NAME, data: { violations: {}, message: 'No git diff available' } };
  }
  const config = projectConfig(dir) || require('./_config.js').defaultConfig();
  const settings = config.mcp_contracts;
  const pkgCache = new Map();
  const rootDeps = nearestPackageDeps(dir, 'package.json', mode, pkgCache) || {};

  const violations = {};
  for (const file of files.filter((f) => !isTestOrGenerated(f))) {
    const deps = { ...rootDeps, ...(nearestPackageDeps(dir, file, mode, pkgCache) || {}) };
    if (!Object.prototype.hasOwnProperty.call(deps, MCP_SDK)) continue;
    const content = readFile(dir, file, mode);
    if (content === null) continue;
    for (const finding of analyzeMcp(content, settings)) {
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
        ? `${all.length} MCP contract issue(s) (${errors} error(s)) in ${Object.keys(violations).length} file(s)`
        : 'MCP contract checks passed',
    },
  };
};

check.analyzeMcp = analyzeMcp;
module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
