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
      'TDD protocol (agent-enforced; no verifier installed for this stack)',
      'Secret & Private Key Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory Guard (Engram / Graphify ADR Sync)'
    ];
  }

  /**
   * Returns the tool manifest for Rust projects.
   * External CLIs only — no custom guard scripts bundled.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'check_custom',  language: 'js',       path: 'check_custom.js', command: 'node tools/check_custom.js', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'cargo_clippy',  language: 'external', path: '', command: 'cargo clippy -- -D warnings', description: 'Rust linter and static analysis', extCLI: 'clippy' },
      { name: 'cargo_audit',   language: 'external', path: '', command: 'cargo audit',                description: 'Security vulnerability scanner', extCLI: 'cargo-audit' },
      { name: 'cargo_test',    language: 'external', path: '', command: 'cargo test',                  description: 'Rust test runner', extCLI: 'cargo' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = RustAdapter;
