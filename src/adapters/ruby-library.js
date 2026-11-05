/**
 * CLC Kernel — Ruby Library Adapter
 * A plain Ruby package (a *.gemspec or a Gemfile, without Rails'
 * config/routes.rb) inside a monorepo or full-stack repository: RuboCop and its
 * tests (RSpec, or Minitest through rake) when its Gemfile.lock has them.
 *
 * Used only for parts in subdirectories (sdds/monorepo-library-parts): never the
 * repository root, never offered in "Choose another stack", tried only on a dir
 * no framework adapter (Rails) matched.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

const RSPEC = "grep -q '^    rspec-core ' Gemfile.lock";

class RubyLibraryAdapter extends BaseAdapter {
  constructor() {
    super('Ruby Library', 'library', 'RSpec / Minitest');
  }

  detect(targetDir) {
    if (fs.existsSync(path.join(targetDir, 'Gemfile'))) return true;
    try {
      return fs.readdirSync(targetDir).some((name) => name.endsWith('.gemspec'));
    } catch {
      return false;
    }
  }

  getSafeguards() {
    return [
      'RuboCop Code Style Linter (external CLI)',
      'Red→Green TDD Verifier (runs changed tests with RSpec or Minitest)',
      'Secret & Private Credential Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
    ];
  }

  /**
   * The bundled JS guards, RuboCop, and the tests: RSpec when the lock has
   * rspec-core, else Minitest through `rake test` (never both).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    return [
      { name: 'scan_secrets', language: 'js',       path: 'scan_secrets.js', command: 'node tools/scan_secrets.js', description: 'Scans for leaked secrets and API keys' },
      { name: 'verify_tdd',   language: 'js',       path: 'verify_tdd.js',   command: 'node tools/verify_tdd.js',   description: 'Runs changed tests (RSpec / Minitest) against BASE (must fail) and the staged code (must pass)' },
      { name: 'check_custom', language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'rubocop',      language: 'external', path: '', command: 'bundle exec rubocop --parallel', description: 'Ruby linter', extCLI: 'rubocop', availableIf: "grep -q '^    rubocop ' Gemfile.lock" },
      { name: 'rspec',        language: 'external', path: '', command: 'bundle exec rspec',               description: 'Test runner', extCLI: 'rspec', availableIf: RSPEC },
      { name: 'minitest',     language: 'external', path: '', command: 'bundle exec rake test',           description: 'Test runner (Minitest through rake)', extCLI: 'rake', availableIf: `[ -f Rakefile ] && grep -q '^    minitest ' Gemfile.lock && ! ${RSPEC}` },
    ];
  }
}

module.exports = RubyLibraryAdapter;
