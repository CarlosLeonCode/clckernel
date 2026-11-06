#!/usr/bin/env node
/**
 * Journal Guard
 * One short journal entry per audited SDD change, committed with the change.
 *   - required: for each sdds/<change>/audit-receipt*.json (written by
 *     `audit --change <change>`) whose commitHash is the current HEAD (the
 *     audited change about to be committed), an entry
 *     <dir>/<YYYY>/<YYYYMMDDTHHMMZ>-<change>.md must be in the index or in
 *     HEAD; if not, the change is named with the command that creates the
 *     entry (npx clckernel journal <change>). Receipts naming another commit
 *     (older changes) are ignored.
 *   - format: every file of the snapshot under <dir>/<YYYY>/ must be named
 *     <YYYYMMDDTHHMMZ>-<change>.md (UTC timestamp, in the folder of its
 *     year), have a frontmatter `change:` equal to the change of its name,
 *     the sections ## Context, ## Decision, ## Alternatives and
 *     ## Consequences, and at most max_lines lines. Files directly in <dir>
 *     (numbered ADRs, templates/) are not checked.
 * <dir> is journal.dir in .clckernel.yaml (default docs/Journal), max_lines
 * is journal.max_lines (default 80). The receipts are local (sdds/ is
 * gitignored): without sdds/ (CI, a fresh clone) or without a commit yet the
 * guard is skipped and says why.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Project root (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { changedFiles, readFile, listFiles, projectConfig } = require('./_changes');

const NAME = 'check_journal';
/** The rule `audit --change <name>` applies (tools/audit.js, tools/audit.py). */
const CHANGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SECTIONS = ['Context', 'Decision', 'Alternatives', 'Consequences'];
/** Settings when the config has no journal key (an older tools/_config.js). */
const DEFAULTS = { dir: 'docs/Journal', max_lines: 80 };
const ENTRY_NAME = new RegExp(
  `^((\\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3])[0-5]\\dZ)-(${CHANGE_NAME.source.slice(1, -1)})\\.md$`,
);
const RECEIPT_NAME = /^audit-receipt.*\.json$/;

/** Runs git in dir; trimmed stdout, or null on any failure. */
function git(dir, args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return res.error || res.status !== 0 ? null : res.stdout.trim();
}

/**
 * The parts of an entry file name, or null when it is not one.
 * @param {string} name - Base name, e.g. 20261106T1305Z-add-cache.md
 * @returns {{ stamp: string, year: string, change: string }|null}
 */
function parseEntryName(name) {
  const m = ENTRY_NAME.exec(name);
  return m ? { stamp: m[1], year: m[2], change: m[6] } : null;
}

/** The UTC timestamp of an entry name: YYYYMMDDTHHMMZ. */
function entryStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}Z`;
}

/**
 * Where a path sits in the journal: the year folder and the rest, or null
 * when it is not under <dir>/<YYYY>/.
 */
function inYearFolder(rel, journalDir) {
  if (!rel.startsWith(`${journalDir}/`)) return null;
  const parts = rel.slice(journalDir.length + 1).split('/');
  if (parts.length < 2 || !/^\d{4}$/.test(parts[0])) return null;
  return { year: parts[0], rest: parts.slice(1).join('/') };
}

/** The frontmatter keys of a Markdown text (the block between the first two --- lines). */
function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const keys = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (m) keys[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return keys;
}

/**
 * The reasons an entry is invalid ([] when it is valid).
 * @param {{ year: string, rest: string }} where - From inYearFolder
 * @param {string|null} text - The entry's content (null: not a text file)
 * @param {number} maxLines - journal.max_lines
 * @returns {string[]}
 */
function entryProblems(where, text, maxLines) {
  const problems = [];
  const parsed = where.rest.includes('/') ? null : parseEntryName(where.rest);
  if (!parsed || parsed.year !== where.year) {
    problems.push('invalid name: expected <dir>/<YYYY>/<YYYYMMDDTHHMMZ>-<change>.md, a UTC timestamp in the folder of its year (npx clckernel journal <change> creates it)');
  }
  if (text === null) return [...problems, 'not a text file'];
  const keys = frontmatter(text);
  if (!keys || !keys.change) {
    problems.push('the frontmatter has no `change:` key');
  } else if (parsed && keys.change !== parsed.change) {
    problems.push(`the frontmatter change "${keys.change}" is not the change of the file name ("${parsed.change}")`);
  }
  for (const section of SECTIONS) {
    if (!new RegExp(`^## ${section}[ \\t]*\\r?$`, 'm').test(text)) problems.push(`missing section ## ${section}`);
  }
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/).length;
  if (lines > maxLines) problems.push(`${lines} lines, more than journal.max_lines (${maxLines}): keep the entry short`);
  return problems;
}

