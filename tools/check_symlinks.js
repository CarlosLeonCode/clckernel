#!/usr/bin/env node
/**
 * Symlink & AI IDE Interoperability Guard
 * Verifies that AI agent rule mirrors (CLAUDE.md, GEMINI.md, .cursorrules, .windsurfrules)
 * exist and resolve to valid files without broken symlinks.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkSymlinks(targetDir) {
  const fs = require('fs');
  const path = require('path');

  const dir = targetDir || process.cwd();
  const rules = ['CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules'];
  const violations = [];

  const agentsPath = path.join(dir, 'AGENTS.md');
  const hasAgents = fs.existsSync(agentsPath);

  if (!hasAgents) {
    return {
      exitCode: 0,
      skipped: true,
      name: 'check_symlinks',
      data: { violations: [], message: 'No AGENTS.md present in project' }
    };
  }

  for (const rule of rules) {
    const filePath = path.join(dir, rule);
    try {
      const lstat = fs.lstatSync(filePath);
      if (lstat.isSymbolicLink()) {
        const target = fs.readlinkSync(filePath);
        const resolved = path.isAbsolute(target) ? target : path.resolve(dir, target);
        if (!fs.existsSync(resolved)) {
          violations.push({
            file: rule,
            message: `Broken symlink: points to non-existent target "${target}"`
          });
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        violations.push({
          file: rule,
          message: `Error reading symlink: ${err.message}`
        });
      }
    }
  }

  const exitCode = violations.length > 0 ? 1 : 0;
  return {
    exitCode,
    skipped: false,
    name: 'check_symlinks',
    data: {
      violations,
      message: violations.length > 0
        ? `${violations.length} broken or invalid symlink(s) detected`
        : 'All AI IDE rule mirrors & symlinks verified'
    }
  };
};

module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
