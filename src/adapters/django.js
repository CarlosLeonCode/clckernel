/**
 * CLC Kernel — Django Stack Adapter
 * Supports Django apps, pytest-django, Ruff AST, ORM idempotency, and Scope Guard.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class DjangoAdapter extends BaseAdapter {
  constructor() {
    super('Django Framework', 'backend', 'pytest-django / manage.py test');
  }

  detect(targetDir) {
    const hasManagePy = fs.existsSync(path.join(targetDir, 'manage.py'));
    const hasPyproject = fs.existsSync(path.join(targetDir, 'pyproject.toml'));
    const hasRequirements = fs.existsSync(path.join(targetDir, 'requirements.txt'));

    if (hasManagePy) return true;

    if (hasPyproject || hasRequirements) {
      try {
        const pyproject = hasPyproject ? fs.readFileSync(path.join(targetDir, 'pyproject.toml'), 'utf-8') : '';
        const reqs = hasRequirements ? fs.readFileSync(path.join(targetDir, 'requirements.txt'), 'utf-8') : '';
        return pyproject.toLowerCase().includes('django') || reqs.toLowerCase().includes('django');
      } catch (e) {}
    }

    return false;
  }

  getSafeguards() {
    return [
      'Flake8 / Ruff AST Python Code Quality Linter',
      'Clean Architecture AST Guard (Domain -> Application -> Views)',
      'Database Efficiency & N+1 Performance Guard (select_related / prefetch_related)',
      'Django ORM Migration Idempotency & Schema Drift Guard',
      'pytest-django Red-to-Green TDD Validator',
      'Secret & Private Key Leak Scanner',
      'Scope Guardrail (git diff vs SDD affected files)',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory Guard (Engram / Graphify ADR Sync)'
    ];
  }

  /**
   * Returns the tool manifest for Django projects.
   * Includes Python guard scripts and external CLI tools (ruff, manage.py test).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'scan_secrets',         language: 'py',       path: 'scan_secrets.py',         command: 'python3 tools/scan_secrets.py',         description: 'Scans for leaked secrets and API keys' },
      { name: 'check_architecture',   language: 'py',       path: 'check_architecture.py',   command: 'python3 tools/check_architecture.py',   description: 'Validates Django layer boundaries' },
      { name: 'check_db_efficiency',  language: 'py',       path: 'check_db_efficiency.py',  command: 'python3 tools/check_db_efficiency.py',  description: 'Audits database query efficiency and N+1 loop calls' },
      { name: 'check_custom',          language: 'python',   path: 'check_custom.py',         command: 'python3 tools/check_custom.py',       description: 'Runs user-defined custom rules from .clc-forge.yml' },
      { name: 'ruff',                 language: 'external', path: '', command: 'python3 -m ruff check .', description: 'Python AST linter', extCLI: 'ruff' },
      { name: 'manage',               language: 'external', path: '', command: 'python3 manage.py test',  description: 'Django test runner', extCLI: 'manage.py' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = DjangoAdapter;
