/**
 * CLC Kernel — Python Library Adapter
 * A plain Python package (pyproject.toml, setup.py or setup.cfg, no framework)
 * inside a monorepo or full-stack repository: Python guards, ruff and pytest.
 *
 * Used only for parts in subdirectories (sdds/monorepo-library-parts): never the
 * repository root, never offered in "Choose another stack", tried only on a dir
 * no framework adapter (FastAPI, Django) matched.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

const MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg'];

class PythonLibraryAdapter extends BaseAdapter {
  constructor() {
    super('Python Library', 'library', 'Pytest');
  }

  detect(targetDir) {
    return MANIFESTS.some((file) => fs.existsSync(path.join(targetDir, file)));
  }

  getSafeguards() {
    return [
      'Ruff Python Linter (external CLI)',
      'Red→Green TDD Verifier (runs changed tests with pytest)',
      'Secret & Private Key Leak Scanner',
      'Educational Audit Gate (05-audit-report.md)',
    ];
  }

  /**
   * Python guards plus ruff and pytest, declared as the FastAPI adapter does.
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    return [
      { name: 'scan_secrets', language: 'py',       path: 'scan_secrets.py', command: 'python3 tools/scan_secrets.py', description: 'Scans for leaked secrets and API keys' },
      { name: 'verify_tdd',   language: 'py',       path: 'verify_tdd.py',   command: 'python3 tools/verify_tdd.py',   description: 'Runs changed tests against HEAD (must fail) and staged code (must pass)' },
      { name: 'check_custom', language: 'python',   path: 'check_custom.py', command: 'python3 tools/check_custom.py', description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'ruff',         language: 'external', path: '', command: 'python3 -m ruff check .', description: 'Python linter', extCLI: 'ruff', availableIf: 'python3 -m ruff --version', excludeManaged: { flag: '--extend-exclude', extensions: ['.py'] } },
      // pytest exits 5 when it collects no tests (a fresh package): that is not a failure.
      { name: 'pytest',       language: 'external', path: '', command: 'python3 -m pytest || [ $? -eq 5 ]', description: 'Test runner', extCLI: 'pytest', availableIf: 'python3 -m pytest --version' },
    ];
  }
}

module.exports = PythonLibraryAdapter;
