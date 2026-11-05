/**
 * sdds/monorepo-library-parts: the JavaScript library adapter (package.json,
 * no framework), used only for monorepo / full-stack parts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('../helpers');
const JavaScriptLibraryAdapter = require('../../src/adapters/javascript-library');
const { adapters } = require('../../src/detector');

function withDir(files, fn) {
  const dir = createTmpProject(files);
  try {
    return fn(dir);
  } finally {
    teardown(dir);
  }
}

describe('JavaScriptLibraryAdapter', () => {
  it('has the library name, project type and the default JS test runner', () => {
    const adapter = new JavaScriptLibraryAdapter();
    assert.deepStrictEqual([adapter.name, adapter.projectType, adapter.testRunner], ['JavaScript Library', 'library', 'Vitest / Jest']);
  });

  it('is not offered as a root stack (not in the detector adapters list)', () => {
    assert.ok(!adapters.some((a) => a instanceof JavaScriptLibraryAdapter));
  });

  it('detect(): true with package.json or an Nx project.json, false without', () => {
    withDir({ 'package.json': '{}' }, (dir) => assert.strictEqual(new JavaScriptLibraryAdapter().detect(dir), true));
    withDir({ 'project.json': '{}' }, (dir) => assert.strictEqual(new JavaScriptLibraryAdapter().detect(dir), true));
    withDir({ 'index.js': '' }, (dir) => assert.strictEqual(new JavaScriptLibraryAdapter().detect(dir), false));
  });

  it('forDir(): a new instance with the package test runner', () => {
    const shared = new JavaScriptLibraryAdapter();
    withDir({ 'package.json': JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }) }, (dir) => {
      const own = shared.forDir(dir);
      assert.ok(own instanceof JavaScriptLibraryAdapter);
      assert.strictEqual(own.testRunner, 'Vitest');
      assert.strictEqual(shared.testRunner, 'Vitest / Jest');
    });
  });

  it('getTools(): the stack-agnostic JS guards, no external tool (no typecheck without tsconfig.json)', () => {
    const tools = new JavaScriptLibraryAdapter().getTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ['check_custom', 'scan_secrets', 'verify_tdd']);
    assert.ok(tools.every((t) => t.language === 'js'));
  });
});
