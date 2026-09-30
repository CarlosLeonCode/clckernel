const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('../helpers');

describe('BaseAdapter', () => {
  const BaseAdapter = require('../../src/adapters/base');

  describe('constructor', () => {
    it('stores name, projectType, and testRunner', () => {
      const adapter = new BaseAdapter('Test', 'frontend', 'Jest');
      assert.strictEqual(adapter.name, 'Test');
      assert.strictEqual(adapter.projectType, 'frontend');
      assert.strictEqual(adapter.testRunner, 'Jest');
    });
  });

  describe('detect()', () => {
    it('returns false by default', () => {
      const adapter = new BaseAdapter('Test', 'frontend', 'Jest');
      assert.strictEqual(adapter.detect('/tmp'), false);
    });
  });

  describe('getSafeguards()', () => {
    it('returns empty array by default', () => {
      const adapter = new BaseAdapter('Test', 'frontend', 'Jest');
      assert.deepStrictEqual(adapter.getSafeguards(), []);
    });
  });

  describe('getTools()', () => {
    it('returns empty array by default', () => {
      const adapter = new BaseAdapter('Test', 'frontend', 'Jest');
      assert.deepStrictEqual(adapter.getTools(), []);
    });
  });

  describe('provision()', () => {
    it('creates docs/, sdds/, tools/ directories', () => {
      const adapter = new BaseAdapter('Test', 'frontend', 'Jest');
      const dir = createTmpProject({});
      try {
        adapter.provision(dir, {});

        assert.ok(require('fs').existsSync(require('path').join(dir, 'docs', 'Journal')));
        assert.ok(require('fs').existsSync(require('path').join(dir, 'docs', 'Architecture')));
        assert.ok(require('fs').existsSync(require('path').join(dir, 'docs', 'Development')));
        assert.ok(require('fs').existsSync(require('path').join(dir, 'sdds')));
        assert.ok(require('fs').existsSync(require('path').join(dir, 'tools')));
      } finally {
        teardown(dir);
      }
    });

    it('writes .gitignore with sdds/* entry', () => {
      const adapter = new BaseAdapter('Test', 'frontend', 'Jest');
      const dir = createTmpProject({});
      try {
        adapter.provision(dir, {});

        const gitignore = require('fs').readFileSync(
          require('path').join(dir, '.gitignore'), 'utf-8'
        );
        assert.ok(gitignore.includes('sdds/*'));
      } finally {
        teardown(dir);
      }
    });

    it('writes AGENTS.md with adapter name and safeguards', () => {
      const adapter = new BaseAdapter('TestStack', 'backend', 'Pytest');
      const dir = createTmpProject({});
      try {
        adapter.provision(dir, {});

        const agents = require('fs').readFileSync(
          require('path').join(dir, 'AGENTS.md'), 'utf-8'
        );
        assert.ok(agents.includes('TestStack'));
        assert.ok(agents.includes('BACKEND'));
      } finally {
        teardown(dir);
      }
    });
  });

  describe('provision() AGENTS.md preservation', () => {
    it('never overwrites an existing project-customized AGENTS.md', () => {
      const custom = '# Mi Ley Propia\n- Regla propia del proyecto\n';
      const adapter = new BaseAdapter('TestStack', 'backend', 'Pytest');
      const dir = createTmpProject({ 'AGENTS.md': custom });
      try {
        adapter.provision(dir, {});
        const after = require('fs').readFileSync(
          require('path').join(dir, 'AGENTS.md'), 'utf-8'
        );
        assert.strictEqual(after, custom, 'AGENTS.md must be byte-identical');
        assert.ok(!after.includes('TestStack'), 'adapter template must not be injected');
      } finally {
        teardown(dir);
      }
    });
  });
});
