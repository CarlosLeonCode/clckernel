#!/usr/bin/env node
/**
 * UI Component Reuse Guard
 * Verifies @/components/ui/ imports and semantic Tailwind token usage.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkUiReuse(targetDir) {
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
    files = out.split('\n').filter(f => /\.(tsx|jsx|ts|js)$/.test(f.trim()));
  } catch {
    try {
      const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      files = out.split('\n').filter(f => /\.(tsx|jsx|ts|js)$/.test(f.trim()));
    } catch {
      return { exitCode: 0, skipped: true, name: 'check_ui_reuse', data: { violations: {}, message: 'No git diff available' } };
    }
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_ui_reuse', data: { violations: {}, message: 'No files changed' } };
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

    const fileViolations = [];

    // Check: non-component files importing from @/components/ui/ directly
    // (components within ui/ are allowed to reference each other)
    if (!file.includes('components/ui/') && /from\s+['"]@\/components\/ui\//.test(content)) {
      // This is GOOD — it means the file reuses UI primitives
      // We only flag when components are defined but NOT using the shared ui/ directory
    }

    // Check: raw HTML elements that should be replaced with UI primitives
    // <button without className referencing ui/ or a design system
    const hasRawButton = /<button\b(?![^>]*className\s*=\s*['"][^'"]*(?:ui-|btn-|button))/i.test(content);
    if (hasRawButton && !/from\s+['"]@\/components\/ui\//.test(content)) {
      fileViolations.push({
        lineNo: 0,
        rule: 'raw-button',
        message: 'Raw <button> without UI primitive — consider using @/components/ui/ Button',
      });
    }

    // Check: raw <select> without UI primitive
    if (/<select\b/i.test(content) && !/from\s+['"]@\/components\/ui\//.test(content)) {
      fileViolations.push({
        lineNo: 0,
        rule: 'raw-select',
        message: 'Raw <select> without UI primitive — consider using @/components/ui/ Select',
      });
    }

    // Check: raw <input> without UI primitive (except type=hidden)
    if (/<input\b(?!.*type\s*=\s*['"]hidden['"])/i.test(content) && !/from\s+['"]@\/components\/ui\//.test(content)) {
      fileViolations.push({
        lineNo: 0,
        rule: 'raw-input',
        message: 'Raw <input> without UI primitive — consider using @/components/ui/ Input',
      });
    }

    // Check: hardcoded colors that should use semantic tokens
    // Raw Tailwind color classes (bg-blue-500, text-red-600, etc.)
    const rawColorRegex = /\b(?:bg|text|border|ring|shadow|outline|from|to|via)-(?:red|blue|green|yellow|orange|purple|pink|indigo|teal|cyan|emerald|lime|amber|violet|fuchsia|rose|sky|slate|gray|zinc|neutral|stone)-\d+\b/g;
    const rawColors = content.match(rawColorRegex);
    if (rawColors && rawColors.length > 0) {
      fileViolations.push({
        lineNo: 0,
        rule: 'raw-colors',
        message: `Raw color classes found (${rawColors.slice(0, 3).join(', ')}${rawColors.length > 3 ? '...' : ''}) — use semantic tokens (bg-primary, text-muted-foreground)`,
      });
    }

    // Check: inline styles that bypass Tailwind
    if (/style\s*=\s*\{\s*\{/.test(content)) {
      fileViolations.push({
        lineNo: 0,
        rule: 'inline-styles',
        message: 'Inline styles detected — prefer Tailwind utility classes for consistency',
      });
    }

    if (fileViolations.length > 0) {
      violations[file] = fileViolations;
    }
  }

  const totalCount = Object.values(violations).flat().length;
  return {
    exitCode: totalCount > 0 ? 1 : 0,
    skipped: false,
    name: 'check_ui_reuse',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} UI reuse issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All UI reuse checks passed',
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
