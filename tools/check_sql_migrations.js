#!/usr/bin/env node
/**
 * SQL Migration Guard
 * Checks the SQL migration files of the snapshot being verified (by default
 * `**\/supabase/migrations/**\/*.sql`, `sql_migrations.paths` in .clckernel.yaml).
 * Rules, each with its own level (`sql_migrations.severities`):
 *   immutable    an applied migration is modified or deleted (error); applied
 *                = present at the merge-base with the branch's upstream when
 *                there is one (pushed), else at BASE (HEAD when staged, HEAD~1
 *                for the last commit)
 *   rls          a `create table` in one of `sql_migrations.schemas` (default
 *                public) has no `enable row level security` in the same file (error)
 *   search_path  a `security definer` function sets no search_path, in its
 *                `create` or a later `alter function ... set search_path` (error)
 *   anon_write   insert/update/delete/all is granted to a role of
 *                `sql_migrations.anon_roles` (default anon) (error)
 *   destructive  `drop table` / `alter table ... drop [column] c`, named (warning)
 * Unqualified names resolve to the first schema of the last `set search_path`
 * (public without one); quoted identifiers keep their case.
 * The SQL is read statement by statement, case-insensitively; comments, string
 * literals and dollar-quoted bodies are blanked first, so their text never
 * matches. A heuristic, not a SQL parser: dynamic SQL (EXECUTE) is not seen.
 * Only warnings => the result's level is 'warning' (reported, not blocking).
 * Self-contained: uses only Node.js built-ins.
 */
const { spawnSync } = require('child_process');
const { changedFiles, readFile, projectConfig, globMatcher, currentGuard } = require('./_changes');

const NAME = 'check_sql_migrations';

/**
 * Settings when the config has no sql_migrations section (an older
 * tools/_config.js): the defaults of GUARD_SECTIONS.sql_migrations there.
 */
const DEFAULTS = {
  paths: ['**/supabase/migrations/**/*.sql'],
  schemas: ['public'],
  anon_roles: ['anon'],
  severities: { immutable: 'error', rls: 'error', search_path: 'error', anon_write: 'error', destructive: 'warning' },
};

/** The project config (defaults when it has no file) and its sql_migrations settings. */
function settings(dir) {
  const config = projectConfig(dir) || require('./_config.js').defaultConfig();
  const own = config.sql_migrations || {};
  return { config, sql: { ...DEFAULTS, ...own, severities: { ...DEFAULTS.severities, ...(own.severities || {}) } } };
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

/**
 * Statements of masked SQL: { text, start, end } with start/end = offsets of
 * its first and past its last non-space character.
 */
function statements(masked) {
  const list = [];
  let from = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ';') {
      const raw = masked.slice(from, i);
      const lead = raw.length - raw.trimStart().length;
      if (raw.trim()) list.push({ text: raw.trim(), start: from + lead, end: from + lead + raw.trim().length });
      from = i + 1;
    }
  }
  return list;
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][\\w$]*)';
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;

/** An identifier as PostgreSQL resolves it: quoted keeps its case, unquoted folds to lower case. */
const identName = (p) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase());

/**
 * { schema, name } of a possibly qualified, possibly quoted name; an
 * unqualified one is in `schema` (the first schema of the search_path the
 * migration set, else public).
 */
function splitName(raw, schema = 'public') {
  const parts = raw.match(new RegExp(IDENT, 'g')).map(identName);
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema, name: parts[0] };
}

/**
 * The schema unqualified names resolve to after `set [session|local]
 * search_path = a, b` (or `to`): the first listed schema other than
 * "$user" and pg_catalog; null when the statement is not one, or lists none.
 * @param {string} original - The statement in the source (literals kept)
 * @returns {string|null|undefined} undefined when the statement is not a set search_path
 */
function searchPathSchema(original) {
  const m = /^set\s+(?:session\s+|local\s+)?search_path\s*(?:=|\bto\b)\s*([\s\S]*)$/i.exec(original.trim());
  if (!m) return undefined;
  for (const item of m[1].split(',')) {
    const value = item.trim().replace(/^'(.*)'$/s, '$1').trim();
    if (!value || value.toLowerCase() === 'default') continue;
    const name = identName(value);
    if (name === '$user' || name === 'pg_catalog') continue;
    if (!new RegExp(`^${IDENT}$`).test(value)) continue;
    return name;
  }
  return null;
}

/** Top-level comma-separated actions of an `alter table` (commas inside brackets kept). */
function alterActions(text) {
  const actions = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ',' && depth === 0) || i === text.length) {
      actions.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  return actions.filter(Boolean);
}

