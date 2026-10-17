#!/usr/bin/env node
/**
 * Zod API Contract Guard
 * Validates that API routes use Zod for request/response schema validation.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkApiContracts(targetDir) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const dir = targetDir || process.cwd();

  // Check if Zod is available
  let hasZod = false;
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      hasZod = Boolean(deps['zod']);
    } catch { /* skip */ }
  }

  // Collect API route files
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
    files = out.split('\n').filter(f => /\.(ts|js|tsx|jsx)$/.test(f.trim()));
  } catch {
    try {
      const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      files = out.split('\n').filter(f => /\.(ts|js|tsx|jsx)$/.test(f.trim()));
    } catch {
      return { exitCode: 0, skipped: true, name: 'check_api_contracts', data: { violations: {}, message: 'No git diff available' } };
    }
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_api_contracts', data: { violations: {}, message: 'No files changed' } };
  }

  // Identify API route files (Next.js App Router or Pages Router)
  const apiFiles = files.filter(f =>
    f.includes('/api/') || f.includes('route.') || f.includes('/routes/')
  );

  if (apiFiles.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_api_contracts', data: { violations: {}, message: 'No API route files changed' } };
  }

  const violations = {};

  for (const file of apiFiles) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const fileViolations = [];

    // Check: API route handler without Zod validation
    const hasHandler = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)/.test(content);
    if (hasHandler) {
      // Look for request body parsing without Zod
      if (/await\s+req\.json\s*\(\s*\)/.test(content) && !/\.parse\s*\(|\.safeParse\s*\(/.test(content)) {
        fileViolations.push({
          lineNo: 0,
          rule: 'no-body-validation',
          message: 'API route parses request body without Zod validation — use z.object().parse() or .safeParse()',
        });
      }

      // Look for NextRequest without Zod
      if (/NextRequest/.test(content) && !/z\.|zod/.test(content)) {
        fileViolations.push({
          lineNo: 0,
          rule: 'no-request-validation',
          message: 'API route uses NextRequest without Zod schema validation',
        });
      }

      // Check: response without schema validation
      if (/Response\.json\s*\(/.test(content) && !/z\.|zod/.test(content) && hasZod) {
        fileViolations.push({
          lineNo: 0,
          rule: 'no-response-validation',
          message: 'API route returns JSON without Zod response schema — consider validating output',
        });
      }
    }

    // Check: fetch calls without response validation
    if (/fetch\s*\(/.test(content) && !/z\.|zod/.test(content) && hasZod) {
      fileViolations.push({
        lineNo: 0,
        rule: 'no-fetch-validation',
        message: 'fetch() call without Zod response parsing — validate external API responses',
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
    name: 'check_api_contracts',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} API contract issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All API contract checks passed',
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
