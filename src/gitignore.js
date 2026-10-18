/**
 * CLC Kernel — Gitignore Provisioning Engine
 * Ensures AI IDE mirror symlinks, local SDD specs, and ephemeral runtime artifacts
 * are safely ignored in consumer repositories to preserve AGENTS.md as the SSOT.
 */

const path = require('path');
const { currentIO } = require('./io');

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
      '.agents/skills/clc_forge_cli/',
    ],
  },
  {
    header: '# CLC Kernel: Local SDD Specs & Ephemeral Harness Artifacts',
    entries: [
      'sdds/*',
      '!sdds/.gitkeep',
      'openspec/*',
      '!openspec/.gitkeep',
      '.clckernel.resolved.json',
      '.clc-forge.resolved.json',
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
 * only records the entries it would add.
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

  for (const section of MANAGED_GITIGNORE_SECTIONS) {
    const missingEntries = section.entries.filter(entry => !existingLines.has(entry.trim()));
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
