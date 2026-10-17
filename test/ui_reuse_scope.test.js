const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const checkUiReuse = require('../tools/check_ui_reuse');

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

function createRepo() {
  const dir = createTmpProject({ 'README.md': '# clean\n' });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

function stage(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
  git(dir, 'add', rel);
}

// Guard sources mention raw elements as pattern strings, not as rendered UI.
const GUARD_SOURCE = "const hasRawButton = /<button\\b/i.test(content); // '<select' '<input'\n";
const RAW_BUTTON_COMPONENT = 'export const Save = () => <button onClick={save}>Save</button>;\n';

describe('check_ui_reuse only audits project UI code', () => {
  it('ignores harness-owned guard sources under tools/', async () => {
    const dir = createRepo();
    try {
      stage(dir, 'tools/check_a11y.js', GUARD_SOURCE);
      const result = await checkUiReuse(dir);
      assert.strictEqual(result.exitCode, 0, JSON.stringify(result.data));
      assert.deepStrictEqual(result.data.violations, {});
    } finally {
      teardown(dir);
    }
  });

  it('still flags a raw <button> in a project component', async () => {
    const dir = createRepo();
    try {
      stage(dir, 'tools/check_a11y.js', GUARD_SOURCE);
      stage(dir, 'src/Save.jsx', RAW_BUTTON_COMPONENT);
      const result = await checkUiReuse(dir);
      assert.strictEqual(result.exitCode, 1);
      assert.deepStrictEqual(Object.keys(result.data.violations), ['src/Save.jsx']);
    } finally {
      teardown(dir);
    }
  });
});
