/**
 * CLC Kernel — Gitignore Provisioning Engine
 * Ensures AI IDE mirror symlinks, local SDD specs, and ephemeral runtime artifacts
 * are safely ignored in consumer repositories to preserve AGENTS.md as the SSOT.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { currentIO } = require('./io');

// Repository-locating variables a hook may export; they would point git at
// another repository than the target's.
const GIT_LOCAL_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR'];

/**
 * Entries whose path (or, for a directory entry, anything under it) is
 * tracked by git in targetDir (sdds/update-no-additions, decision 3). Only
 * literal paths are checked: negations and glob patterns are kept as they
 * are. Outside a git repository nothing is tracked. One `git ls-files` call.
 * @param {string} targetDir - Project root
 * @param {string[]} entries - Candidate .gitignore entries
 * @returns {Set<string>}
 */
function trackedEntries(targetDir, entries) {
  const literal = entries.filter((e) => !e.startsWith('!') && !/[*?[\\]/.test(e));
  if (literal.length === 0) return new Set();
  const env = { ...process.env };
  for (const key of GIT_LOCAL_ENV) delete env[key];
  const bare = (e) => e.replace(/\/+$/, '');
  const res = spawnSync('git', ['ls-files', '-z', '--', ...literal.map((e) => `:(literal)${bare(e)}`)], {
    cwd: targetDir, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (res.error || res.status !== 0) return new Set();
  const files = res.stdout.split('\0').filter(Boolean);
  return new Set(literal.filter((e) => files.some((f) => f === bare(e) || f.startsWith(`${bare(e)}/`))));
}

/**
 * Managed entries per section. An `{ entry, ifExists: true }` item names an
 * artifact of an older release (sdds/onboarding): it is added only when that
 * path exists in the project, so a fresh install names no retired artifact.
 */
const MANAGED_GITIGNORE_SECTIONS = [
  {
    header: '# CLC Kernel: Local AI IDE Mirror Symlinks (SSOT: AGENTS.md)',
    entries: [
      'CLAUDE.md',
      'GEMINI.md',
      '.cursorrules',
      '.windsurfrules',
      '.cursor/',
      '.antigravity/',
      '.github/copilot-instructions.md',
    ],
  },
  {
    header: '# CLC Kernel: CLI Agent Skills & Playbooks',
    entries: [
      '.agents/skills/clckernel_cli/',
      { entry: '.agents/skills/clc_forge_cli/', ifExists: true },
    ],
  },
  {
    header: '# CLC Kernel: Local SDD Specs & Ephemeral Harness Artifacts',
    entries: [
      'sdds/*',
      '!sdds/.gitkeep',
      'openspec/*',
      '!openspec/.gitkeep',
      { entry: '.clckernel.resolved.json', ifExists: true },
      { entry: '.clc-forge.resolved.json', ifExists: true },
      '.husky/_/',
      '.ruff_cache/',
      '*.clckernel-new',
    ],
  },
];

/**
 * Idempotently appends missing CLC Kernel entries to target project's .gitignore.
 *
 * Writes through the active io session (sdds/safe-update), so a dry run
 * only records the entries it would add. An entry whose path git tracks is
 * not added (sdds/update-no-additions, decision 3).
 *
 * @param {string} targetDir - Target project root
 * @returns {boolean} True if .gitignore was created or modified, false if already complete.
 */
function ensureGitignoreEntries(targetDir) {
  const io = currentIO(targetDir);
  const gitignorePath = path.join(targetDir, '.gitignore');
  const existing = io.read(gitignorePath);
  const currentContent = existing ? existing.toString('utf-8') : '';

  const existingLines = new Set(
    currentContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
  );

  const sectionsToAppend = [];
  const added = [];

  const entriesOf = (section) => section.entries
    .filter(item => typeof item === 'string' || io.exists(path.join(targetDir, item.entry)))
    .map(item => (typeof item === 'string' ? item : item.entry));

  // A path the project tracks is never ignored behind its back: the entry is
  // left out and reported instead.
  const candidates = MANAGED_GITIGNORE_SECTIONS.flatMap(entriesOf)
    .filter(entry => !existingLines.has(entry.trim()));
  const tracked = trackedEntries(targetDir, candidates);
  for (const entry of tracked) io.noteTrackedNotIgnored(entry);

  for (const section of MANAGED_GITIGNORE_SECTIONS) {
    const missingEntries = entriesOf(section).filter(entry => !existingLines.has(entry.trim()) && !tracked.has(entry));
    if (missingEntries.length > 0) {
      sectionsToAppend.push(`${section.header}\n${missingEntries.join('\n')}`);
      added.push(...missingEntries);
    }
  }

  if (sectionsToAppend.length === 0) {
    return false;
  }

  let newContent = currentContent;
  if (newContent.length > 0 && !newContent.endsWith('\n')) {
    newContent += '\n';
  }
  if (newContent.length > 0) {
    newContent += '\n';
  }
  newContent += sectionsToAppend.join('\n\n') + '\n';

  io.appendGitignore(gitignorePath, newContent, added);
  return true;
}

module.exports = {
  ensureGitignoreEntries,
  MANAGED_GITIGNORE_SECTIONS,
};
