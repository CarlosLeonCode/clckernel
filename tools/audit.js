#!/usr/bin/env node
/**
 * Modular Audit Orchestrator — JS
 * The single place that decides which guards run (sdds/unified-discovery):
 * `clckernel audit` and agents run it, the pre-commit hook runs it with --hook.
 * Same discovery, same guards, each exactly once:
 *   - top-level tools/ guards: check_*, scan_*, verify_* or *_guard, .js/.py;
 *   - every tools/guards/*.js and *.py (project guards).
 * audit.js runs the .js guards; the .py ones belong to audit.py, unless
 * tools/audit.py is not installed: then audit.js runs them too, with python3.
 * A top-level guard of this language that exports a function is called in
 * process; every other guard runs as a process (exit code decides, a JSON
 * result is optional). A guard listed in the managed registry but missing on
 * disk fails the run. Results are grouped into 4 lenses.
 *
 * CLI (sdds/audit-cli): audit.js [targetDir] [--hook] [--change <name>] [--staged]
 *   (none)           print the 4-lens summary; write nothing
 *   --change <name>  also write sdds/<name>/05-audit-report.md and
 *                    audit-receipt.json (<name>: one safe path segment)
 *   --hook           one line per guard; write nothing (not with --change)
 *   --staged         the default snapshot, spelled out: the staged changes,
 *                    or the last commit when nothing is staged (_changes)
 * Unknown input exits 2. A failing guard whose level is 'warning' (its result's
 * `level`, overridden by `severities` in .clckernel.yaml) is reported but does
 * not fail the run; a guard that crashes always does. Self-contained: Node.js
 * built-ins plus the sibling _config.js (optional).
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
const USAGE = 'usage: audit.js [targetDir] [--hook] [--change <name>] [--staged]';
const CHANGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
    exitCode: 1, skipped: false, crashed: true, name, lens: getLensForGuard(name),
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
 * that defines check() is called through that contract; when it exits non-zero
 * without a JSON result it crashed. Lens: the JSON's, else the guard name's,
 * else architecture; level: the JSON's `level`.
 * @param {string} guardPath - Absolute path to the guard
 * @param {string} targetDir - Project root
 * @returns {object} Normalized result (`output`: the guard's raw output)
 */
