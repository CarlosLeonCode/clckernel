#!/usr/bin/env node
/**
 * Storybook Story Coverage Guard
 * Checks that UI components have corresponding .stories.tsx files.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkStorybook(targetDir) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const dir = targetDir || process.cwd();

  // Check if Storybook is configured
  const hasStorybook = fs.existsSync(path.join(dir, '.storybook')) ||
    fs.existsSync(path.join(dir, 'storybook.config.js')) ||
    fs.existsSync(path.join(dir, 'storybook.config.ts'));

  if (!hasStorybook) {
    return { exitCode: 0, skipped: true, name: 'check_storybook', data: { violations: {}, message: 'Storybook not configured — skipping' } };
  }

  // Collect changed component files
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
    files = out.split('\n').filter(f => /\.(tsx|jsx)$/.test(f.trim()));
  } catch {
    try {
      const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      files = out.split('\n').filter(f => /\.(tsx|jsx)$/.test(f.trim()));
    } catch {
      return { exitCode: 0, skipped: true, name: 'check_storybook', data: { violations: {}, message: 'No git diff available' } };
    }
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_storybook', data: { violations: {}, message: 'No frontend files changed' } };
  }

  // Filter to component files (skip test files, stories, types, utils)
  const componentFiles = files.filter(f => {
    if (f.includes('.stories.') || f.includes('.test.') || f.includes('.spec.')) return false;
    if (f.includes('.d.ts') || f.includes('.types.')) return false;
    if (f.includes('utils') || f.includes('helpers') || f.includes('lib')) return false;
    if (f.includes('types') || f.includes('constants')) return false;
    // Only check files that export a component (capitalized name in filename)
    const basename = path.basename(f, path.extname(f));
    return /^[A-Z]/.test(basename);
  });

  if (componentFiles.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_storybook', data: { violations: {}, message: 'No component files changed' } };
  }

  const violations = {};

  for (const file of componentFiles) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;

    // Check if a corresponding .stories.tsx file exists
    const basename = path.basename(file, path.extname(file));
    const ext = path.extname(file);
    const storyFile = path.join(path.dirname(file), `${basename}.stories.${ext.replace('.', '')}`);

    // Also check co-located stories directory pattern
    const storiesDir = path.join(path.dirname(file), '__stories__', `${basename}.stories${ext}`);

    const hasStory = fs.existsSync(path.join(dir, storyFile)) || fs.existsSync(path.join(dir, storiesDir));

    if (!hasStory) {
      violations[file] = [{
        lineNo: 0,
        rule: 'missing-story',
        message: `Component "${basename}" has no corresponding Storybook story — create ${basename}.stories.tsx`,
      }];
    }
  }

  const totalCount = Object.values(violations).flat().length;
  return {
    exitCode: totalCount > 0 ? 1 : 0,
    skipped: false,
    name: 'check_storybook',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} component(s) missing Storybook stories`
        : 'All Storybook coverage checks passed',
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
