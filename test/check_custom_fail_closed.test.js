/**
 * check_custom (JS and Python) must fail closed: a config it cannot parse, a
 * rule with an invalid shape or a pattern that is not a valid regex makes the
 * guard FAIL instead of silently skipping the rules. No config is still a pass.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const toolsDir = path.resolve(__dirname, '..', 'tools');

const RUNNERS = {
  js: (dir) => spawnSync(process.execPath, [path.join(toolsDir, 'check_custom.js'), dir], { cwd: dir, encoding: 'utf-8' }),
  py: (dir) => spawnSync('python3', [path.join(toolsDir, 'check_custom.py'), dir], { cwd: dir, encoding: 'utf-8' }),
};

/** Normalize the JS (exitCode) and Python (exit_code) result shapes. */
function run(lang, dir) {
  const res = RUNNERS[lang](dir);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    assert.fail(`${lang} check_custom printed no JSON (status ${res.status}): ${res.stdout}\n${res.stderr}`);
  }
  const exitCode = parsed.exitCode !== undefined ? parsed.exitCode : parsed.exit_code;
  return { status: res.status, exitCode, skipped: parsed.skipped, message: parsed.data.message };
}

/** Temp git repo with one commit and one staged change in src/app.js. */
function makeRepo(files) {
  const dir = createTmpProject({ 'src/app.js': 'module.exports = 1;\n', ...files });
  const git = (...args) => spawnSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 2;\n');
  git('add', 'src/app.js');
  return dir;
}

const MALFORMED = "rules:\n  - name: r\n    pattern: 'abc\n    message: m\n";
const INVALID_REGEX = "rules:\n  - name: bad-regex\n    pattern: '(unclosed'\n    message: m\n";
const MISSING_MESSAGE = "rules:\n  - name: no-message\n    pattern: 'abc'\n";
const VALID_NO_MATCH = "rules:\n  - name: no-debugger\n    pattern: 'debugger'\n    message: m\n";

for (const lang of Object.keys(RUNNERS)) {
  describe(`check_custom.${lang} fails closed`, () => {
    it('a malformed config fails the guard and names the config file', () => {
      const dir = makeRepo({ '.clckernel.yml': MALFORMED });
      try {
        const r = run(lang, dir);
        assert.strictEqual(r.exitCode, 1, r.message);
        assert.strictEqual(r.status, 1);
        assert.strictEqual(r.skipped, false);
        assert.match(r.message, /\.clckernel\.yml/);
      } finally {
        teardown(dir);
      }
    });

    it('an invalid regex in a rule fails the guard', () => {
      const dir = makeRepo({ '.clckernel.yml': INVALID_REGEX });
      try {
        const r = run(lang, dir);
        assert.strictEqual(r.exitCode, 1, r.message);
        assert.strictEqual(r.skipped, false);
        assert.match(r.message, /bad-regex/);
      } finally {
        teardown(dir);
      }
    });

    it('a rule missing a required field fails the guard', () => {
      const dir = makeRepo({ '.clckernel.yml': MISSING_MESSAGE });
      try {
        const r = run(lang, dir);
        assert.strictEqual(r.exitCode, 1, r.message);
        assert.strictEqual(r.skipped, false);
        assert.match(r.message, /message/);
      } finally {
        teardown(dir);
      }
    });

    it('no config file is still a pass', () => {
      const dir = makeRepo({});
      try {
        const r = run(lang, dir);
        assert.strictEqual(r.exitCode, 0, r.message);
        assert.strictEqual(r.status, 0);
      } finally {
        teardown(dir);
      }
    });

    it('a valid config without violations passes', () => {
      const dir = makeRepo({ '.clckernel.yml': VALID_NO_MATCH });
      try {
        const r = run(lang, dir);
        assert.strictEqual(r.exitCode, 0, r.message);
        assert.strictEqual(r.skipped, false);
      } finally {
        teardown(dir);
      }
    });
  });
}
