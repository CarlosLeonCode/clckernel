#!/usr/bin/env node
/**
 * Responsive & Web Adaptability Guard
 * Scans changed frontend files (.tsx, .jsx, .vue, .astro, .html, .css) for:
 * 1. Hardcoded non-responsive fixed widths (e.g. w-[1200px], min-w-[1024px] without breakpoints)
 * 2. Inline fixed pixel dimensions breaking mobile layouts
 * 3. Mobile touch-target accessibility issues (clickable elements < 44px without padding)
 * 4. Missing or restrictive viewport configurations in root layouts
 *
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkResponsive(targetDir) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const dir = targetDir || process.cwd();

  let files;
  try {
    // Staged changes first (what is being committed); HEAD~1 only when nothing is staged.
    let out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    if (!out.trim()) {
      out = execSync('git diff --name-only --diff-filter=ACMR HEAD~1', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
    }
    files = out.split('\n').filter(f => /\.(tsx|jsx|vue|astro|html|css)$/.test(f.trim()));
  } catch {
    try {
      const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      files = out.split('\n').filter(f => /\.(tsx|jsx|vue|astro|html|css)$/.test(f.trim()));
    } catch {
      return { exitCode: 0, skipped: true, name: 'check_responsive', data: { violations: {}, message: 'No git diff available' } };
    }
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_responsive', data: { violations: {}, message: 'No frontend files changed' } };
  }

  const violations = {};

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const fileViolations = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 1. Check for hardcoded arbitrary desktop fixed widths without responsive modifiers
      // e.g. w-[1200px], min-w-[1000px] without sm:, md:, lg:, xl:, 2xl: prefixes
      const hardcodedWidthMatch = /(?<!(?:sm|md|lg|xl|2xl):)(?:min-w|w)-\[(\d{3,4})px\]/g;
      let match;
      while ((match = hardcodedWidthMatch.exec(line)) !== null) {
        const px = parseInt(match[1], 10);
        if (px >= 640 && !line.includes('max-w-') && !line.includes('overflow-x-auto') && !line.includes('overflow-auto')) {
          fileViolations.push({
            lineNo: i + 1,
            rule: 'responsive-fixed-width',
            message: `Hardcoded fixed width "${match[0]}" may cause horizontal overflow on mobile/tablet. Use max-w-* or responsive breakpoints (e.g., md:${match[0]}).`
          });
        }
      }

      // 2. Check for inline fixed pixel styles
      if (/style\s*=\s*\{\{\s*width:\s*['"](\d{3,4})px['"]/i.test(line)) {
        fileViolations.push({
          lineNo: i + 1,
          rule: 'inline-fixed-width',
          message: 'Hardcoded inline style width breaks mobile responsiveness. Use responsive CSS/Tailwind classes.'
        });
      }

      // 3. Check for restrictive user-scalable=no or maximum-scale=1 in viewport meta
      if (/name\s*=\s*['"]viewport['"]/i.test(line) && /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?/i.test(line)) {
        fileViolations.push({
          lineNo: i + 1,
          rule: 'a11y-viewport-scalable',
          message: 'Viewport disables user zooming (user-scalable=no / maximum-scale=1), violating mobile accessibility guidelines.'
        });
      }

      // 4. Check for tiny touch targets on interactive buttons without padding
      if (/<button\b/i.test(line) && /(?:w-[1-4]\b|h-[1-4]\b)/.test(line) && !/p-[2-6]|p[xy]-[2-6]|min-h-\[44px\]|min-w-\[44px\]/.test(line)) {
        fileViolations.push({
          lineNo: i + 1,
          rule: 'mobile-touch-target',
          message: 'Interactive button has small dimensions without sufficient touch padding (minimum 44x44px recommended for mobile).'
        });
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
    name: 'check_responsive',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} responsive / mobile adaptability issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All responsive & web adaptability checks passed',
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
