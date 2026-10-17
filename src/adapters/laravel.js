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
      'TDD protocol (agent-enforced; no verifier installed for this stack)',
      'Secret & Private Key Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory Guard (Engram / Graphify ADR Sync)'
    ];
  }

  /**
   * Returns the tool manifest for Laravel projects.
   * External CLIs only — no custom guard scripts bundled.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'check_custom', language: 'python',   path: 'check_custom.py', command: 'python3 tools/check_custom.py', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'phpstan',  language: 'external', path: '', command: './vendor/bin/phpstan analyse', description: 'PHP static analysis', extCLI: 'phpstan' },
      { name: 'artisan',  language: 'external', path: '', command: 'php artisan test',            description: 'Laravel test runner', extCLI: 'artisan' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = LaravelAdapter;
