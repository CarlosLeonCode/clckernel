#!/usr/bin/env node
/**
 * Modular Audit Orchestrator — JS
 * Discovers check_*.js guard scripts at runtime, runs each with graceful
 * degradation, categorizes results into the 4 Canonical RDD Lenses,
 * and generates both an English audit report (05-audit-report.md) and
 * an immutable, machine-readable audit receipt (audit-receipt.json).
 * Self-contained: uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ── 4 Canonical RDD Lenses Mapping ──────────────────────────────────────────

const LENS_MAP = {
  // Correctness
  verify_tdd: 'correctness',
  check_scope: 'correctness',
  check_a11y: 'correctness',
  check_api_contracts: 'correctness',
  check_openapi_drift: 'correctness',
  pytest: 'correctness',
  tsc: 'correctness',
  lint: 'correctness',
  ruff: 'correctness',
  // Security
  scan_secrets: 'security',
  docker_guard: 'security',
  redis_guard: 'security',
  celery_guard: 'security',
  postgres_guard: 'security',
  // Architecture
  check_architecture: 'architecture',
  check_custom: 'architecture',
  check_ui_reuse: 'architecture',
  check_symlinks: 'architecture',
  check_hitl: 'architecture',
  check_domain_data: 'architecture',
  check_migrations: 'architecture',
  graphify: 'architecture',
  gentle_ai_review: 'architecture',
  // Performance
  check_db_efficiency: 'performance',
  check_performance: 'performance',
  check_seo: 'performance',
  check_responsive: 'performance',
  check_storybook: 'performance',
  check_test_calendar_sync: 'performance',
  check_observability: 'performance',
};

function getLensForGuard(guardName) {
  try {
    const { lensFor } = require('../src/catalog');
    const lens = lensFor(guardName);
    if (lens) return lens;
  } catch {}
  return LENS_MAP[guardName] || 'architecture';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getActiveSddDir(baseDir) {
  const root = baseDir || REPO_ROOT;
  const sddsDir = path.join(root, 'sdds');
  if (!fs.existsSync(sddsDir)) {
    fs.mkdirSync(sddsDir, { recursive: true });
  }
  const dirs = fs.readdirSync(sddsDir).filter(f => {
    try { return fs.statSync(path.join(sddsDir, f)).isDirectory(); }
    catch { return false; }
  });
  if (dirs.length > 0) {
    return path.join(sddsDir, dirs[0]);
  }
  const defaultDir = path.join(sddsDir, 'audit-run');
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

/**
 * Discover all check_*.js guard scripts in the tools/ directory.
 * Returns absolute paths sorted alphabetically for deterministic ordering.
 */
function discoverGuards(toolsDirParam) {
  const toolsDir = toolsDirParam || __dirname;
  if (!fs.existsSync(toolsDir)) return [];
  return fs.readdirSync(toolsDir)
    .filter(f => (f.startsWith('check_') || f.startsWith('scan_')) && f.endsWith('.js') && f !== path.basename(__filename || 'audit.js'))
    .sort()
    .map(f => path.join(toolsDir, f));
}

/**
 * Run a single guard module with try/catch.
 * @param {string} guardPath - Absolute path to the guard script
 * @param {string} targetDir - Directory to scan
 * @returns {object} Result from the guard, or a FAILED result if it cannot run
 */
async function runGuard(guardPath, targetDir) {
  const guardName = path.basename(guardPath, '.js');
  const lens = getLensForGuard(guardName);
  try {
    const mod = require(guardPath);
    const fn = typeof mod === 'function' ? mod : Object.values(mod)[0];
    if (typeof fn !== 'function') {
      return {
        exitCode: 1, skipped: false, name: guardName, lens,
        data: { message: `Guard crashed: ${guardName} does not export a function` },
      };
    }
    const result = await fn(targetDir);
    // Normalize result shape
    return {
      exitCode: result.exitCode || 0,
      skipped: Boolean(result.skipped),
      name: result.name || guardName,
      lens,
      data: result.data || result,
    };
  } catch (e) {
    // A guard that cannot run must never approve a commit (fail closed).
    return {
      exitCode: 1, skipped: false, name: guardName, lens,
      data: { message: `Guard crashed: ${e.message}` },
    };
  }
}

