#!/usr/bin/env node
/**
 * Symlink & AI IDE Interoperability Guard
 * Every AI agent rule mirror that exists (CLAUDE.md, GEMINI.md, .cursorrules,
 * .windsurfrules) must point to AGENTS.md: a symlink that resolves to
 * AGENTS.md, or a regular file whose content is identical to it. Broken
 * symlinks, symlinks to another file and diverging copies fail. A missing
 * mirror is not an error. Mirrors are gitignored, so the working copy is read.
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
  if (!fs.existsSync(agentsPath)) {
    return {
      exitCode: 0,
      skipped: true,
      name: 'check_symlinks',
      data: { violations: [], message: 'No AGENTS.md present in project' }
    };
  }
  const agentsReal = fs.realpathSync(agentsPath);

  for (const rule of rules) {
    const filePath = path.join(dir, rule);
    let lstat;
    try {
      lstat = fs.lstatSync(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        violations.push({ file: rule, message: `Error reading mirror: ${err.message}` });
      }
      continue;
    }

    try {
      if (lstat.isSymbolicLink()) {
        const target = fs.readlinkSync(filePath);
        if (!fs.existsSync(filePath)) {
          violations.push({ file: rule, message: `Broken symlink: points to non-existent target "${target}"` });
        } else if (fs.realpathSync(filePath) !== agentsReal) {
          violations.push({ file: rule, message: `Symlink points to "${target}" instead of AGENTS.md` });
        }
      } else if (!fs.readFileSync(filePath).equals(fs.readFileSync(agentsPath))) {
        violations.push({ file: rule, message: 'Regular file differs from AGENTS.md: make it a symlink to AGENTS.md or an identical copy' });
      }
    } catch (err) {
      violations.push({ file: rule, message: `Error reading mirror: ${err.message}` });
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
        ? `${violations.length} AI IDE rule mirror(s) do not point to AGENTS.md`
        : 'All existing AI IDE rule mirrors point to AGENTS.md'
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
