#!/usr/bin/env node
/**
 * Zod API Contract Guard
 * Validates that API routes use Zod for request/response schema validation.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

const check = async function checkApiContracts(targetDir) {
  const dir = targetDir || process.cwd();

  // The snapshot being verified: the index, or HEAD when nothing is staged.
  const { mode, files } = changedFiles(dir, { extensions: ['.ts', '.js', '.tsx', '.jsx'] });

  // Check if Zod is available (package.json as of the same snapshot)
  let hasZod = false;
  const pkgRaw = readFile(dir, 'package.json', mode);
  if (pkgRaw !== null) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      hasZod = Boolean(deps['zod']);
    } catch { /* skip */ }
  }

  if (mode === null) {
    return { exitCode: 0, skipped: true, name: 'check_api_contracts', data: { violations: {}, message: 'No git diff available' } };
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
    const content = readFile(dir, file, mode);
    if (content === null) continue;

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
