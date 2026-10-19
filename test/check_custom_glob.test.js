const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const toolsDir = path.resolve(__dirname, '..', 'tools');
const checkCustomPy = path.join(toolsDir, 'check_custom.py');

/**
 * Evaluates _yaml.glob_to_regex (used by check_custom.py) for each [glob, path] pair in Python
 * and returns the list of booleans (true when the path matches the glob).
 */
function globMatches(pairs) {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(toolsDir)})`,
    'from _yaml import glob_to_regex as _glob_to_regex',
    'pairs = json.loads(sys.stdin.read())',
    'print(json.dumps([bool(_glob_to_regex(g).match(p)) for g, p in pairs]))',
  ].join('\n');
  const res = spawnSync('python3', ['-c', script], { input: JSON.stringify(pairs), encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `python failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function assertGlob(glob, file, expected) {
  const [actual] = globMatches([[glob, file]]);
  assert.strictEqual(actual, expected, `"${glob}" ${expected ? 'should' : 'should not'} match "${file}"`);
}

describe('check_custom.py glob translation', () => {
  it('"**/*.py" matches python files at any depth', () => {
    assertGlob('**/*.py', 'a.py', true);
    assertGlob('**/*.py', 'src/a.py', true);
    assertGlob('**/*.py', 'src/x/a.py', true);
    assertGlob('**/*.py', 'src/a.js', false);
  });

  it('"*" does not cross directory separators', () => {
    assertGlob('src/*.py', 'src/a.py', true);
    assertGlob('src/*.py', 'src/x/a.py', false);
  });

  it('"?" matches exactly one non-separator character', () => {
    assertGlob('a?.py', 'ab.py', true);
    assertGlob('a?.py', 'a/.py', false);
  });

  it('"{a,b}" expands to alternation', () => {
    assertGlob('*.{js,ts}', 'a.ts', true);
    assertGlob('*.{js,ts}', 'a.js', true);
    assertGlob('*.{js,ts}', 'a.py', false);
  });

  it('regex special characters are matched literally', () => {
    assertGlob('file(1).py', 'file(1).py', true);
    assertGlob('file(1).py', 'file1.py', false);
    assertGlob('a.py', 'abpy', false);
  });

  it('"**" alone matches anything, trailing "**" matches nested paths', () => {
    assertGlob('**', 'a.py', true);
    assertGlob('**', 'src/x/a.py', true);
    assertGlob('src/**', 'src/x/a.py', true);
    assertGlob('src/**', 'lib/a.py', false);
  });
});

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

describe('check_custom.py end-to-end', () => {
  it('reports a violation for a staged nested .py file under a "**/*.py" rule', () => {
    const dir = createTmpProject({ 'README.md': '# clean\n' });
    try {
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.email', 'test@test.com');
      git(dir, 'config', 'user.name', 'Test');
      git(dir, 'config', 'commit.gpgsign', 'false');
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'initial');

      fs.writeFileSync(path.join(dir, '.clckernel.yaml'), [
        'rules:',
        '  - name: no-forbidden-call',
        '    pattern: forbidden_call',
        '    message: Do not use forbidden_call',
        '    severity: error',
        '    scope: "**/*.py"',
        '',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'app', 'service.py'), 'def run():\n    forbidden_call()\n');
      git(dir, 'add', 'src/app/service.py');

      const res = spawnSync('python3', [checkCustomPy, dir], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(res.status, 1, `check_custom must fail: ${res.stdout}${res.stderr}`);
      const result = JSON.parse(res.stdout);
      assert.deepStrictEqual(Object.keys(result.data.violations), ['src/app/service.py']);
      assert.strictEqual(result.data.violations['src/app/service.py'][0].rule, 'no-forbidden-call');
    } finally {
      teardown(dir);
    }
  });
});
