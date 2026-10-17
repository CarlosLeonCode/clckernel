/**
 * CLC Kernel — Go Stack Adapter
 * Supports Golang apps, `go test`, golangci-lint, and Domain/UseCase Clean Architecture.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class GoAdapter extends BaseAdapter {
  constructor() {
    super('Go (Golang)', 'backend', 'go test');
  }

  detect(targetDir) {
    return fs.existsSync(path.join(targetDir, 'go.mod'));
  }

  getSafeguards() {
    return [
      'golangci-lint Code Quality Linter (external CLI)',
      'Go Clean Architecture Guard (Domain -> UseCase -> Handler)',
      'TDD protocol (agent-enforced; no verifier installed for this stack)',
      'Secret & Private Key Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
    ];
  }

  /**
   * Returns the tool manifest for Go projects.
   * External CLIs only — no custom guard scripts bundled.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'check_custom',   language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'golangci-lint', language: 'external', path: '', command: 'golangci-lint run',  description: 'Go linter and static analysis', extCLI: 'golangci-lint' },
      { name: 'go_test',       language: 'external', path: '', command: 'go test ./...',       description: 'Go test runner', extCLI: 'go' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = GoAdapter;
