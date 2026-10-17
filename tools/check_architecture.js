#!/usr/bin/env node
/**
 * Next.js Architecture & Server Components Guard
 * Validates Server Component boundaries, layout protection, and layer separation.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkArchitecture(targetDir) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const dir = targetDir || process.cwd();

  // Verify this is a Next.js project
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { exitCode: 0, skipped: true, name: 'check_architecture', data: { violations: {}, message: 'No package.json found — skipping architecture check' } };
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
    return { exitCode: 0, skipped: true, name: 'check_architecture', data: { violations: {}, message: 'Not a Next.js project — skipping' } };
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
      return { exitCode: 0, skipped: true, name: 'check_architecture', data: { violations: {}, message: 'No git diff available' } };
    }
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_architecture', data: { violations: {}, message: 'No files changed' } };
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
    const isLayout = /layout\.(tsx|jsx|ts|js)$/.test(file);
    const isPage = /page\.(tsx|jsx|ts|js)$/.test(file);
    const hasUseClient = /['"]use client['"]/.test(content);

    // Check: layout.tsx should NOT have "use client"
    if (isLayout && hasUseClient) {
      fileViolations.push({ lineNo: 1, module: 'layout-boundary', reason: 'Layout must be a Server Component — remove "use client"' });
    }

    // Check: page.tsx should NOT have "use client" (prefer Server Components)
    if (isPage && hasUseClient) {
      fileViolations.push({ lineNo: 1, module: 'page-boundary', reason: 'Page uses "use client" — prefer Server Component unless client interactivity is required' });
    }

    // Check: files with "use client" importing server-only modules
    if (hasUseClient) {
      if (/require\s*\(\s*['"]fs['"]\s*\)/.test(content) || /from\s+['"]fs['"]/.test(content)) {
        fileViolations.push({ lineNo: 0, module: 'server-in-client', reason: 'Client Component imports "fs" — use a Server Component or API route instead' });
      }
      if (/require\s*\(\s*['"]path['"]\s*\)/.test(content) || /from\s+['"]path['"]/.test(content)) {
        fileViolations.push({ lineNo: 0, module: 'server-in-client', reason: 'Client Component imports "path" — move logic to Server Component' });
      }
      if (/require\s*\(\s*['"]child_process['"]\s*\)/.test(content) || /from\s+['"]child_process['"]/.test(content)) {
        fileViolations.push({ lineNo: 0, module: 'server-in-client', reason: 'Client Component imports "child_process" — this is a server-only module' });
      }
    }

    // Check: files without "use client" using useState/useEffect
    if (!hasUseClient && (/\buseState\b/.test(content) || /\buseEffect\b/.test(content))) {
      fileViolations.push({ lineNo: 0, module: 'missing-use-client', reason: 'Uses React hooks without "use client" directive — add directive or move to Client Component' });
    }

    // Check: files without "use client" using onClick/onSubmit handlers
    if (!hasUseClient && /on(Click|Submit|Change|Focus|Blur)\s*=\s*\{/.test(content)) {
      fileViolations.push({ lineNo: 0, module: 'event-handler', reason: 'Event handler in Server Component — move to Client Component with "use client"' });
    }

    // Check: "use server" should only be in API or action files
    if (/['"]use server['"]/.test(content) && !/action|api|route/i.test(file)) {
      fileViolations.push({ lineNo: 1, module: 'server-action-location', reason: '"use server" in non-action file — Server Actions belong in dedicated action files' });
    }

    if (fileViolations.length > 0) {
      violations[file] = fileViolations;
    }
  }

  const totalCount = Object.values(violations).flat().length;
  return {
    exitCode: totalCount > 0 ? 1 : 0,
    skipped: false,
    name: 'check_architecture',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} architecture issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All architecture checks passed',
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
