/**
 * CLC Kernel — PHP Library Adapter
 * A plain PHP package (composer.json without Laravel's artisan) inside a
 * monorepo or full-stack repository: PHPStan and its tests from vendor/bin.
 *
 * Used only for parts in subdirectories: never the
 * repository root, never offered in "Choose another stack", tried only on a dir
 * no framework adapter (Laravel) matched.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class PhpLibraryAdapter extends BaseAdapter {
  constructor() {
    super('PHP Library', 'library', 'Pest / PHPUnit');
  }

  detect(targetDir) {
    return fs.existsSync(path.join(targetDir, 'composer.json'));
  }

  getSafeguards() {
    return [
      'PHPStan Static Analysis (external CLI)',
      'Red→Green TDD Verifier (runs changed tests with PHPUnit or Pest)',
      'Secret & Private Key Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
    ];
  }

  /**
   * The bundled JS guards, PHPStan, and one test step: Pest when installed
   * (it runs PHPUnit tests too), else PHPUnit, both from the package's vendor/bin.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    return [
      { name: 'scan_secrets', language: 'js',       path: 'scan_secrets.js', command: 'node tools/scan_secrets.js', description: 'Scans for leaked secrets and API keys' },
      { name: 'verify_tdd',   language: 'js',       path: 'verify_tdd.js',   command: 'node tools/verify_tdd.js',   description: 'Runs changed tests (Pest / PHPUnit) against BASE (must fail) and the staged code (must pass)' },
      { name: 'check_custom', language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'phpstan',      language: 'external', path: '', command: './vendor/bin/phpstan analyse', description: 'PHP static analysis', extCLI: 'phpstan', availableIf: '[ -x vendor/bin/phpstan ]' },
      { name: 'phpunit',      language: 'external', path: '', command: 'if [ -x vendor/bin/pest ]; then ./vendor/bin/pest; else ./vendor/bin/phpunit; fi', description: 'Test runner (Pest or PHPUnit)', extCLI: 'phpunit', availableIf: '[ -x vendor/bin/pest ] || [ -x vendor/bin/phpunit ]' },
    ];
  }
}

module.exports = PhpLibraryAdapter;
