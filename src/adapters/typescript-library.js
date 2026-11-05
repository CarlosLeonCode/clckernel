/**
 * CLC Kernel — TypeScript Library Adapter
 * A plain TypeScript package (package.json or an Nx project.json, plus
 * tsconfig.json, no framework) inside
 * a monorepo or full-stack repository: its typecheck runs in the hook.
 *
 * Used only for parts in subdirectories (sdds/monorepo-ts-library-parts,
 * sdds/monorepo-library-parts): it is not in the detector's `adapters` list, so
 * the repository root is never detected as a library and "Choose another stack"
 * never offers it. It is tried only on a dir no framework adapter matched, before
 * the JavaScript library adapter (same `node` ecosystem).
 */

const fs = require('fs');
const path = require('path');
const JavaScriptLibraryAdapter = require('./javascript-library');

class TypeScriptLibraryAdapter extends JavaScriptLibraryAdapter {
  constructor(testRunner = JavaScriptLibraryAdapter.DEFAULT_TEST_RUNNER) {
    super(testRunner, 'TypeScript Library');
  }

  detect(targetDir) {
    return super.detect(targetDir) && fs.existsSync(path.join(targetDir, 'tsconfig.json'));
  }

  getSafeguards() {
    return ['TypeScript Typecheck (tsc --noEmit inside the package)', ...super.getSafeguards()];
  }

  /**
   * The JS guards and the package's typecheck, run inside the part dir by the
   * hook (its own node_modules/.bin/tsc, else the hoisted root one).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    return [
      ...super.getTools(),
      { name: 'tsc', language: 'external', path: '', command: 'npx tsc --noEmit', description: 'TypeScript type checking', extCLI: 'tsc', availableIf: '[ -x node_modules/.bin/tsc ]' },
    ];
  }
}

module.exports = TypeScriptLibraryAdapter;
