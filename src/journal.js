/**
 * CLC Kernel — `clckernel journal <change> [targetDir]`.
 *
 * Creates the journal entry of an SDD change:
 * <journal.dir>/<YYYY>/<YYYYMMDDTHHMMZ>-<change>.md (UTC; journal.dir from
 * .clckernel.yaml, default docs/Journal), with the frontmatter and the four
 * sections tools/check_journal.js requires, each with one guide line. The
 * human or the agent fills it in from the SDD; nothing is parsed from it.
 *
 * - The change name follows the rule of `audit --change` (CHANGE_NAME of
 *   tools/audit.js, reused here).
 * - A change that already has an entry (any year) is refused.
 * - The clock is injectable: createEntry's `now` option (tests); the CLI uses
 *   the current time.
 * - The entry is a project file the user edits, not a kernel-owned one: it is
 *   written with plain fs (exclusive create), not through the install/update
 *   io layer, which registers and protects kernel files.
 */

const fs = require('fs');
const path = require('path');
const { CHANGE_NAME } = require('../tools/audit.js');
const { SECTIONS, parseEntryName, entryStamp } = require('../tools/check_journal.js');
const { readProjectConfig } = require('./config');

/** The guide line of each section of a new entry. */
const GUIDES = {
  Context: 'The problem or need behind the change, and the evidence that showed it.',
  Decision: 'What was decided and why: the rules, boundaries or invariants it sets.',
  Alternatives: 'The options considered and why each one was not chosen.',
  Consequences: 'What changes for the code, its users and later work; the trade-offs accepted.',
};

class JournalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JournalError';
  }
}

/** The Markdown of a new entry. */
function entryTemplate(change, now) {
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = ['---', `change: ${change}`, `date: ${date}`, '---', '', `# ${change}`, ''];
  for (const section of SECTIONS) lines.push(`## ${section}`, GUIDES[section], '');
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/** Project-relative paths of the existing entries of `change` under journalDir (any year). */
function existingEntries(root, journalDir, change) {
  const base = path.join(root, journalDir);
  const read = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  return read(base)
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .flatMap((year) => read(path.join(base, year.name))
      .filter((e) => e.isFile() && (parseEntryName(e.name) || {}).change === change)
      .map((e) => path.posix.join(journalDir, year.name, e.name)));
}

/**
 * Creates the entry of `change` in the project at targetDir.
 * @param {string} targetDir - Project root
 * @param {string} change - SDD change name (the `audit --change` rule)
 * @param {{ now?: Date }} [options] - now: the clock (default: the current time)
 * @returns {{ path: string, rel: string }} Absolute and project-relative path
 * @throws {JournalError} invalid name or an existing entry; ConfigError on an invalid config
 */
function createEntry(targetDir, change, { now = new Date() } = {}) {
  if (typeof change !== 'string' || !CHANGE_NAME.test(change)) {
    throw new JournalError(`invalid change name ${JSON.stringify(change)}: use one path segment (letters, digits, ., _, -), as with audit --change`);
  }
  const root = path.resolve(targetDir);
  const journalDir = readProjectConfig(root).config.journal.dir;
  const existing = existingEntries(root, journalDir, change);
  if (existing.length > 0) {
    throw new JournalError(`change "${change}" already has an entry: ${existing.join(', ')} (edit it instead)`);
  }
  const stamp = entryStamp(now);
  const rel = path.posix.join(journalDir, stamp.slice(0, 4), `${stamp}-${change}.md`);
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 'wx': never overwrite, even if the file appeared since the check.
  fs.writeFileSync(file, entryTemplate(change, now), { encoding: 'utf-8', flag: 'wx' });
  return { path: file, rel };
}

/**
 * `journal` arguments: the change name, then at most one target dir; no flags.
 * @param {string[]} rest - Arguments after `journal`
 * @returns {{ change: string, targetDir?: string }|null} null on unknown input
 */
function parseJournalArgs(rest) {
  if (rest.some((arg) => arg.startsWith('-')) || rest.length === 0 || rest.length > 2) return null;
  return { change: rest[0], targetDir: rest[1] };
}

module.exports = { createEntry, parseJournalArgs, entryTemplate, JournalError };