/**
 * The SDD changes audited on `head`: sdds/<change>/audit-receipt*.json files
 * whose commitHash is head. Unreadable receipts are ignored.
 * @returns {Array<{ change: string, receipt: string }>}
 */
function auditedChanges(sddsDir, head) {
  const entries = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const out = [];
  for (const folder of entries(sddsDir).filter((e) => e.isDirectory() && CHANGE_NAME.test(e.name))) {
    const receipts = entries(path.join(sddsDir, folder.name)).filter((e) => e.isFile() && RECEIPT_NAME.test(e.name));
    const match = receipts.map((e) => e.name).sort().find((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(sddsDir, folder.name, name), 'utf-8')).commitHash === head;
      } catch {
        return false;
      }
    });
    if (match) out.push({ change: folder.name, receipt: `sdds/${folder.name}/${match}` });
  }
  return out.sort((a, b) => a.change.localeCompare(b.change));
}

const check = async function checkJournal(targetDir) {
  const dir = targetDir || process.cwd();
  const skip = (message) => ({ exitCode: 0, skipped: true, name: NAME, data: { violations: [], message } });

  const { mode, files } = changedFiles(dir);
  if (mode === null) return skip('No git repository');
  if (!fs.existsSync(path.join(dir, 'sdds'))) {
    return skip('No sdds/ folder: the audit receipts are local (sdds/ is gitignored), so there is nothing to check here (CI, a fresh clone)');
  }
  const head = git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!head) return skip('No commit yet: an audit receipt names the commit it ran on (HEAD), so no change can be matched');

  const config = projectConfig(dir);
  const journal = { ...DEFAULTS, ...((config && config.journal) || {}) };
  const prefix = git(dir, ['rev-parse', '--show-prefix']) || '';
  const journalDir = path.posix.join(prefix, journal.dir);

  const violations = [];
  const snapshot = new Set([...listFiles(dir, 'staged'), ...listFiles(dir, 'last-commit')]);
  const changesWithEntry = new Set();
  for (const rel of snapshot) {
    const where = inYearFolder(rel, journalDir);
    const parsed = where && !where.rest.includes('/') ? parseEntryName(where.rest) : null;
    if (parsed && parsed.year === where.year) changesWithEntry.add(parsed.change);
  }
  const audited = auditedChanges(path.join(dir, 'sdds'), head);
  for (const { change, receipt } of audited) {
    if (changesWithEntry.has(change)) continue;
    violations.push({
      change,
      file: receipt,
      message: `Audited change "${change}" (${receipt}, commit ${head.slice(0, 7)}) has no journal entry in ${journal.dir}/<YYYY>/: run \`npx clckernel journal ${change}\`, fill it in from the SDD and stage it with the change`,
    });
  }

  const entries = files.filter((rel) => inYearFolder(rel, journalDir));
  for (const rel of entries) {
    for (const problem of entryProblems(inYearFolder(rel, journalDir), readFile(dir, rel, mode), journal.max_lines)) {
      violations.push({ file: rel, message: problem });
    }
  }

  if (audited.length === 0 && entries.length === 0) {
    return skip(`No SDD change audited on HEAD (${head.slice(0, 7)}) and no changed journal entry`);
  }
  return {
    exitCode: violations.length > 0 ? 1 : 0,
    skipped: false,
    name: NAME,
    data: {
      violations,
      message: violations.length > 0
        ? `${violations.length} journal issue(s)`
        : `Journal entries present for ${audited.length} audited change(s); ${entries.length} changed entry file(s) valid`,
    },
  };
};

check.CHANGE_NAME = CHANGE_NAME;
check.SECTIONS = SECTIONS;
check.parseEntryName = parseEntryName;
check.entryStamp = entryStamp;
module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
