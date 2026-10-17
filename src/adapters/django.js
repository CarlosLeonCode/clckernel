/**
 * CLC Kernel — Django Stack Adapter
 * Supports Django apps, pytest-django, Ruff, and Python AST layer checks.
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
      'Ruff Python Linter (external CLI)',
      'Clean Architecture Guard (Python AST: Domain -> Application -> Views)',
      'N+1 Heuristic (ORM-like calls inside loops, Python AST)',
      'Django Migration Reversibility protocol (agent-enforced; no migration guard installed for this stack)',
      'Red→Green TDD Verifier (runs changed tests with pytest)',
      'Secret & Private Key Leak Scanner',
      'Scope protocol (agent-enforced; not checked by a guard)',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
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
      { name: 'check_db_efficiency',  language: 'py',       path: 'check_db_efficiency.py',  command: 'python3 tools/check_db_efficiency.py',  description: 'Flags ORM-like calls inside loops (N+1 heuristic)' },
      { name: 'verify_tdd',           language: 'py',       path: 'verify_tdd.py',           command: 'python3 tools/verify_tdd.py',           description: 'Runs changed tests against HEAD (must fail) and staged code (must pass)' },
      { name: 'check_custom',          language: 'python',   path: 'check_custom.py',         command: 'python3 tools/check_custom.py',       description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'ruff',                 language: 'external', path: '', command: 'python3 -m ruff check .', description: 'Python linter', extCLI: 'ruff', availableIf: 'python3 -m ruff --version', excludeManaged: { flag: '--extend-exclude', extensions: ['.py'] } },
      { name: 'manage',               language: 'external', path: '', command: 'python3 manage.py test',  description: 'Django test runner', extCLI: 'manage.py', availableIf: '[ -f manage.py ]' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = DjangoAdapter;
