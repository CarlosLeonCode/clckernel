/**
 * CLC Kernel — PHP / Laravel Stack Adapter
 * Supports Laravel, Pest / PHPUnit, and PHPStan static analysis.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class LaravelAdapter extends BaseAdapter {
  constructor() {
    super('PHP / Laravel', 'backend', 'Pest / PHPUnit');
  }

  detect(targetDir) {
    const hasComposer = fs.existsSync(path.join(targetDir, 'composer.json'));
    const hasArtisan = fs.existsSync(path.join(targetDir, 'artisan'));
    return hasComposer && hasArtisan;
  }

  getSafeguards() {
    return [
      'PHPStan Static Analysis (external CLI)',
      'Laravel Migration Reversibility protocol (agent-enforced; no migration guard installed for this stack)',
      'Red→Green TDD Verifier (runs changed tests with PHPUnit or Pest)',
      'Secret & Private Key Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
    ];
  }

  /**
   * Returns the tool manifest for Laravel projects.
   * External CLIs plus the bundled JS guards (secret scan, TDD verifier, custom rules).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'scan_secrets', language: 'js',       path: 'scan_secrets.js', command: 'node tools/scan_secrets.js', description: 'Scans for leaked secrets and API keys' },
      { name: 'verify_tdd',   language: 'js',       path: 'verify_tdd.js',   command: 'node tools/verify_tdd.js',   description: 'Runs changed tests (Pest / PHPUnit) against BASE (must fail) and the staged code (must pass)' },
      { name: 'check_custom', language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'phpstan',  language: 'external', path: '', command: './vendor/bin/phpstan analyse', description: 'PHP static analysis', extCLI: 'phpstan', availableIf: '[ -x vendor/bin/phpstan ]' },
      { name: 'artisan',  language: 'external', path: '', command: 'php artisan test',            description: 'Laravel test runner', extCLI: 'artisan', availableIf: '[ -f artisan ] && command -v php' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = LaravelAdapter;
