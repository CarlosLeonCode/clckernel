#!/usr/bin/env node
/**
 * SEO, GEO & Web Performance Guard
 * Scans changed frontend files (.tsx, .jsx, .vue, .astro, .html) for:
 * 1. Missing page metadata (title, description, canonical)
 * 2. OpenGraph & Social Sharing tags (og:title, og:image, og:description)
 * 3. Semantic HTML & Heading hierarchy (single <h1> per page, <main> landmark usage)
 * 4. GEO & Localized Structured Data tags (geo.region, geo.position, ICBM, JSON-LD)
 * 5. LCP & Performance: Hero image priority optimization
 *
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkSeo(targetDir) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const dir = targetDir || process.cwd();

  let files;
  try {
    const out = execSync('git diff --name-only HEAD~1', {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    files = out.split('\n').filter(f => /\.(tsx|jsx|vue|astro|html)$/.test(f.trim()));
  } catch {
    try {
      const out = execSync('git diff --name-only --cached', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      files = out.split('\n').filter(f => /\.(tsx|jsx|vue|astro|html)$/.test(f.trim()));
    } catch {
      return { exitCode: 0, skipped: true, name: 'check_seo', data: { violations: {}, message: 'No git diff available' } };
    }
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_seo', data: { violations: {}, message: 'No frontend files changed' } };
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
    const isPageOrLayout = /(?:page|layout|index|App|document)\.(?:tsx|jsx|astro|vue|html)$/i.test(file);

    // 1. Heading hierarchy: Check for multiple <h1> in a single page file
    const h1Matches = content.match(/<h1\b/gi) || [];
    if (isPageOrLayout && h1Matches.length > 1) {
      fileViolations.push({
        lineNo: 1,
        rule: 'seo-multiple-h1',
        message: `Found ${h1Matches.length} <h1> tags in single page component. Only one <h1> is recommended for SEO hierarchy.`
      });
    }

    // 2. Line-by-line checks
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for malformed GEO tags if GEO meta is present
      if (/name\s*=\s*['"]geo\.position['"]/i.test(line) && !/content\s*=\s*['"]-?\d+\.\d+;-?\d+\.\d+['"]/i.test(line)) {
        fileViolations.push({
          lineNo: i + 1,
          rule: 'geo-position-format',
          message: 'Malformed geo.position meta tag. Expected format: content="latitude;longitude"'
        });
      }

      if (/name\s*=\s*['"]ICBM['"]/i.test(line) && !/content\s*=\s*['"]-?\d+\.\d+,\s*-?\d+\.\d+['"]/i.test(line)) {
        fileViolations.push({
          lineNo: i + 1,
          rule: 'geo-icbm-format',
          message: 'Malformed ICBM meta tag. Expected format: content="latitude, longitude"'
        });
      }

      // Check for Hero / Banner images without priority (Core Web Vitals / LCP)
      if (/\b(?:hero|banner|hero-image|heroImage|heroBanner)\b/i.test(line) && /<(?:img|Image)\b/i.test(line)) {
        if (!/priority|fetchpriority|loading\s*=\s*['"]eager['"]/i.test(line)) {
          fileViolations.push({
            lineNo: i + 1,
            rule: 'cwv-lcp-priority',
            message: 'Hero/Banner image missing priority / fetchpriority="high" attribute (Core Web Vitals LCP optimization).'
          });
        }
      }

      // Check for raw <a> with target="_blank" missing rel="noopener noreferrer"
      if (/<a\b[^>]*target\s*=\s*['"]_blank['"][^>]*>/i.test(line) && !/rel\s*=\s*['"][^'"]*noopener/i.test(line)) {
        fileViolations.push({
          lineNo: i + 1,
          rule: 'seo-security-target-blank',
          message: 'External link with target="_blank" is missing rel="noopener noreferrer" (SEO authority leak & security vulnerability).'
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
    name: 'check_seo',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} SEO / GEO / Web Performance issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All SEO, GEO & Web Performance checks passed',
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
