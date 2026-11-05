#!/usr/bin/env node
/**
 * SQL Migration Guard
 * Checks the SQL migration files of the snapshot being verified (by default
 * `**\/supabase/migrations/**\/*.sql`, `sql_migrations.paths` in .clckernel.yaml).
 * Rules, each with its own level (`sql_migrations.severities`):
 *   immutable    a migration present at BASE is modified or deleted (error)
 *   rls          a `create table` in one of `sql_migrations.schemas` (default
 *                public) has no `enable row level security` in the same file (error)
 *   search_path  a `security definer` function does not set search_path (error)
 *   anon_write   insert/update/delete/all is granted to a role of
 *                `sql_migrations.anon_roles` (default anon) (error)
 *   destructive  `drop table` / `alter table ... drop column`, named (warning)
 * The SQL is read statement by statement, case-insensitively; comments, string
 * literals and dollar-quoted bodies are blanked first, so their text never
 * matches. A heuristic, not a SQL parser: dynamic SQL (EXECUTE) is not seen.
 * Only warnings => the result's level is 'warning' (reported, not blocking).
 * Self-contained: uses only Node.js built-ins.
 */
const { spawnSync } = require('child_process');
const { changedFiles, readFile, projectConfig, globMatcher, currentGuard } = require('./_changes');

const NAME = 'check_sql_migrations';

/** Default settings when the project has no config file. */
function settings(dir) {
  const config = projectConfig(dir) || require('./_config.js').defaultConfig();
  return { config, sql: config.sql_migrations };
}

/**
 * The SQL with comments, string literals and dollar-quoted bodies replaced by
 * spaces (newlines kept): same length and line numbers as the source.
 * Quoted identifiers ("...") are kept.
 * @param {string} sql
 * @returns {string}
 */
function maskSql(sql) {
  const out = sql.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      // Block comments nest in PostgreSQL.
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; } else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; } else j++;
      }
      blank(i, j);
      i = j;
    } else if (ch === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && !/[\w$]/.test(sql[i - 2] || '');
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      i = end < 0 ? sql.length : end + 1;
    } else if (ch === '$' && !/[\w$]/.test(sql[i - 1] || '')) {
      const tag = /^\$([A-Za-z_][\w]*)?\$/.exec(sql.slice(i));
      if (!tag) { i++; continue; }
      const end = sql.indexOf(tag[0], i + tag[0].length);
      const stop = end < 0 ? sql.length : end + tag[0].length;
      blank(i, stop);
      i = stop;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Statements of masked SQL: { text, start } with start = offset of its first non-space character. */
function statements(masked) {
  const list = [];
  let from = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ';') {
      const raw = masked.slice(from, i);
      const lead = raw.length - raw.trimStart().length;
      if (raw.trim()) list.push({ text: raw.trim(), start: from + lead });
      from = i + 1;
    }
  }
  return list;
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][\\w$]*)';
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;

/** { schema, name } of a possibly qualified, possibly quoted name; unqualified => public. */
function splitName(raw) {
  const parts = raw.match(new RegExp(IDENT, 'g')).map((p) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()));
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: 'public', name: parts[0] };
}

const fullName = ({ schema, name }) => `${schema}.${name}`;

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Findings of rules rls, search_path, anon_write and destructive in one file.
 * @param {string} sql - File content
 * @param {{ schemas: string[], anon_roles: string[] }} options
 * @returns {Array<{ rule: string, lineNo: number, message: string }>}
 */