function runProjectGuard(guardPath, targetDir) {
  const ext = path.extname(guardPath);
  const fallbackName = path.basename(guardPath, ext);
  const moduleContract = ext === '.py' && definesCheck(guardPath);
  const args = moduleContract ? ['-c', PY_MODULE_RUNNER, guardPath] : [guardPath];
  const res = spawnSync(PROJECT_GUARD_RUNNERS[ext], args, { cwd: targetDir, encoding: 'utf-8', maxBuffer: MAX_BUFFER });
  const fallbackLens = getLensForGuard(fallbackName);
  if (res.error) {
    return {
      exitCode: 1, skipped: false, crashed: true, name: fallbackName, lens: fallbackLens,
      data: { message: `Guard crashed: ${res.error.message}` },
    };
  }
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  if (typeof res.status !== 'number') {
    return {
      exitCode: 1, skipped: false, crashed: true, name: fallbackName, lens: fallbackLens,
      data: { message: `Guard crashed: killed by ${res.signal || 'a signal'}` },
      output,
    };
  }
  const exitCode = res.status;
  const json = parseGuardJson(res.stdout);
  if (json) {
    const data = json.data && typeof json.data === 'object' ? json.data : json;
    return {
      exitCode,
      skipped: exitCode === 0 && Boolean(json.skipped),
      crashed: false,
      level: json.level,
      name: typeof json.name === 'string' && json.name ? json.name : fallbackName,
      lens: LENSES.includes(json.lens) ? json.lens : fallbackLens,
      data,
      output,
    };
  }
  const line = exitCode === 0 ? lastLine(res.stdout) : (lastLine(res.stderr) || lastLine(res.stdout));
  const crashed = moduleContract && exitCode !== 0;
  return {
    exitCode, skipped: false, crashed, name: fallbackName, lens: fallbackLens,
    data: { message: crashed ? `Guard crashed: ${line || `exited with code ${exitCode}`}` : (line || (exitCode === 0 ? 'Passed' : `Exited with code ${exitCode}`)) },
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
        exitCode: 1, skipped: false, crashed: true, name: guardName, lens,
        data: { message: `Guard crashed: ${guardName} does not export a function` },
      };
    }
    const result = await fn(targetDir);
    if (!result || typeof result !== 'object') {
      return {
        exitCode: 1, skipped: false, crashed: true, name: guardName, lens,
        data: { message: `Guard crashed: ${guardName} returned ${result === null ? 'null' : typeof result}` },
      };
    }
    // Normalize result shape
    return {
      exitCode: result.exitCode || 0,
      skipped: Boolean(result.skipped),
      crashed: false,
      level: result.level,
      name: result.name || guardName,
      lens,
      data: result.data || result,
    };
  } catch (e) {
    // A guard that cannot run must never approve a commit (fail closed).
    return {
      exitCode: 1, skipped: false, crashed: true, name: guardName, lens,
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

// ── Result levels (sdds/audit-cli) ───────────────────────────────────────────

/** A guard that ran and did not pass (skipped guards never fail). */
const isFailed = (r) => !r.skipped && r.exitCode !== 0;
/** A failure reported but not blocking: effective level 'warning'. */
const isWarning = (r) => isFailed(r) && r.level === 'warning';
/** A failure that fails the run. */
const isBlocking = (r) => isFailed(r) && r.level !== 'warning';

/**
 * Sets each result's effective level: severities[name] (or [file stem]) from
 * .clckernel.yaml, else the guard's own `level` ('warning' only), else
 * 'error'. A crash is always 'error' (fail closed).
 * @param {object[]} results - Normalized results (with `stem`)
 * @param {Record<string, 'error'|'warning'>} severities
 * @returns {object[]} The same results
 */
function applyLevels(results, severities = {}) {
  const has = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(severities, key);
  for (const result of results) {
    let level = result.level === 'warning' ? 'warning' : 'error';
    if (has(result.name)) level = severities[result.name];
    else if (has(result.stem)) level = severities[result.stem];
    result.level = result.crashed ? 'error' : level;
  }
  return results;
}

/** [icon, STATUS] of a result. */
function statusOf(result) {
  if (result.skipped) return ['⏭️', 'SKIPPED'];
  if (!isFailed(result)) return ['✅', 'PASSED'];
  return isWarning(result) ? ['⚠️', 'WARNING'] : ['❌', 'FAILED'];
}

/** Lens/verdict status: FAILED on a blocking failure, PASSED_WITH_WARNINGS on warnings only. */
function verdictOf(results) {
  if (results.some(isBlocking)) return 'FAILED';
  return results.some(isWarning) ? 'PASSED_WITH_WARNINGS' : 'PASSED';
}

// ── Report Generation ────────────────────────────────────────────────────────

/**
 * Format a single guard result into a markdown section.
 */
function formatGuardSection(name, result) {
  const lines = [];
  const [icon, status] = statusOf(result);
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
  const failed = results.filter(isBlocking).length;
  const warnings = results.filter(isWarning);
  const skipped = results.filter(r => r.skipped).length;
  const total = results.length;

  const sections = [];

  sections.push(`# Code Audit Report: ${taskName}`);
  sections.push('');
  sections.push('> **Review-Driven Development (RDD) Report:**');
  sections.push('> Results grouped into 4 lenses (Correctness, Security, Architecture, Performance).');
  sections.push('');
  sections.push(`**Verdict:** ${verdictOf(results)}`);
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
  sections.push(`| Warnings | ${warnings.length} |`);
  sections.push(`| Skipped | ${skipped} |`);
  sections.push('');
  sections.push('---');
  sections.push('');

  if (warnings.length > 0) {
    sections.push('## ⚠️ Warnings');
    sections.push('');
    sections.push('_Failed, but not blocking (level `warning`)._');
    sections.push('');
    for (const result of warnings) sections.push(`- **${result.name}** [${result.lens.toUpperCase()}]: ${result.data?.message || 'Issues found'}`);
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  const lensHeaders = {
    correctness: '## 🎯 Correctness Lens',
    security: '## 🛡️ Security Lens',
    architecture: '## 🏛️ Architecture Lens',
    performance: '## ⚡ Performance Lens',
  };

  for (const lens of LENSES) {
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
 * verdict: FAILED | PASSED_WITH_WARNINGS | PASSED; `failed` counts blocking
 * failures, `warnings` the non-blocking ones (listed in `warnings`).
 */
function generateReceipt(results, targetDir) {
  const lensSummary = {};

  for (const lens of LENSES) {
    const lensResults = results.filter(r => r.lens === lens);
    lensSummary[lens] = {
      status: verdictOf(lensResults),
      passed: lensResults.filter(r => !r.skipped && r.exitCode === 0).length,
      failed: lensResults.filter(isBlocking).length,
      warnings: lensResults.filter(isWarning).length,
      skipped: lensResults.filter(r => r.skipped).length,
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
    verdict: verdictOf(results),
    lenses: lensSummary,
    warnings: results.filter(isWarning).map(r => ({ name: r.name, lens: r.lens, message: r.data?.message || '' })),
    generator: 'clckernel',
    gentle_ai: {
      compatible: true,
      rdd_ready: true,
      cli_installed: gentleAiDetected,
    },
  };
}

// ── Console Summary ──────────────────────────────────────────────────────────

/**
 * The 4-lens summary. reportPath/receiptPath: where they were written, or
 * null when no --change was given (then a hint says how to write them).
 */
function printSummary(results, reportPath, receiptPath) {
  console.log('\n=================================================================');
  console.log('  CLC KERNEL — 4-LENS RDD AUDIT SUMMARY');
  console.log('=================================================================\n');

  const lensLabels = {
    correctness: '🎯 CORRECTNESS LENS',
    security: '🛡️ SECURITY LENS',
    architecture: '🏛️ ARCHITECTURE LENS',
    performance: '⚡ PERFORMANCE LENS',
  };

  for (const lens of LENSES) {
    const lensResults = results.filter(r => r.lens === lens);
    console.log(`  ${lensLabels[lens]}:`);
    if (lensResults.length === 0) {
      console.log('     — No guards active for this lens');
    } else {
      for (const result of lensResults) {
        const [icon] = statusOf(result);
        const label = result.name.replace(/_/g, ' ');
        const msg = result.data?.message || (result.exitCode === 0 ? 'Passed' : 'Failed');
        console.log(`     ${icon} ${label}: ${msg}`);
      }
    }
    console.log('');
  }

  console.log(`Verdict: ${verdictOf(results)}`);
  if (reportPath) {
    console.log(`📄 Full report: ${reportPath}`);
    if (receiptPath) console.log(`🧾 Audit receipt: ${receiptPath}`);
  } else {
    console.log('No report written: pass --change <name> to write sdds/<name>/05-audit-report.md and audit-receipt.json.');
  }
  console.log('=================================================================\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

/** Runs every planned guard once, in plan order; each result keeps its file stem. */
async function runPlan(plan, dir) {
  const results = [];
  for (const entry of plan) {
    let result;
    if (entry.mode === 'missing') result = missingGuardResult(entry);
    else if (entry.mode === 'module') result = await runGuard(entry.file, dir);
    else result = runProjectGuard(entry.file, dir);
    result.stem = path.basename(entry.file, path.extname(entry.file));
    results.push(result);
  }
  return results;
}

/**
 * --hook output: one line per guard (ok, skip, WARN, FAIL); a failed guard
 * also prints its violations, or its raw output when it reported none.
 */
function printHookSummary(results) {
  for (const result of results) {
    const status = result.skipped ? 'skip' : !isFailed(result) ? 'ok  ' : isWarning(result) ? 'WARN' : 'FAIL';
    console.log(`clckernel: ${status} ${result.name}: ${result.data?.message || ''}`);
    if (!isFailed(result)) continue;
    const details = violationLines(result);
    const lines = details.length > 0 ? details : String(result.output || '').trimEnd().split('\n').filter(Boolean);
    for (const line of lines) console.log(`    ${line}`);
  }
}

/**
 * `severities` from the project's .clckernel.yaml, read with the sibling
 * _config.js; {} when that module is not installed. An invalid config throws.
 */
function loadSeverities(dir) {
  let configModule;
  try {
    configModule = require(path.join(__dirname, '_config.js'));
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return {};
    throw err;
  }
  return configModule.loadConfig(dir).config.severities || {};
}

/**
 * @param {string} [targetDir] - Project root (default: cwd)
 * @param {{ hook?: boolean, change?: string|null }} [options] - hook: one line
 *   per guard; change: write the report and receipt to sdds/<change>/
 * @returns {Promise<number>} 1 when a guard failed with level error, else 0
 */
async function main(targetDir, options = {}) {
  const hook = Boolean(options.hook);
  const change = options.change || null;
  const dir = targetDir ? path.resolve(targetDir) : process.cwd();
  const targetTools = path.join(dir, 'tools');
  const toolsDir = fs.existsSync(targetTools) ? targetTools : __dirname;
  const plan = planGuards(toolsDir);

  let severities;
  try {
    severities = loadSeverities(dir);
  } catch (err) {
    console.error(`clckernel: ${err.message}`);
    return 1;
  }

  if (hook) {
    const results = applyLevels(await runPlan(plan, dir), severities);
    printHookSummary(results);
    return results.some(isBlocking) ? 1 : 0;
  }

  console.log('\nRunning CLC Kernel audit...\n');

  if (plan.length === 0) {
    console.log('No guard tools found in tools/. Nothing to audit.');
    return 0;
  }

  const names = plan.map(entry => entry.label.replace(/\.js$/, ''));
  console.log(`Discovered ${names.length} guard(s): ${names.join(', ')}\n`);

  const results = applyLevels(await runPlan(plan, dir), severities);

  let reportPath = null;
  let receiptPath = null;
  if (change) {
    const sddDir = path.join(dir, 'sdds', change);
    fs.mkdirSync(sddDir, { recursive: true });
    reportPath = path.join(sddDir, '05-audit-report.md');
    fs.writeFileSync(reportPath, generateReport(results, sddDir), 'utf-8');
    receiptPath = path.join(sddDir, 'audit-receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify(generateReceipt(results, dir), null, 2) + '\n', 'utf-8');
  }

  printSummary(results, reportPath, receiptPath);

  return results.some(isBlocking) ? 1 : 0;
}

/**
 * argv: [targetDir] [--hook] [--change <name>] [--staged], in any order.
 * @returns {{ targetDir?: string, hook: boolean, change: string|null, staged: boolean } | { error: string }}
 */
function parseArgs(argv) {
  const out = { targetDir: undefined, hook: false, change: null, staged: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--hook') out.hook = true;
    else if (arg === '--staged') out.staged = true;
    else if (arg === '--change') {
      if (i + 1 >= argv.length) return { error: '--change needs a name' };
      const name = argv[i += 1];
      if (!CHANGE_NAME.test(name)) return { error: `invalid --change name ${JSON.stringify(name)}: use one path segment (letters, digits, ., _, -)` };
      out.change = name;
    } else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else if (out.targetDir !== undefined) return { error: `unexpected argument ${arg}` };
    else out.targetDir = arg;
  }
  if (out.hook && out.change) return { error: '--hook writes nothing; it cannot be combined with --change' };
  return out;
}

// Support both require() and direct execution. Any crash fails closed.
if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`audit.js: ${args.error}\n${USAGE}`);
    process.exitCode = 2;
  } else {
    main(args.targetDir, { hook: args.hook, change: args.change }).then(code => {
      // exitCode, not exit(): a piped stdout is flushed before the process ends.
      process.exitCode = code;
    }, err => {
      console.error(`Audit orchestrator error: ${err && err.message}`);
      process.exit(1);
    });
  }
}

module.exports = {
  main, parseArgs, applyLevels, discoverGuards, discoverProjectGuards, planGuards, isGuardFile,
  runGuard, runProjectGuard, generateReceipt,
};
