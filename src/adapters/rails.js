/**
 * CLC Kernel — Ruby on Rails Stack Adapter
 * Supports Rails, RSpec, RuboCop, and Brakeman security scanning.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class RailsAdapter extends BaseAdapter {
  constructor() {
    super('Ruby on Rails', 'backend', 'RSpec / Minitest');
  }

  detect(targetDir) {
    const hasGemfile = fs.existsSync(path.join(targetDir, 'Gemfile'));
    const hasRailsRoute = fs.existsSync(path.join(targetDir, 'config', 'routes.rb'));
    return hasGemfile && hasRailsRoute;
  }

  getSafeguards() {
    return [
      'RuboCop Code Style Linter (external CLI)',
      'Brakeman Rails Vulnerability Scanner',
      'Rails Migration Reversibility protocol (agent-enforced; no migration guard installed for this stack)',
      'TDD protocol (agent-enforced; no verifier installed for this stack)',
      'Secret & Private Credential Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
    ];
  }

  /**
   * Returns the tool manifest for Rails projects.
   * External CLIs only — no custom guard scripts bundled.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'scan_secrets', language: 'js',       path: 'scan_secrets.js', command: 'node tools/scan_secrets.js', description: 'Scans for leaked secrets and API keys' },
      { name: 'check_custom', language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'rubocop',  language: 'external', path: '', command: 'bundle exec rubocop --parallel', description: 'Ruby linter', extCLI: 'rubocop', availableIf: "grep -q '^    rubocop ' Gemfile.lock" },
      { name: 'brakeman', language: 'external', path: '', command: 'bundle exec brakeman -q',        description: 'Rails vulnerability scanner', extCLI: 'brakeman', availableIf: "grep -q '^    brakeman ' Gemfile.lock" },
      { name: 'rspec',    language: 'external', path: '', command: 'bundle exec rspec',               description: 'Test runner', extCLI: 'rspec', availableIf: "grep -q '^    rspec-core ' Gemfile.lock" },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = RailsAdapter;
