/**
 * CLC Kernel — FastAPI Stack Adapter
 * Supports FastAPI apps, pytest, Pydantic V2, Alembic idempotency, and AST Clean Architecture.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class FastApiAdapter extends BaseAdapter {
  constructor() {
    super('FastAPI Framework', 'backend', 'Pytest');
  }

  detect(targetDir) {
    const hasPyproject = fs.existsSync(path.join(targetDir, 'pyproject.toml'));
    const hasRequirements = fs.existsSync(path.join(targetDir, 'requirements.txt'));

    if (hasPyproject || hasRequirements) {
      try {
        const pyproject = hasPyproject ? fs.readFileSync(path.join(targetDir, 'pyproject.toml'), 'utf-8') : '';
        const reqs = hasRequirements ? fs.readFileSync(path.join(targetDir, 'requirements.txt'), 'utf-8') : '';
        return pyproject.toLowerCase().includes('fastapi') || reqs.toLowerCase().includes('fastapi');
      } catch (e) {}
    }

    return false;
  }

  getSafeguards() {
    return [
      'Ruff / Flake8 Python AST Code Quality Linter',
      'Clean Architecture AST Guard (Domain -> Application -> Routes)',
      'Database Efficiency & N+1 Performance Guard (bulk queries & eager loading)',
      'Alembic Migration Idempotency & Schema Drift Guard',
      'Pytest Red-to-Green TDD Validator',
      'Pydantic V2 Response Schema Validation Guard',
      'Secret & Private Key Leak Scanner',
      'Scope Guardrail (git diff vs SDD affected files)',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory Guard (Engram / Graphify ADR Sync)'
    ];
  }

  /**
   * Returns the tool manifest for FastAPI projects.
   * Includes Python guard scripts and external CLI tools (ruff, pytest).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'scan_secrets',         language: 'py',       path: 'scan_secrets.py',         command: 'python3 tools/scan_secrets.py',         description: 'Scans for leaked secrets and API keys' },
      { name: 'check_architecture',   language: 'py',       path: 'check_architecture.py',   command: 'python3 tools/check_architecture.py',   description: 'Validates Clean Architecture layer boundaries' },
      { name: 'check_db_efficiency',  language: 'py',       path: 'check_db_efficiency.py',  command: 'python3 tools/check_db_efficiency.py',  description: 'Audits database query efficiency and N+1 loop calls' },
      { name: 'check_migrations',     language: 'py',       path: 'check_migrations.py',     command: 'python3 tools/check_migrations.py',     description: 'Checks Alembic migration idempotency' },
      { name: 'verify_tdd',           language: 'py',       path: 'verify_tdd.py',           command: 'python3 tools/verify_tdd.py',           description: 'Runs changed tests against HEAD (must fail) and staged code (must pass)' },
      { name: 'check_custom',          language: 'python',   path: 'check_custom.py',         command: 'python3 tools/check_custom.py',       description: 'Runs user-defined custom rules from .clc-forge.yml' },
      { name: 'ruff',                 language: 'external', path: '', command: 'python3 -m ruff check .', description: 'Python AST linter', extCLI: 'ruff' },
      { name: 'pytest',               language: 'external', path: '', command: 'pytest',                   description: 'Test runner', extCLI: 'pytest' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = FastApiAdapter;
