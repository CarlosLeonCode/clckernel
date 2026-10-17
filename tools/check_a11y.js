#!/usr/bin/env node
/**
 * Accessibility & ARIA Guard
 * Scans changed .tsx/.jsx files for missing alt tags, aria-labels,
 * and semantic HTML violations.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

const check = async function checkA11y(targetDir) {
  const dir = targetDir || process.cwd();

  // The snapshot being verified: the index, or HEAD when nothing is staged.
  const { mode, files } = changedFiles(dir, { extensions: ['.tsx', '.jsx'] });
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: 'check_a11y', data: { violations: {}, message: 'No git diff available' } };
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_a11y', data: { violations: {}, message: 'No frontend files changed' } };
  }

  const violations = {};

  for (const file of files) {
    const content = readFile(dir, file, mode);
    if (content === null) continue;

    const lines = content.split('\n');
    const fileViolations = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for <img without alt
      if (/<img\b[^>]*(?!.*\balt\s*=)[^>]*>/i.test(line) && !/\balt\s*=/.test(line)) {
        fileViolations.push({ lineNo: i + 1, rule: 'img-alt', message: 'Image missing alt attribute' });
      }

      // Check for <input without aria-label or aria-labelledby
      if (/<input\b/i.test(line) && !/aria-label|aria-labelledby|aria-describedby/.test(line)) {
        fileViolations.push({ lineNo: i + 1, rule: 'input-label', message: 'Input missing aria-label or aria-labelledby' });
      }

      // Check for button/link with only icon and no aria-label
      if (/<button[^>]*>\s*(?:<[A-Z]|<span[^>]*className=['"][^'"]*(?:icon|Icon))/i.test(line) && !/aria-label/.test(line)) {
        fileViolations.push({ lineNo: i + 1, rule: 'icon-button', message: 'Icon-only button missing aria-label' });
      }

      // Check for role="button" without keyboard handler
      if (/role\s*=\s*['"]button['"]/i.test(line) && !/onKeyDown|onKeyUp|onKeyPress/i.test(line)) {
        fileViolations.push({ lineNo: i + 1, rule: 'role-button-keyboard', message: 'role="button" without keyboard handler' });
      }

      // Check for <a> with href but missing accessible text for icon-only links
      if (/<a\b[^>]*>\s*<[A-Z]/i.test(line) && !/aria-label/.test(line)) {
        fileViolations.push({ lineNo: i + 1, rule: 'link-accessible', message: 'Link with component child may need aria-label' });
      }
    }

    if (fileViolations.length > 0) {
      violations[file] = fileViolations;
    }
  }

  const totalCount = Object.values(violations).flat().length;
  return {
    exitCode: totalCount > 0 ? 1 : 0,
    skipped: false,
    name: 'check_a11y',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} a11y issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All a11y checks passed',
    },
  };
};
module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
