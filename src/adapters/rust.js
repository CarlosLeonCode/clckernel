/**
 * CLC Kernel — Rust Stack Adapter
 * Supports Rust, `cargo test`, `cargo clippy`, `cargo audit`, and memory safety.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class RustAdapter extends BaseAdapter {
  constructor() {
    super('Rust Engine', 'backend', 'cargo test');
  }

  detect(targetDir) {
    return fs.existsSync(path.join(targetDir, 'Cargo.toml'));
  }

  getSafeguards() {
    return [
      'cargo clippy Linter (external CLI)',
      'cargo audit Security Vulnerability Scanner',
      'Red→Green TDD Verifier (runs changed tests with cargo test)',
      'Secret & Private Key Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
    ];
  }

  /**
   * Returns the tool manifest for Rust projects.
   * External CLIs plus the bundled JS guards (secret scan, TDD verifier, custom rules).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'scan_secrets', language: 'js',       path: 'scan_secrets.js', command: 'node tools/scan_secrets.js', description: 'Scans for leaked secrets and API keys' },
      { name: 'verify_tdd',   language: 'js',       path: 'verify_tdd.js',   command: 'node tools/verify_tdd.js',   description: 'Runs changed tests (cargo test integration tests) against BASE (must fail) and the staged code (must pass)' },
      { name: 'check_custom',  language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'cargo_clippy',  language: 'external', path: '', command: 'cargo clippy -- -D warnings', description: 'Rust linter and static analysis', extCLI: 'clippy', availableIf: 'cargo clippy --version' },
      { name: 'cargo_audit',   language: 'external', path: '', command: 'cargo audit',                description: 'Security vulnerability scanner', extCLI: 'cargo-audit', availableIf: 'command -v cargo-audit' },
      { name: 'cargo_test',    language: 'external', path: '', command: 'cargo test',                  description: 'Rust test runner', extCLI: 'cargo', availableIf: 'command -v cargo' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = RustAdapter;