function analyzeSql(sql, options) {
  const schemas = new Set(options.schemas.map((s) => s.toLowerCase()));
  const anonRoles = new Set(options.anon_roles.map((r) => r.toLowerCase()));
  const masked = maskSql(sql);
  const findings = [];
  const created = [];
  const secured = new Set();

  for (const stmt of statements(masked)) {
    const text = stmt.text.replace(/\s+/g, ' ');
    const lineNo = lineOf(masked, stmt.start);

    const table = new RegExp(`^create (?:(?:global|local) )?(temp |temporary |unlogged )?table (?:if not exists )?(${QUALIFIED})`, 'i').exec(text);
    if (table && !/^temp/i.test((table[1] || '').trim())) {
      const name = splitName(table[2]);
      if (schemas.has(name.schema.toLowerCase())) created.push({ name, lineNo });
    }

    const rls = new RegExp(`^alter table (?:if exists )?(?:only )?(${QUALIFIED}) enable row level security\\b`, 'i').exec(text);
    if (rls) secured.add(fullName(splitName(rls[1])).toLowerCase());

    const fn = new RegExp(`^create (?:or replace )?(function|procedure) (${QUALIFIED})`, 'i').exec(text);
    if (fn && /\bsecurity definer\b/i.test(text) && !/\bset search_path\b/i.test(text)) {
      findings.push({
        rule: 'search_path', lineNo,
        message: `security definer ${fn[1].toLowerCase()} ${fullName(splitName(fn[2]))} does not set search_path: add \`set search_path = ''\` (or explicit schemas)`,
      });
    }

    const grant = /(?:^|\s)grant (.+?) on (.+?) to (.+?)(?: with grant option| granted by .*)?$/i.exec(text);
    if (grant) {
      const privileges = grant[1].split(',').map((p) => p.trim().split(/[\s(]/)[0].toLowerCase());
      const writes = privileges.filter((p) => ['insert', 'update', 'delete', 'all'].includes(p));
      const roles = grant[3].split(',').map((r) => r.trim().replace(/^"|"$/g, '').toLowerCase()).filter((r) => anonRoles.has(r));
      if (writes.length > 0 && roles.length > 0) {
        findings.push({
          rule: 'anon_write', lineNo,
          message: `grants ${writes.join(', ')} on ${grant[2].trim()} to ${roles.join(', ')}: anonymous roles must not write; grant to an authenticated role and guard it with a policy`,
        });
      }
    }

    const drop = /^drop table (?:if exists )?(.+?)(?: cascade| restrict)?$/i.exec(text);
    if (drop) {
      for (const raw of drop[1].split(',')) {
        findings.push({ rule: 'destructive', lineNo, message: `drops table ${fullName(splitName(raw.trim()))}: data is lost; make sure it is intended and backed up` });
      }
    }

    const alter = new RegExp(`^alter table (?:if exists )?(?:only )?(${QUALIFIED}) (.*)$`, 'i').exec(text);
    if (alter) {
      const tableName = fullName(splitName(alter[1]));
      const columnRe = new RegExp(`\\bdrop column (?:if exists )?(${IDENT})`, 'gi');
      for (const match of alter[2].matchAll(columnRe)) {
        const column = match[1].startsWith('"') ? match[1].slice(1, -1) : match[1].toLowerCase();
        findings.push({ rule: 'destructive', lineNo, message: `drops column ${tableName}.${column}: data is lost; make sure it is intended and backed up` });
      }
    }
  }

  for (const { name, lineNo } of created) {
    if (!secured.has(fullName(name).toLowerCase())) {
      findings.push({
        rule: 'rls', lineNo,
        message: `table ${fullName(name)} has no \`alter table ${fullName(name)} enable row level security\` in this migration`,
      });
    }
  }
  return findings.sort((a, b) => a.lineNo - b.lineNo);
}

/** Runs git; stdout as a string, or null on failure. */
function git(dir, args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024 });
  return res.error || res.status !== 0 ? null : res.stdout;
}

/**
 * Paths modified or deleted relative to BASE (HEAD when staged, HEAD~1 for
 * the last commit), renames counted as a deletion of the old path.
 */
function changedAtBase(dir, mode) {
  let out = null;
  const args = ['--name-status', '-z', '--no-renames', '--diff-filter=MD'];
  if (mode === 'staged' && git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) !== null) {
    out = git(dir, ['diff', '--cached', ...args, 'HEAD']);
  } else if (mode === 'last-commit' && git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD~1^{commit}']) !== null) {
    out = git(dir, ['diff', ...args, 'HEAD~1', 'HEAD']);
  }
  if (!out) return [];
  const fields = out.split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) entries.push({ status: fields[i], file: fields[i + 1] });
  return entries;
}

const check = async function checkSqlMigrations(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: ['.sql'] });
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: NAME, data: { violations: {}, message: 'No git diff available' } };
  }
  const { config, sql } = settings(dir);
  const isMigration = globMatcher(sql.paths);
  const excludedGlobs = [...config.exclude_paths, ...((config.guard_exclude || {})[currentGuard()] || [])];
  const excluded = globMatcher(excludedGlobs);
  const levels = sql.severities;

  const violations = {};
  const add = (file, finding) => {
    const severity = levels[finding.rule];
    if (severity === 'off') return;
    (violations[file] = violations[file] || []).push({ ...finding, severity, label: severity === 'warning' ? `${finding.rule}, warning` : finding.rule });
  };

  for (const { status, file } of changedAtBase(dir, mode)) {
    if (!isMigration(file) || excluded(file)) continue;
    add(file, {
      rule: 'immutable', lineNo: 0,
      message: `${status === 'D' ? 'deletes' : 'modifies'} a migration that exists at BASE (already applied): applied migrations are immutable; add a new migration instead`,
    });
  }

  for (const file of files.filter(isMigration)) {
    const content = readFile(dir, file, mode);
    if (content === null) continue;
    for (const finding of analyzeSql(content, sql)) add(file, finding);
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
        ? `${all.length} SQL migration issue(s) (${errors} error(s)) in ${Object.keys(violations).length} file(s)`
        : 'SQL migration checks passed',
    },
  };
};

check.analyzeSql = analyzeSql;
check.maskSql = maskSql;
module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
