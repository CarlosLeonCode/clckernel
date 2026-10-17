/**
 * CLC Kernel — FastAPI Stack Adapter
 * Supports FastAPI apps, pytest, Alembic migration reversibility, and Python AST layer checks.
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
      'Ruff Python Linter (external CLI)',
      'Clean Architecture Guard (Python AST: Domain -> Application -> Routes)',
      'N+1 Heuristic (ORM-like calls inside loops, Python AST)',
      'Alembic Migration Reversibility Guard (upgrade/downgrade, destructive operations)',
      'Red→Green TDD Verifier (runs changed tests with pytest)',
      'Secret & Private Key Leak Scanner',
      'Scope protocol (agent-enforced; not checked by a guard)',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
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
      { name: 'check_db_efficiency',  language: 'py',       path: 'check_db_efficiency.py',  command: 'python3 tools/check_db_efficiency.py',  description: 'Flags ORM-like calls inside loops (N+1 heuristic)' },
      { name: 'check_migrations',     language: 'py',       path: 'check_migrations.py',     command: 'python3 tools/check_migrations.py',     description: 'Checks Alembic migration reversibility (upgrade/downgrade, destructive operations)' },
      { name: 'verify_tdd',           language: 'py',       path: 'verify_tdd.py',           command: 'python3 tools/verify_tdd.py',           description: 'Runs changed tests against HEAD (must fail) and staged code (must pass)' },
      { name: 'check_custom',          language: 'python',   path: 'check_custom.py',         command: 'python3 tools/check_custom.py',       description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'ruff',                 language: 'external', path: '', command: 'python3 -m ruff check .', description: 'Python linter', extCLI: 'ruff' },
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
