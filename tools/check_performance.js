#!/usr/bin/env node
/**
 * Performance & Next/Image Guard
 * Checks next/image usage, detects raw <img> tags, and validates dynamic import patterns.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

const check = async function checkPerformance(targetDir) {
  const dir = targetDir || process.cwd();

  // The snapshot being verified: the index, or HEAD when nothing is staged.
  const { mode, files } = changedFiles(dir, { extensions: ['.tsx', '.jsx', '.ts', '.js'] });

  // Verify this is a Next.js project (package.json as of the same snapshot)
  const pkgRaw = readFile(dir, 'package.json', mode);
  if (pkgRaw === null) {
    return { exitCode: 0, skipped: true, name: 'check_performance', data: { violations: {}, message: 'No package.json found — skipping performance check' } };
  }

  let isNext;
  try {
    const pkg = JSON.parse(pkgRaw);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    isNext = Boolean(deps['next']);
  } catch {
    isNext = false;
  }

  if (!isNext) {
    return { exitCode: 0, skipped: true, name: 'check_performance', data: { violations: {}, message: 'Not a Next.js project — skipping' } };
  }

  if (mode === null) {
    return { exitCode: 0, skipped: true, name: 'check_performance', data: { violations: {}, message: 'No git diff available' } };
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_performance', data: { violations: {}, message: 'No files changed' } };
  }

  const violations = {};

  for (const file of files) {
    const content = readFile(dir, file, mode);
    if (content === null) continue;

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
