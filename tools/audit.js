#!/usr/bin/env node
/**
 * Modular Audit Orchestrator — JS
 * The single place that decides which guards run (sdds/unified-discovery):
 * `clckernel audit` runs it to write a report, the pre-commit hook runs it
 * with --hook. Same discovery, same guards, each exactly once:
 *   - top-level tools/ guards: check_*, scan_*, verify_* or *_guard, .js/.py;
 *   - every tools/guards/*.js and *.py (project guards).
 * audit.js runs the .js guards; the .py ones belong to audit.py, unless
 * tools/audit.py is not installed: then audit.js runs them too, with python3.
 * A top-level guard of this language that exports a function is called in
 * process; every other guard runs as a process (exit code decides, a JSON
 * result is optional). A guard listed in the managed registry but missing on
 * disk fails the run. Results are grouped into 4 lenses; without --hook an
 * English report (05-audit-report.md) and a machine-readable receipt
 * (audit-receipt.json) are written. --hook writes nothing and prints one line
 * per guard. Self-contained: uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const LENSES = ['correctness', 'security', 'architecture', 'performance'];
const PROJECT_GUARD_RUNNERS = { '.js': process.execPath, '.py': 'python3' };
const MAX_BUFFER = 64 * 1024 * 1024;
const OWN_EXT = '.js';
const SIBLING = { ext: '.py', orchestrator: 'audit.py' };
const REGISTRY_FILE = '.clckernel-managed.json';

/**
 * Runs a Python guard that defines check() (module contract) as a process:
 * prints its result as JSON and exits with its exit_code.
 */
const PY_MODULE_RUNNER = [
  'import importlib.util, json, os, sys',
  'p = os.path.abspath(sys.argv[1])',
  'sys.path.insert(0, os.path.dirname(p))',
  'spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(p))[0], p)',
  'm = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(m)',
  'r = m.check(os.getcwd())',
  'if not isinstance(r, dict):',
  '    print("check() returned " + type(r).__name__, file=sys.stderr)',
  '    sys.exit(1)',
  'print(json.dumps(r))',
  'sys.exit(r.get("exit_code", 0) or 0)',
].join('\n');

// ── Static name → lens mapping (4 RDD lenses) ──────────────────────────────────────────

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
  check_skills: 'correctness',
  check_links: 'correctness',
  check_placeholders: 'correctness',
  check_data_files: 'correctness',
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
  check_migrations: 'architecture',
  graphify: 'architecture',
  gentle_ai_review: 'architecture',
  // Performance
  check_db_efficiency: 'performance',
  check_performance: 'performance',
  check_seo: 'performance',
  check_responsive: 'performance',
  check_storybook: 'performance',
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

/** True for a top-level guard file name: check_*, scan_*, verify_* or *_guard, .js or .py. */
function isGuardFile(name) {
  const ext = path.extname(name);
  if (ext !== '.js' && ext !== '.py') return false;
  const stem = path.basename(name, ext);
  return /^(check|scan|verify)_/.test(stem) || stem.endsWith('_guard');
}

/** Regular files of dir (names, sorted); [] when it cannot be read. */
function regularFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Top-level guards of this orchestrator's language (.js) in tools/,
 * alphabetical. Snapshot helpers (_*), yaml.js and the orchestrators never
 * match the guard name rule.
 * @param {string} [toolsDirParam] - The tools/ directory
 * @returns {string[]} Absolute paths
 */
function discoverGuards(toolsDirParam) {
  const toolsDir = toolsDirParam || __dirname;
  return regularFiles(toolsDir)
    .filter(f => isGuardFile(f) && path.extname(f) === OWN_EXT)
    .map(f => path.join(toolsDir, f));
}

/**
 * Project guards (sdds/domain-agnostic, decision 3): every *.js and *.py file
 * in tools/guards/, alphabetical.
 * @param {string} toolsDir - The project's tools/ directory
 * @returns {string[]} Absolute paths
 */
function discoverProjectGuards(toolsDir) {
  const dir = path.join(toolsDir, 'guards');
  return regularFiles(dir)
    .filter(name => PROJECT_GUARD_RUNNERS[path.extname(name)])
    .map(name => path.join(dir, name));
}

/**
 * Paths (relative to the project root) the managed registry lists, in
 * either format: a list of paths, or { files: [{ path }] }.
 * @param {string} toolsDir - The tools/ directory
 * @returns {string[]}
 */
function registeredPaths(toolsDir) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(toolsDir, REGISTRY_FILE), 'utf-8'));
  } catch {
    return [];
  }
  const entries = Array.isArray(data) ? data : (data && Array.isArray(data.files) ? data.files.map(f => f && f.path) : []);
  return entries.filter(p => typeof p === 'string');
}

