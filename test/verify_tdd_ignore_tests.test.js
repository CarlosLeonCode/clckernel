/**
 * tdd.ignore leaves a matching file out of the verification, whether it would
 * be code or a test: an end-to-end spec owned by another runner (Playwright,
 * Cypress) is never handed to the unit runner. JS, Python and the other
 * language profiles behave the same.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const PKG = JSON.stringify({ name: 'p', private: true, devDependencies: { vitest: '*' } });
const IGNORE_E2E = 'tdd:\n  ignore:\n    - "e2e/**"\n';
const SPEC = "import { test } from '@playwright/test';\ntest('greets', async () => {});\n";

function run(script, dir) {
  const res = spawnSync(script.endsWith('.py') ? 'python3' : process.execPath, [path.join(TOOLS, script), dir], { cwd: dir, encoding: 'utf-8' });
  return { status: res.status, data: JSON.parse(res.stdout).data };
}

describe('verify_tdd.js: tdd.ignore applies to tests', () => {
  it('an ignored spec is not a changed test; the code change reports missing test evidence', () => {
    const dir = createGitRepo(
      { 'package.json': PKG, '.clckernel.yaml': IGNORE_E2E, 'src/example.ts': 'export const greet = () => "hi";\n', 'e2e/example.spec.ts': SPEC },
      { 'src/example.ts': 'export const greet = () => "hello";\n', 'e2e/example.spec.ts': `${SPEC}// hello\n` },
    );
    try {
      const { status, data } = run('verify_tdd.js', dir);
      assert.strictEqual(status, 1);
      assert.deepStrictEqual(data.changed_tests, []);
      assert.deepStrictEqual(data.changed_code, ['src/example.ts']);
      assert.match(data.message, /No test evidence/);
    } finally {
      teardown(dir);
    }
  });

  it('a change to an ignored spec alone passes without running any runner', () => {
    const dir = createGitRepo(
      { 'package.json': PKG, '.clckernel.yaml': IGNORE_E2E, 'e2e/example.spec.ts': SPEC },
      { 'e2e/example.spec.ts': `${SPEC}// hello\n` },
    );
    try {
      const { status, data } = run('verify_tdd.js', dir);
      assert.strictEqual(status, 0, data.message);
      assert.deepStrictEqual(data.changed_tests, []);
    } finally {
      teardown(dir);
    }
  });

  it('an ignored Go test is not a changed test either', () => {
    const dir = createGitRepo(
      { 'go.mod': 'module m\n', '.clckernel.yaml': 'tdd:\n  ignore:\n    - "e2e/**"\n', 'e2e/flow_test.go': 'package e2e\n' },
      { 'e2e/flow_test.go': 'package e2e\n// changed\n' },
    );
    try {
      const { status, data } = run('verify_tdd.js', dir);
      assert.strictEqual(status, 0, data.message);
      assert.deepStrictEqual(data.changed_tests, []);
    } finally {
      teardown(dir);
    }
  });
});

describe('verify_tdd.py: tdd.ignore applies to tests', () => {
  it('an ignored test is not a changed test; the code change reports missing test evidence', () => {
    const dir = createGitRepo(
      { '.clckernel.yaml': 'tdd:\n  ignore:\n    - "e2e/**"\n', 'app.py': 'x = 1\n', 'e2e/test_flow.py': 'def test_flow():\n    pass\n' },
      { 'app.py': 'x = 2\n', 'e2e/test_flow.py': 'def test_flow():\n    assert True\n' },
    );
    try {
      const { status, data } = run('verify_tdd.py', dir);
      assert.strictEqual(status, 1);
      assert.deepStrictEqual(data.changed_tests, []);
      assert.deepStrictEqual(data.changed_code, ['app.py']);
    } finally {
      teardown(dir);
    }
  });
});
