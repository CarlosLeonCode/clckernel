#!/usr/bin/env node
/**
 * Performance & Next/Image Guard
 * Checks next/image usage, detects raw <img> tags, and validates dynamic import patterns.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkPerformance(targetDir) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const dir = targetDir || process.cwd();

  // Verify this is a Next.js project
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { exitCode: 0, skipped: true, name: 'check_performance', data: { violations: {}, message: 'No package.json found — skipping performance check' } };
  }

  let isNext;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    isNext = Boolean(deps['next']);
  } catch {
    isNext = false;
  }

  if (!isNext) {
    return { exitCode: 0, skipped: true, name: 'check_performance', data: { violations: {}, message: 'Not a Next.js project — skipping' } };
  }

  // Collect changed files
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
      return { exitCode: 0, skipped: true, name: 'check_performance', data: { violations: {}, message: 'No git diff available' } };
    }
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_performance', data: { violations: {}, message: 'No files changed' } };
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

    // Check: raw <img> tags (should use next/image)
    const imgMatches = content.match(/<img\b[^>]*>/gi) || [];
    if (imgMatches.length > 0) {
      // Exclude commented-out images
      const activeImgs = imgMatches.filter(m => !/^\s*\/\//.test(m));
      if (activeImgs.length > 0) {
        fileViolations.push({
          lineNo: 0,
          rule: 'raw-img',
          message: `${activeImgs.length} raw <img> tag(s) — use next/image for optimization`,
        });
      }
    }

    // Check: large inline data URIs in src attributes
    if (/src\s*=\s*['"]data:image\/[^'"]{1000,}/.test(content)) {
      fileViolations.push({
        lineNo: 0,
        rule: 'data-uri',
        message: 'Large inline data URI in image src — use next/image with a proper source',
      });
    }

    // Check: dynamic imports without loading="lazy" equivalent
    // In Next.js, dynamic() is fine but verify it's used
    const hasDynamicImport = /dynamic\s*\(/.test(content) || /React\.lazy\s*\(/.test(content);
    const hasHeavyLibImport = /from\s+['"](moment|lodash|date-fns|@mui|antd|@chakra-ui)['"]/.test(content);
    if (hasHeavyLibImport && !hasDynamicImport) {
      fileViolations.push({
        lineNo: 0,
        rule: 'heavy-import',
        message: 'Heavy library imported statically — use next/dynamic for code splitting',
      });
    }

    // Check: barrel file re-exports that hurt tree-shaking
    if (/export\s*\*\s*from/.test(content) && file.includes('index.')) {
      fileViolations.push({
        lineNo: 0,
        rule: 'barrel-export',
        message: 'Barrel re-export (export *) in index file — may prevent tree-shaking',
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
    name: 'check_performance',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} performance issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All performance checks passed',
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
