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

describe('IDE mirror files are not destroyed by symlinking', () => {
  const MIRRORS = [
    'CLAUDE.md',
    'GEMINI.md',
    '.cursorrules',
    '.github/copilot-instructions.md',
  ];

  for (const mirror of MIRRORS) {
    it(`leaves a consumer-owned ${mirror} untouched`, () => {
      const own = '# Mis reglas propias\n- No toques X\n';
      const dir = createTmpProject({ [mirror]: own });
      try {
        generateHarness(dir, { projectType: 'backend' });

        const target = path.join(dir, mirror);
        assert.ok(fs.existsSync(target), `${mirror} must still exist`);
        assert.ok(
          !fs.lstatSync(target).isSymbolicLink(),
          `${mirror} must not be replaced by a symlink`
        );
        assert.strictEqual(
          fs.readFileSync(target, 'utf-8'),
          own,
          `${mirror} content must survive provisioning byte-identical`
        );
      } finally {
        teardown(dir);
      }
    });
  }

  it('still links mirrors that do not already exist', () => {
    const dir = createTmpProject({});
    try {
      generateHarness(dir, { projectType: 'backend' });

      for (const mirror of MIRRORS) {
        const target = path.join(dir, mirror);
        assert.ok(fs.existsSync(target), `${mirror} should be created`);
        assert.ok(
          fs.lstatSync(target).isSymbolicLink(),
          `${mirror} should be a symlink to AGENTS.md`
        );
      }
    } finally {
      teardown(dir);
    }
  });

  it('replaces a mirror that is already a symlink (stale link refresh)', () => {
    const dir = createTmpProject({ 'AGENTS.md': '# Ley\n' });
    try {
      fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
      generateHarness(dir, { projectType: 'backend' });

      const target = path.join(dir, 'CLAUDE.md');
      assert.ok(fs.lstatSync(target).isSymbolicLink(), 'should remain a symlink');
      assert.strictEqual(
        fs.readFileSync(target, 'utf-8'),
        '# Ley\n',
        'an existing symlink must keep resolving to AGENTS.md'
      );
    } finally {
      teardown(dir);
    }
  });

  it('does not delete a regular file to make room for the symlink', () => {
    const dir = createTmpProject({
      'AGENTS.md': '# Ley\n',
      'CLAUDE.md': 'contenido del consumidor\n',
    });
    try {
      generateHarness(dir, { projectType: 'backend' });
      assert.strictEqual(
        fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8'),
        'contenido del consumidor\n',
        'a regular file must never be unlinked'
      );
    } finally {
      teardown(dir);
    }
  });
});

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
