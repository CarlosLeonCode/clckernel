const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('../helpers');

describe('LaravelAdapter', () => {
  const LaravelAdapter = require('../../src/adapters/laravel');

  describe('constructor', () => {
    it('creates adapter with correct name and projectType', () => {
      const adapter = new LaravelAdapter();
      assert.strictEqual(adapter.name, 'PHP / Laravel');
      assert.strictEqual(adapter.projectType, 'backend');
      assert.strictEqual(adapter.testRunner, 'Pest / PHPUnit');
    });
  });

  describe('detect()', () => {
    it('returns true when both composer.json and artisan exist', () => {
      const dir = createTmpProject({
        'composer.json': JSON.stringify({ require: { 'laravel/framework': '^10.0' } }),
        'artisan': '#!/usr/bin/env php',
      });
      try {
        const adapter = new LaravelAdapter();
        assert.strictEqual(adapter.detect(dir), true);
      } finally {
        teardown(dir);
      }
    });

    it('returns false when only composer.json exists', () => {
      const dir = createTmpProject({
        'composer.json': JSON.stringify({ require: {} }),
      });
      try {
        const adapter = new LaravelAdapter();
        assert.strictEqual(adapter.detect(dir), false);
      } finally {
        teardown(dir);
      }
    });

    it('returns false when only artisan exists', () => {
      const dir = createTmpProject({ 'artisan': '#!/usr/bin/env php' });
      try {
        const adapter = new LaravelAdapter();
        assert.strictEqual(adapter.detect(dir), false);
      } finally {
        teardown(dir);
      }
    });

    it('returns false when directory is empty', () => {
      const dir = createTmpProject({});
      try {
        const adapter = new LaravelAdapter();
        assert.strictEqual(adapter.detect(dir), false);
      } finally {
        teardown(dir);
      }
    });
  });

  describe('getTools()', () => {
    it('returns array of tool objects with required fields', () => {
      const adapter = new LaravelAdapter();
      const tools = adapter.getTools();
      assert.ok(Array.isArray(tools));
      assert.ok(tools.length > 0);
      for (const tool of tools) {
        assert.ok(tool.name);
        assert.ok(tool.language);
        assert.ok(typeof tool.command === 'string');
        assert.ok(tool.description);
      }
    });

    it('all external tools have language=external and empty path', () => {
      const adapter = new LaravelAdapter();
      const tools = adapter.getTools();
      const externalTools = tools.filter((t) => t.language === 'external');
      for (const tool of externalTools) {
        assert.strictEqual(tool.language, 'external');
        assert.strictEqual(tool.path, '');
      }
    });

    it('includes custom rules guard', () => {
      const adapter = new LaravelAdapter();
      const tools = adapter.getTools();
      const customTool = tools.find((t) => t.name === 'check_custom');
      assert.ok(customTool, 'check_custom tool should exist');
      // Node is guaranteed (npx); Laravel projects must not need Python.
      assert.strictEqual(customTool.language, 'js');
      assert.strictEqual(customTool.path, 'check_custom.js');
    });
  });

  describe('getSafeguards()', () => {
    it('returns non-empty array of strings', () => {
      const adapter = new LaravelAdapter();
      const guards = adapter.getSafeguards();
      assert.ok(Array.isArray(guards));
      assert.ok(guards.length >= 5);
    });
  });
});
