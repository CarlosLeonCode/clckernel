/**
 * sdds/monorepo-ts-library-parts: the TypeScript library adapter, used only
 * for monorepo / full-stack parts (never for the repository root).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('../helpers');
const TypeScriptLibraryAdapter = require('../../src/adapters/typescript-library');
const { adapters } = require('../../src/detector');

const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true } });

function withDir(files, fn) {
  const dir = createTmpProject(files);
  try {
    return fn(dir);
  } finally {
    teardown(dir);
  }
}

describe('TypeScriptLibraryAdapter', () => {
  it('has the library name, project type and the default JS test runner', () => {
    const adapter = new TypeScriptLibraryAdapter();
    assert.strictEqual(adapter.name, 'TypeScript Library');
    assert.strictEqual(adapter.projectType, 'library');
    assert.strictEqual(adapter.testRunner, 'Vitest / Jest');
  });

  it('is not offered as a root stack (not in the detector adapters list)', () => {
    assert.ok(!adapters.some((a) => a instanceof TypeScriptLibraryAdapter));
  });

  describe('detect()', () => {
    it('true with package.json and tsconfig.json', () => {
      withDir({ 'package.json': JSON.stringify({ name: 'lib' }), 'tsconfig.json': TSCONFIG }, (dir) => {
        assert.strictEqual(new TypeScriptLibraryAdapter().detect(dir), true);
      });
    });

    it('true with project.json (Nx, no package.json) and tsconfig.json', () => {
      withDir({ 'project.json': JSON.stringify({ name: 'lib' }), 'tsconfig.json': TSCONFIG }, (dir) => {
        assert.strictEqual(new TypeScriptLibraryAdapter().detect(dir), true);
        assert.strictEqual(new TypeScriptLibraryAdapter().forDir(dir).testRunner, 'Vitest / Jest');
      });
    });

    it('false without tsconfig.json', () => {
      withDir({ 'package.json': JSON.stringify({ name: 'lib' }) }, (dir) => {
        assert.strictEqual(new TypeScriptLibraryAdapter().detect(dir), false);
      });
    });

    it('false without package.json', () => {
      withDir({ 'tsconfig.json': TSCONFIG }, (dir) => {
        assert.strictEqual(new TypeScriptLibraryAdapter().detect(dir), false);
      });
    });
  });

  describe('forDir()', () => {
    const runner = (devDependencies) => withDir({
      'package.json': JSON.stringify({ name: 'lib', devDependencies }), 'tsconfig.json': TSCONFIG,
    }, (dir) => new TypeScriptLibraryAdapter().forDir(dir).testRunner);

    it('reports the test runner of the package', () => {
      assert.strictEqual(runner({ vitest: '^2.0.0' }), 'Vitest');
      assert.strictEqual(runner({ jest: '^29.0.0' }), 'Jest');
      assert.strictEqual(runner({ vitest: '^2.0.0', jest: '^29.0.0' }), 'Vitest / Jest');
      assert.strictEqual(runner({}), 'Vitest / Jest');
    });

    it('returns a new library adapter, leaving the shared one untouched', () => {
      const shared = new TypeScriptLibraryAdapter();
      withDir({ 'package.json': JSON.stringify({ devDependencies: { jest: '1' } }), 'tsconfig.json': TSCONFIG }, (dir) => {
        const own = shared.forDir(dir);
        assert.ok(own instanceof TypeScriptLibraryAdapter);
        assert.notStrictEqual(own, shared);
        assert.strictEqual(shared.testRunner, 'Vitest / Jest');
      });
    });
  });

  describe('getTools()', () => {
    const tools = new TypeScriptLibraryAdapter().getTools();

    it('runs tsc --noEmit as an external tool with the node_modules/.bin availability check', () => {
      const tsc = tools.find((t) => t.name === 'tsc');
      assert.deepStrictEqual(
        { language: tsc.language, command: tsc.command, availableIf: tsc.availableIf },
        { language: 'external', command: 'npx tsc --noEmit', availableIf: '[ -x node_modules/.bin/tsc ]' },
      );
    });

    it('carries the stack-agnostic JS guards and no UI / Next.js guards', () => {
      const names = tools.map((t) => t.name).sort();
      assert.deepStrictEqual(names, ['check_custom', 'scan_secrets', 'tsc', 'verify_tdd']);
    });
  });
});
