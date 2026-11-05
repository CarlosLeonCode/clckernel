/**
 * CLC Kernel — JavaScript Library Adapter
 * A plain JavaScript package (package.json, or an Nx project.json without one,
 * no framework) inside a monorepo or full-stack repository: the stack-agnostic
 * JS guards cover it.
 *
 * Used only for parts in subdirectories: it is not
 * in the detector's `adapters` list, so the repository root is never detected as
 * a library and "Choose another stack" never offers it. It is tried only on a
 * dir no framework adapter matched. TypeScriptLibraryAdapter extends it.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

const NAME = 'JavaScript Library';
const DEFAULT_TEST_RUNNER = 'Vitest / Jest';

/**
 * Test runner a package declares: Vitest or Jest when exactly one of them is a
 * dependency, else (or without a package.json) the default JS label.
 * @param {string} dir - Package directory
 * @returns {string}
 */
function packageTestRunner(dir) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  } catch {
    return DEFAULT_TEST_RUNNER;
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.vitest && !deps.jest) return 'Vitest';
  if (deps.jest && !deps.vitest) return 'Jest';
  return DEFAULT_TEST_RUNNER;
}

class JavaScriptLibraryAdapter extends BaseAdapter {
  constructor(testRunner = DEFAULT_TEST_RUNNER, name = NAME) {
    super(name, 'library', testRunner);
  }

  detect(targetDir) {
    // Nx libraries often have only a project.json; their tools are hoisted to the root.
    return ['package.json', 'project.json'].some((file) => fs.existsSync(path.join(targetDir, file)));
  }

  /**
   * The adapter of one part: a new instance reporting that package's test runner.
   * @param {string} dir - Part directory (absolute)
   * @returns {JavaScriptLibraryAdapter}
   */
  forDir(dir) {
    return new this.constructor(packageTestRunner(dir));
  }

  getSafeguards() {
    return [
      'Secret & API Key Leak Scanner',
      'Red→Green TDD Verifier (runs changed tests with vitest / jest / node:test)',
      'Educational Audit Gate (05-audit-report.md)',
    ];
  }

  /**
   * Stack-agnostic JS guards, deduplicated with the other parts' guards.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string}>}
   */
  getTools() {
    return [
      { name: 'scan_secrets', language: 'js', path: 'scan_secrets.js', command: 'node tools/scan_secrets.js', description: 'Scans for leaked secrets and API keys' },
      { name: 'verify_tdd',   language: 'js', path: 'verify_tdd.js',   command: 'node tools/verify_tdd.js',   description: 'Runs changed tests (vitest / jest / node:test) against BASE (must fail) and the staged code (must pass)' },
      { name: 'check_custom', language: 'js', path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
    ];
  }
}

JavaScriptLibraryAdapter.DEFAULT_TEST_RUNNER = DEFAULT_TEST_RUNNER;
module.exports = JavaScriptLibraryAdapter;