/** True when a JS file follows the module contract (it exports something). */
function exportsModule(file) {
  try {
    return /\bmodule\.exports\b|^\s*exports\.[\w$]+\s*=/m.test(fs.readFileSync(file, 'utf-8'));
  } catch {
    return false;
  }
}

/** True when a Python file follows the module contract (a top-level check()). */
function definesCheck(file) {
  try {
    return /^def check\s*\(/m.test(fs.readFileSync(file, 'utf-8'));
  } catch {
    return false;
  }
}

/**
 * The guards this orchestrator runs (sdds/unified-discovery), in order:
 * top-level guards, then tools/guards/*. Each entry says how it runs:
 *   'module'  — a top-level .js guard that exports a function: in process;
 *   'process' — any other guard of a language this orchestrator owns.
 * Languages owned: .js, plus .py when tools/audit.py is not installed.
 * Registered guards missing on disk come back as 'missing'.
 * @param {string} toolsDir - The project's tools/ directory
 * @returns {Array<{ file: string, label: string, mode: 'module'|'process'|'missing' }>}
 */
function planGuards(toolsDir) {
  const exts = new Set([OWN_EXT]);
  if (!fs.existsSync(path.join(toolsDir, SIBLING.orchestrator))) exts.add(SIBLING.ext);
  const plan = [];
  const top = regularFiles(toolsDir).filter(f => isGuardFile(f) && exts.has(path.extname(f)));
  for (const name of top) {
    const file = path.join(toolsDir, name);
    const module = path.extname(name) === OWN_EXT && exportsModule(file);
    plan.push({ file, label: name, mode: module ? 'module' : 'process' });
  }
  for (const file of discoverProjectGuards(toolsDir).filter(f => exts.has(path.extname(f)))) {
    plan.push({ file, label: `guards/${path.basename(file)}`, mode: 'process' });
  }
  const present = new Set(top);
  for (const rel of registeredPaths(toolsDir)) {
    const name = rel.startsWith('tools/') ? rel.slice('tools/'.length) : null;
    if (!name || name.includes('/') || !isGuardFile(name) || !exts.has(path.extname(name)) || present.has(name)) continue;
    plan.push({ file: path.join(toolsDir, name), label: name, mode: 'missing' });
  }
  return plan;
}

/** Result for a registered guard that is not on disk (fail closed). */
function missingGuardResult(entry) {
  const name = path.basename(entry.label, path.extname(entry.label));
  return {
    exitCode: 1, skipped: false, name, lens: getLensForGuard(name),
    data: { message: `Kernel guard missing: tools/${entry.label} is listed in tools/${REGISTRY_FILE} but not on disk; restore it with \`clckernel update\`` },
  };
}

/** The guard's JSON result when its stdout (or its last line) is a JSON object. */
function parseGuardJson(stdout) {
  const text = String(stdout || '').trim();
  const lines = text.split('\n');
  for (const candidate of [text, lines[lines.length - 1]]) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
  }
  return null;
}

