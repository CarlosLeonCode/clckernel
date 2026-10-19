/**
 * sdds/final-sweep item 2: check_scope.py reads the paths an SDD declares in
 * bullets and table cells, including paths that start with a dot
 * (.agents/..., .clckernel.yaml, .github/workflows/ci.yml), without turning
 * plain sentences into paths and without truncating table cells.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const TOOLS = path.join(__dirname, '..', 'tools');

function declared(spec) {
  const dir = createTmpProject({ 'sdds/change/01-spec.md': spec });
  try {
    const code = [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
      'import check_scope',
      'print(json.dumps(check_scope._find_sdd_declared_files(sys.argv[1])))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', code, dir], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    return JSON.parse(res.stdout) || [];
  } finally {
    teardown(dir);
  }
}

describe('check_scope — declared paths', () => {
  it('reads dot-paths in bullets, bare or in backticks', () => {
    const got = declared([
      '- .agents/skills/clckernel_cli/SKILL.md',
      '- `.clckernel.yaml`: new key',
      '* .github/workflows/ci.yml — CI',
      '- `.gitignore`',
      '- `.githooks/pre-commit`',
      '',
    ].join('\n'));
    assert.deepStrictEqual(got, [
      '.agents/skills/clckernel_cli/SKILL.md',
      '.clckernel.yaml',
      '.github/workflows/ci.yml',
      '.gitignore',
      '.githooks/pre-commit',
    ]);
  });

  it('reads whole table cells, dot-paths included, without truncating them', () => {
    const got = declared([
      '| File | Change |',
      '|---|---|',
      '| src/foo.js | edit |',
      '| `.clckernel.yaml` | add |',
      '| .github/workflows/ci.yml | add |',
      '',
    ].join('\n'));
    assert.deepStrictEqual(got, ['src/foo.js', '.clckernel.yaml', '.github/workflows/ci.yml']);
  });

  it('keeps reading ordinary paths in bullets', () => {
    assert.deepStrictEqual(declared('- src/a.js\n- `tools/check_scope.py`\n- README.md.\n'), [
      'src/a.js',
      'tools/check_scope.py',
      'README.md',
    ]);
  });

  it('does not turn plain sentences into paths', () => {
    const got = declared([
      '- .NET support is out of scope',
      '- Update the docs.',
      '- e.g. something else',
      '- ...and more',
      '| Note | the .gitignore stays |',
      '',
    ].join('\n'));
    assert.deepStrictEqual(got, []);
  });
});