const fullName = ({ schema, name }) => `${schema}.${name}`;

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Findings of rules rls, search_path, anon_write and destructive in one file.
 * An unqualified name resolves to the schema of the last `set search_path`
 * before it (public without one); quoted names keep their case. A
 * `security definer` function may set its search_path in the `create` or
 * in a later `alter function|procedure ... set search_path` of the file.
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
  const definers = [];
  const pathSet = new Set();
  let schema = 'public';

  for (const stmt of statements(masked)) {
    const text = stmt.text.replace(/\s+/g, ' ');
    const lineNo = lineOf(masked, stmt.start);

    const searchPath = searchPathSchema(sql.slice(stmt.start, stmt.end));
    if (searchPath) schema = searchPath;
    if (searchPath !== undefined) continue;

    const table = new RegExp(`^create (?:(?:global|local) )?(temp |temporary |unlogged )?table (?:if not exists )?(${QUALIFIED})`, 'i').exec(text);
    if (table && !/^temp/i.test((table[1] || '').trim())) {
      const name = splitName(table[2], schema);
      if (schemas.has(name.schema.toLowerCase())) created.push({ name, lineNo });
    }

    const rls = new RegExp(`^alter table (?:if exists )?(?:only )?(${QUALIFIED}) enable row level security\\b`, 'i').exec(text);
    if (rls) secured.add(fullName(splitName(rls[1], schema)));

    const fn = new RegExp(`^create (?:or replace )?(function|procedure) (${QUALIFIED})`, 'i').exec(text);
    if (fn && /\bsecurity definer\b/i.test(text) && !/\bset search_path\b/i.test(text)) {
      definers.push({ kind: fn[1].toLowerCase(), name: fullName(splitName(fn[2], schema)), lineNo });
    }
    const alterFn = new RegExp(`^alter (function|procedure) (${QUALIFIED})\\b.*\\bset search_path\\b`, 'i').exec(text);
    if (alterFn) pathSet.add(fullName(splitName(alterFn[2], schema)));

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
        findings.push({ rule: 'destructive', lineNo, message: `drops table ${fullName(splitName(raw.trim(), schema))}: data is lost; make sure it is intended and backed up` });
      }
    }

    const alter = new RegExp(`^alter table (?:if exists )?(?:only )?(${QUALIFIED}) (.*)$`, 'i').exec(text);
    if (alter) {
      const tableName = fullName(splitName(alter[1], schema));
      // DROP [COLUMN] [IF EXISTS] c; DROP CONSTRAINT is not a column.
      const columnRe = new RegExp(`^drop (?:column )?(?:if exists )?(${IDENT})(?: cascade| restrict)?$`, 'i');
      for (const action of alterActions(alter[2])) {
        const match = columnRe.exec(action);
        if (!match || /^constraint$/i.test(match[1])) continue;
        findings.push({ rule: 'destructive', lineNo, message: `drops column ${tableName}.${identName(match[1])}: data is lost; make sure it is intended and backed up` });
      }
    }
  }

  for (const { kind, name, lineNo } of definers) {
    if (pathSet.has(name)) continue;
    findings.push({
      rule: 'search_path', lineNo,
      message: `security definer ${kind} ${name} does not set search_path: add \`set search_path = ''\` (or explicit schemas)`,
    });
  }
  for (const { name, lineNo } of created) {
    if (!secured.has(fullName(name))) {
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
 * The commit whose migrations count as applied: the merge-base of the
 * snapshot's parent (HEAD when staged, HEAD~1 for the last commit) with the
 * branch's upstream when it has one (what was pushed), else that parent.
 * null when the snapshot has no parent commit.
 */
function appliedBase(dir, mode) {
  const parent = mode === 'staged' ? 'HEAD' : 'HEAD~1';
  if (git(dir, ['rev-parse', '--verify', '--quiet', `${parent}^{commit}`]) === null) return null;
  if (git(dir, ['rev-parse', '--verify', '--quiet', '@{upstream}^{commit}']) !== null) {
    const base = git(dir, ['merge-base', parent, '@{upstream}']);
    if (base && base.trim()) return base.trim();
  }
  return parent;
}

/**
 * Migrations the snapshot modifies or deletes (renames counted as a deletion
 * of the old path) that exist at appliedBase: a migration added after the
 * upstream (not pushed yet) may still change.
 */
function changedAtBase(dir, mode) {
  const base = appliedBase(dir, mode);
  if (base === null) return [];
  const args = ['--name-status', '-z', '--no-renames', '--diff-filter=MD'];
  const out = mode === 'staged'
    ? git(dir, ['diff', '--cached', ...args, 'HEAD'])
    : git(dir, ['diff', ...args, 'HEAD~1', 'HEAD']);
  if (!out) return [];
  const fields = out.split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) entries.push({ status: fields[i], file: fields[i + 1] });
  const parent = mode === 'staged' ? 'HEAD' : 'HEAD~1';
  if (base === parent) return entries;
  return entries.filter(({ file }) => git(dir, ['cat-file', '-e', `${base}:${file}`]) !== null);
}

const check = async function checkSqlMigrations(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: ['.sql'] });
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: NAME, data: { violations: {}, message: 'No git diff available' } };
  }
  const { config, sql } = settings(dir);
  const isMigration = globMatcher(sql.paths);
  const excludedGlobs = [...(config.exclude_paths || []), ...((config.guard_exclude || {})[currentGuard()] || [])];
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
      message: `${status === 'D' ? 'deletes' : 'modifies'} a migration that is already applied (pushed, or at BASE): applied migrations are immutable; add a new migration instead`,
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