// ── Report Generation ────────────────────────────────────────────────────────

/**
 * Format a single guard result into a markdown section.
 */
function formatGuardSection(name, result) {
  const lines = [];
  const icon = result.skipped ? '⏭️' : result.exitCode === 0 ? '✅' : '❌';
  const status = result.skipped ? 'SKIPPED' : result.exitCode === 0 ? 'PASSED' : 'FAILED';
  const lensBadge = (result.lens || 'architecture').toUpperCase();

  lines.push(`### ${icon} ${name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} [${lensBadge}] — ${status}`);
  lines.push('');

  if (result.skipped) {
    lines.push(`> Skipped: ${result.data?.message || 'Dependencies not available'}`);
  } else if (result.exitCode === 0) {
    lines.push(`> ${result.data?.message || 'All checks passed'}`);
  } else {
    lines.push(`> ${result.data?.message || 'Issues found'}`);
    lines.push('');
    const violations = result.data?.violations || result.data?.findings || {};
    if (Array.isArray(violations)) {
      for (const item of violations) {
        lines.push(`- ${item.file ? `\`${item.file}\`: ` : ''}${item.message || item.reason || JSON.stringify(item)}`);
      }
    } else {
      const files = Object.keys(violations);
      if (files.length > 0) {
        for (const file of files) {
          const items = violations[file];
          for (const item of items) {
            const loc = item.lineNo ? ` (line ${item.lineNo})` : '';
            const label = item.label || item.rule || item.module || '';
            const msg = item.message || item.reason || '';
            lines.push(`- \`${file}\`${loc}: ${label ? `[${label}] ` : ''}${msg}`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate the 05-audit-report.md from aggregated results.
 */
function generateReport(results, sddDir) {
  const taskName = path.basename(sddDir);
  const passed = results.filter(r => !r.skipped && r.exitCode === 0).length;
  const failed = results.filter(r => !r.skipped && r.exitCode !== 0).length;
  const skipped = results.filter(r => r.skipped).length;
  const total = results.length;

  const sections = [];

  sections.push(`# Code Audit Report: ${taskName}`);
  sections.push('');
  sections.push('> **Review-Driven Development (RDD) Report:**');
  sections.push('> Segmented across the 4 Canonical Review Lenses (Correctness, Security, Architecture, Performance).');
  sections.push('');
  sections.push('---');
  sections.push('');
  sections.push('## Summary');
  sections.push('');
  sections.push(`| Metric | Count |`);
  sections.push(`|--------|-------|`);
  sections.push(`| Total guards | ${total} |`);
  sections.push(`| Passed | ${passed} |`);
  sections.push(`| Failed | ${failed} |`);
  sections.push(`| Skipped | ${skipped} |`);
  sections.push('');
  sections.push('---');
  sections.push('');

  const lenses = ['correctness', 'security', 'architecture', 'performance'];
  const lensHeaders = {
    correctness: '## 🎯 Correctness Lens',
    security: '## 🛡️ Security Lens',
    architecture: '## 🏛️ Architecture Lens',
    performance: '## ⚡ Performance Lens',
  };

  for (const lens of lenses) {
    sections.push(lensHeaders[lens]);
    sections.push('');
    const lensResults = results.filter(r => r.lens === lens);
    if (lensResults.length === 0) {
      sections.push('_No guards registered for this lens._\n');
    } else {
      for (const result of lensResults) {
        sections.push(formatGuardSection(result.name, result));
        sections.push('');
      }
    }
    sections.push('---');
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Generate an immutable machine-readable audit receipt (audit-receipt.json).
 */
function generateReceipt(results, targetDir) {
  const lenses = ['correctness', 'security', 'architecture', 'performance'];
  const lensSummary = {};

  let hasFailure = false;
  for (const lens of lenses) {
    const lensResults = results.filter(r => r.lens === lens);
    const passed = lensResults.filter(r => !r.skipped && r.exitCode === 0).length;
    const failed = lensResults.filter(r => !r.skipped && r.exitCode !== 0).length;
    const skipped = lensResults.filter(r => r.skipped).length;
    if (failed > 0) hasFailure = true;

    lensSummary[lens] = {
      status: failed > 0 ? 'FAILED' : 'PASSED',
      passed,
      failed,
      skipped,
    };
  }

  let commitHash = 'UNKNOWN';
  let gentleAiDetected = false;
  try {
    const { execSync } = require('child_process');
    commitHash = execSync('git rev-parse HEAD', { cwd: targetDir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
  } catch {}

  try {
    const { execSync } = require('child_process');
    execSync('which gentle-ai', { stdio: 'ignore' });
    gentleAiDetected = true;
  } catch {}

  return {
    $schema: 'https://clckernel.dev/schemas/audit-receipt.v1.json',
    contract: 'clckernel.audit-receipt/v1',
    timestamp: new Date().toISOString(),
    commitHash,
    verdict: hasFailure ? 'FAILED' : 'PASSED',
    lenses: lensSummary,
    generator: 'clckernel',
    gentle_ai: {
      compatible: true,
      rdd_ready: true,
      cli_installed: gentleAiDetected,
    },
  };
}

// ── Console Summary ──────────────────────────────────────────────────────────

function printSummary(results, reportPath, receiptPath) {
  console.log('\n=================================================================');
  console.log('  CLC KERNEL — 4-LENS RDD AUDIT SUMMARY');
  console.log('=================================================================\n');

  const lenses = ['correctness', 'security', 'architecture', 'performance'];
  const lensLabels = {
    correctness: '🎯 CORRECTNESS LENS',
    security: '🛡️ SECURITY LENS',
    architecture: '🏛️ ARCHITECTURE LENS',
    performance: '⚡ PERFORMANCE LENS',
  };

  for (const lens of lenses) {
    const lensResults = results.filter(r => r.lens === lens);
    console.log(`  ${lensLabels[lens]}:`);
    if (lensResults.length === 0) {
      console.log('     — No guards active for this lens');
    } else {
      for (const result of lensResults) {
        const icon = result.skipped ? '⏭️' : result.exitCode === 0 ? '✅' : '❌';
        const label = result.name.replace(/_/g, ' ');
        const msg = result.data?.message || (result.exitCode === 0 ? 'Passed' : 'Failed');
        console.log(`     ${icon} ${label}: ${msg}`);
      }
    }
    console.log('');
  }

  console.log(`📄 Full report: ${reportPath}`);
  if (receiptPath) {
    console.log(`🧾 Audit receipt: ${receiptPath}`);
  }
  console.log('=================================================================\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(targetDir) {
  const dir = targetDir ? path.resolve(targetDir) : process.cwd();
  const sddDir = getActiveSddDir(dir);

  console.log('\nRunning CLC Kernel audit...\n');

  const targetTools = path.join(dir, 'tools');
  const toolsDir = fs.existsSync(targetTools) ? targetTools : __dirname;
  const guardPaths = discoverGuards(toolsDir);

  if (guardPaths.length === 0) {
    console.log('No guard tools found in tools/. Nothing to audit.');
    return;
  }

  console.log(`Discovered ${guardPaths.length} guard(s): ${guardPaths.map(p => path.basename(p, '.js')).join(', ')}\n`);

  const results = [];
  for (const guardPath of guardPaths) {
    const result = await runGuard(guardPath, dir);
    results.push(result);
  }

  // Generate report
  const reportContent = generateReport(results, sddDir);
  const reportPath = path.join(sddDir, '05-audit-report.md');
  fs.writeFileSync(reportPath, reportContent, 'utf-8');

  // Generate receipt
  const receipt = generateReceipt(results, dir);
  const receiptPath = path.join(sddDir, 'audit-receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf-8');

  // Print summary
  printSummary(results, reportPath, receiptPath);

  // Exit with failure if any guard failed (not skipped)
  const hasFailure = results.some(r => !r.skipped && r.exitCode !== 0);
  if (hasFailure) {
    process.exit(1);
  }
}

// Support both require() and direct execution
if (require.main === module) {
  main(process.argv[2]).catch(err => {
    console.error(`Audit orchestrator error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, getActiveSddDir, discoverGuards, runGuard, generateReceipt };