/** Last non-empty line of a process stream. */
function lastLine(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/**
 * Runs one guard as a process with cwd = targetDir, the way a project guard
 * runs. The exit code decides (non-zero fails); a JSON result with the
 * standard shape ({ name, skipped, lens?, data: { message, violations } }) is
 * used for the report, plain output is reported by its last line. A .py guard
 * that defines check() is called through that contract. Lens: the JSON's,
 * else the guard name's, else architecture.
 * @param {string} guardPath - Absolute path to the guard
 * @param {string} targetDir - Project root
 * @returns {object} Normalized result (`output`: the guard's raw output)
 */
function runProjectGuard(guardPath, targetDir) {
  const ext = path.extname(guardPath);
  const fallbackName = path.basename(guardPath, ext);
  const args = ext === '.py' && definesCheck(guardPath) ? ['-c', PY_MODULE_RUNNER, guardPath] : [guardPath];
  const res = spawnSync(PROJECT_GUARD_RUNNERS[ext], args, { cwd: targetDir, encoding: 'utf-8', maxBuffer: MAX_BUFFER });
  const fallbackLens = getLensForGuard(fallbackName);
  if (res.error) {
    return {
      exitCode: 1, skipped: false, name: fallbackName, lens: fallbackLens,
      data: { message: `Guard crashed: ${res.error.message}` },
    };
  }
  const exitCode = typeof res.status === 'number' ? res.status : 1;
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  const json = parseGuardJson(res.stdout);
  if (json) {
    const data = json.data && typeof json.data === 'object' ? json.data : json;
    return {
      exitCode,
      skipped: exitCode === 0 && Boolean(json.skipped),
      name: typeof json.name === 'string' && json.name ? json.name : fallbackName,
      lens: LENSES.includes(json.lens) ? json.lens : fallbackLens,
      data,
      output,
    };
  }
  const line = exitCode === 0 ? lastLine(res.stdout) : (lastLine(res.stderr) || lastLine(res.stdout));
  return {
    exitCode, skipped: false, name: fallbackName, lens: fallbackLens,
    data: { message: line || (exitCode === 0 ? 'Passed' : `Exited with code ${exitCode}`) },
    output,
  };
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

/** One markdown bullet per violation (or finding) of a failed guard. */
function violationLines(result) {
  const lines = [];
  const violations = result.data?.violations || result.data?.findings || {};
  if (Array.isArray(violations)) {
    for (const item of violations) {
      lines.push(`- ${item.file ? `\`${item.file}\`: ` : ''}${item.message || item.reason || JSON.stringify(item)}`);
    }
    return lines;
  }
  if (!violations || typeof violations !== 'object') return lines;
  for (const file of Object.keys(violations)) {
    const items = Array.isArray(violations[file]) ? violations[file] : [];
    for (const item of items) {
      const loc = item.lineNo ? ` (line ${item.lineNo})` : '';
      const label = item.label || item.rule || item.module || '';
      const msg = item.message || item.reason || '';
      lines.push(`- \`${file}\`${loc}: ${label ? `[${label}] ` : ''}${msg}`);
    }
  }
  return lines;
}

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
    lines.push(...violationLines(result));
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
  sections.push('> Results grouped into 4 lenses (Correctness, Security, Architecture, Performance).');
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

/** Runs every planned guard once, in plan order. */
async function runPlan(plan, dir) {
  const results = [];
  for (const entry of plan) {
    if (entry.mode === 'missing') results.push(missingGuardResult(entry));
    else if (entry.mode === 'module') results.push(await runGuard(entry.file, dir));
    else results.push(runProjectGuard(entry.file, dir));
  }
  return results;
}

/**
 * --hook output: one line per guard; a failed guard also prints its
 * violations, or its raw output when it reported none.
 */
function printHookSummary(results) {
  for (const result of results) {
    const status = result.skipped ? 'skip' : result.exitCode === 0 ? 'ok  ' : 'FAIL';
    console.log(`clckernel: ${status} ${result.name}: ${result.data?.message || ''}`);
    if (result.skipped || result.exitCode === 0) continue;
    const details = violationLines(result);
    const lines = details.length > 0 ? details : String(result.output || '').trimEnd().split('\n').filter(Boolean);
    for (const line of lines) console.log(`    ${line}`);
  }
}

/**
 * @param {string} [targetDir] - Project root (default: cwd)
 * @param {{ hook?: boolean }} [options] - hook: write nothing, print one line per guard
 * @returns {Promise<number>} 1 when a guard failed, else 0
 */
async function main(targetDir, options = {}) {
  const hook = Boolean(options.hook);
  const dir = targetDir ? path.resolve(targetDir) : process.cwd();
  const targetTools = path.join(dir, 'tools');
  const toolsDir = fs.existsSync(targetTools) ? targetTools : __dirname;
  const plan = planGuards(toolsDir);

  if (hook) {
    const results = await runPlan(plan, dir);
    printHookSummary(results);
    return results.some(r => !r.skipped && r.exitCode !== 0) ? 1 : 0;
  }

  const sddDir = getActiveSddDir(dir);
  console.log('\nRunning CLC Kernel audit...\n');

  if (plan.length === 0) {
    console.log('No guard tools found in tools/. Nothing to audit.');
    return 0;
  }

  const names = plan.map(entry => entry.label.replace(/\.js$/, ''));
  console.log(`Discovered ${names.length} guard(s): ${names.join(', ')}\n`);

  const results = await runPlan(plan, dir);

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
  return results.some(r => !r.skipped && r.exitCode !== 0) ? 1 : 0;
}

/** argv: [targetDir] [--hook], in any order. */
function parseArgs(argv) {
  const hook = argv.includes('--hook');
  const targetDir = argv.find(arg => !arg.startsWith('--'));
  return { targetDir, hook };
}

// Support both require() and direct execution. Any crash fails closed.
if (require.main === module) {
  const { targetDir, hook } = parseArgs(process.argv.slice(2));
  main(targetDir, { hook }).then(code => {
    // exitCode, not exit(): a piped stdout is flushed before the process ends.
    process.exitCode = code;
  }, err => {
    console.error(`Audit orchestrator error: ${err && err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main, getActiveSddDir, discoverGuards, discoverProjectGuards, planGuards, isGuardFile,
  runGuard, runProjectGuard, generateReceipt,
};
