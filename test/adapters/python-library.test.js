/**
 * sdds/monorepo-library-parts: the Python library adapter (pyproject.toml /
 * setup.py / setup.cfg, no framework), used only for monorepo parts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('../helpers');
const PythonLibraryAdapter = require('../../src/adapters/python-library');
const FastApiAdapter = require('../../src/adapters/fastapi');
const { adapters } = require('../../src/detector');

function withDir(files, fn) {
  const dir = createTmpProject(files);
  try {
    return fn(dir);
  } finally {
    teardown(dir);
  }
}

describe('PythonLibraryAdapter', () => {
  it('has the library name, project type and Pytest', () => {
    const adapter = new PythonLibraryAdapter();
    assert.deepStrictEqual([adapter.name, adapter.projectType, adapter.testRunner], ['Python Library', 'library', 'Pytest']);
  });

  it('is not offered as a root stack (not in the detector adapters list)', () => {
    assert.ok(!adapters.some((a) => a instanceof PythonLibraryAdapter));
  });

  it('detect(): pyproject.toml, setup.py or setup.cfg; not requirements.txt alone', () => {
    for (const file of ['pyproject.toml', 'setup.py', 'setup.cfg']) {
      withDir({ [file]: '' }, (dir) => assert.strictEqual(new PythonLibraryAdapter().detect(dir), true, file));
    }
    withDir({ 'requirements.txt': 'requests\n' }, (dir) => assert.strictEqual(new PythonLibraryAdapter().detect(dir), false));
  });

  it('getTools(): Python guards plus ruff and pytest exactly as the FastAPI adapter runs them', () => {
    const tools = new PythonLibraryAdapter().getTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ['check_custom', 'pytest', 'ruff', 'scan_secrets', 'verify_tdd']);
    const fastapi = new FastApiAdapter().getTools();
    for (const name of ['ruff', 'pytest', 'scan_secrets', 'verify_tdd', 'check_custom']) {
      assert.deepStrictEqual(tools.find((t) => t.name === name), fastapi.find((t) => t.name === name), name);
    }
  });
});
