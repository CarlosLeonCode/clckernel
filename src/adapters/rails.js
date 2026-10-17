/**
 * CLC Kernel — Ruby on Rails Stack Adapter
 * Supports Rails, RSpec, RuboCop AST, Brakeman Security, and migration idempotency.
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
      'RuboCop Code Style & AST Security Guard',
      'Brakeman Rails Vulnerability Scanner',
      'Rails Migration Idempotency Guard (schema drift protection)',
      'RSpec / Minitest Red-to-Green TDD Validator',
      'Secret & Private Credential Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory Guard (Engram / Graphify ADR Sync)'
    ];
  }

  /**
   * Returns the tool manifest for Rails projects.
   * External CLIs only — no custom guard scripts bundled.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'check_custom', language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clc-forge.yml' },
      { name: 'rubocop',  language: 'external', path: '', command: 'bundle exec rubocop --parallel', description: 'Ruby linter', extCLI: 'rubocop' },
      { name: 'brakeman', language: 'external', path: '', command: 'bundle exec brakeman -q',        description: 'Rails vulnerability scanner', extCLI: 'brakeman' },
      { name: 'rspec',    language: 'external', path: '', command: 'bundle exec rspec',               description: 'Test runner', extCLI: 'rspec' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = RailsAdapter;
