const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');
const { generateHarness } = require('../src/generator');

function makeAdapter() {
  return {
    name: 'TestStack',
    projectType: 'backend',
    getSafeguards: () => [],
    provision() {},
    getTools: () => [
      { name: 'check_custom', language: 'js', path: 'check_custom.js', command: 'node tools/check_custom.js' },
    ],
  };
}

describe('the YAML parser is not written into the consumer src/', () => {
  it('never creates src/yaml.js in the target project', () => {
    const dir = createTmpProject({ 'tools/.gitkeep': '' });
    try {
      generateHarness(dir, { adapter: makeAdapter(), projectType: 'backend' });

      assert.ok(
        !fs.existsSync(path.join(dir, 'src', 'yaml.js')),
        'the generator must not write into the consumer src/ directory'
      );
    } finally {
      teardown(dir);
    }
  });

  it('does not overwrite a consumer file that happens to be named src/yaml.js', () => {
    const consumerYaml = 'module.exports = { MI_PROPIA_FUN: () => 42 }\n';
    const dir = createTmpProject({
      'tools/.gitkeep': '',
      'src/yaml.js': consumerYaml,
    });
    try {
      generateHarness(dir, { adapter: makeAdapter(), projectType: 'backend' });

      assert.strictEqual(
        fs.readFileSync(path.join(dir, 'src', 'yaml.js'), 'utf-8'),
        consumerYaml,
        'a consumer-owned src/yaml.js must survive provisioning byte-identical'
      );
    } finally {
      teardown(dir);
    }
  });

  it('leaves an existing consumer src/ directory otherwise untouched', () => {
    const dir = createTmpProject({
      'tools/.gitkeep': '',
      'src/app.tsx': 'export default function App() {}\n',
      'src/utils.ts': 'export const x = 1\n',
    });
    try {
      generateHarness(dir, { adapter: makeAdapter(), projectType: 'backend' });

      assert.deepStrictEqual(
        fs.readdirSync(path.join(dir, 'src')).sort(),
        ['app.tsx', 'utils.ts'],
        'the consumer src/ must gain no files'
      );
    } finally {
      teardown(dir);
    }
  });

  it('ships the parser inside tools/ where the harness owns the directory', () => {
    const dir = createTmpProject({ 'tools/.gitkeep': '' });
    try {
      generateHarness(dir, { adapter: makeAdapter(), projectType: 'backend' });

      assert.ok(
        fs.existsSync(path.join(dir, 'tools', 'yaml.js')),
        'the parser must live in tools/, the directory the harness provisions'
      );
    } finally {
      teardown(dir);
    }
  });

  it('the shipped check_custom.js resolves the parser from tools/', () => {
    const dir = createTmpProject({ 'tools/.gitkeep': '' });
    try {
      generateHarness(dir, { adapter: makeAdapter(), projectType: 'backend' });

      const checkCustom = fs.readFileSync(path.join(dir, 'tools', 'check_custom.js'), 'utf-8');
      assert.ok(
        !checkCustom.includes("../src/yaml.js"),
        'check_custom.js must not depend on the consumer src/ directory'
      );

      // The require must actually resolve at runtime.
      const resolved = require.resolve(
        path.join(dir, 'tools', 'yaml.js')
      );
      assert.ok(fs.existsSync(resolved), 'the required parser must exist');

      const parser = require(resolved);
      assert.strictEqual(typeof parser.parseYaml, 'function', 'parseYaml must be exported');
      assert.strictEqual(typeof parser.globToRegex, 'function', 'globToRegex must be exported');
    } finally {
      teardown(dir);
    }
  });
});

describe('tools/ is created before its contents are copied', () => {
  it('provisions a project that has no tools/ directory yet', () => {
    const dir = createTmpProject({ 'package.json': '{}\n' });
    try {
      // No tools/ and no docs/ or sdds/: the manifest installer must not throw.
      assert.doesNotThrow(() => {
        generateHarness(dir, { adapter: makeAdapter(), projectType: 'backend' });
      }, 'installing tools into a project without tools/ must not throw');

      assert.ok(
        fs.existsSync(path.join(dir, 'tools', 'check_custom.js')),
        'the guard tools must still land in the project'
      );
    } finally {
      teardown(dir);
    }
  });
});
