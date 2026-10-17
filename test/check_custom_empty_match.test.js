/**
 * check_custom (JS and Python) must terminate on rule patterns that can match
 * the empty string (`x*`, `^`) and both twins must report the same violations.
 *
 * Semantics: an empty match is a match. It is reported like any other one,
 * following Python's re.finditer (3.7+): one match per code point position,
 * and an empty match is allowed right after a non-empty one.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const toolsDir = path.resolve(__dirname, '..', 'tools');
const TIMEOUT_MS = 10000;

const RUNNERS = {
  js: (dir) => spawnSync(process.execPath, [path.join(toolsDir, 'check_custom.js'), dir], { cwd: dir, encoding: 'utf-8', timeout: TIMEOUT_MS }),
  py: (dir) => spawnSync('python3', [path.join(toolsDir, 'check_custom.py'), dir], { cwd: dir, encoding: 'utf-8', timeout: TIMEOUT_MS }),
};

/** Run one twin; fails the test when it hangs or prints no JSON. */
function run(lang, dir) {
  const res = RUNNERS[lang](dir);
  assert.ok(!res.error, `${lang} check_custom did not terminate within ${TIMEOUT_MS}ms: ${res.error && res.error.message}`);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    assert.fail(`${lang} check_custom printed no JSON (status ${res.status}): ${res.stdout}\n${res.stderr}`);
  }
  const exitCode = parsed.exitCode !== undefined ? parsed.exitCode : parsed.exit_code;
  return { status: res.status, exitCode, violations: parsed.data.violations };
}

/** Temp git repo with a staged change in src/app.js and the given rule. */
function makeRepo(pattern, content) {
  const config = `rules:\n  - name: empty-match\n    pattern: '${pattern}'\n    message: m\n    scope: "**/*.js"\n`;
  const dir = createTmpProject({ 'src/app.js': 'module.exports = 1;\n', '.clckernel.yaml': config });
  const git = (...args) => spawnSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), content);
  git('add', 'src/app.js');
  return dir;
}

const CASES = [
  { pattern: 'x*', content: 'module.exports = 2;\n' },
  { pattern: '^', content: 'a\nb\n' },
  // An astral code point is one position for both twins (no match between surrogates).
  { pattern: 'x*', content: 'const s = "\u{1F600}x";\n' },
];

describe('check_custom terminates on patterns that match the empty string', () => {
  for (const { pattern, content } of CASES) {
    it(`pattern ${JSON.stringify(pattern)} on ${JSON.stringify(content)}: both twins finish and agree`, () => {
      const dir = makeRepo(pattern, content);
      try {
        const js = run('js', dir);
        const py = run('py', dir);
        assert.strictEqual(js.exitCode, 1);
        assert.strictEqual(py.exitCode, 1);
        assert.ok((js.violations['src/app.js'] || []).length > 0, 'empty matches are reported as violations');
        assert.deepStrictEqual(js.violations, py.violations);
      } finally {
        teardown(dir);
      }
    });
  }
});
