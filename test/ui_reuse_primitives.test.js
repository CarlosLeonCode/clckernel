/**
 * sdds/laila-platform-fit, REQ-9: check_ui_reuse exempts the UI primitives
 * themselves (by default any file under components/ui/) from the raw-element
 * rules; `ui_reuse.primitives` in .clckernel.yaml replaces the globs.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createGitRepo, teardown } = require('./helpers');

const check = require('../tools/check_ui_reuse');
const BUTTON = 'export function Button(props) {\n  return <button {...props} />;\n}\n';

async function run(committed, staged) {
  const dir = createGitRepo(committed, staged);
  try {
    return await check(dir);
  } finally {
    teardown(dir);
  }
}

describe('REQ-9: check_ui_reuse and UI primitives', () => {
  it('a raw <button> in components/ui/ (root or package) passes', async () => {
    const res = await run({ 'README.md': '#\n' }, {
      'components/ui/button.tsx': BUTTON,
      'apps/web/src/components/ui/input.tsx': 'export const Input = (p) => <input {...p} />;\n',
    });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res));
  });

  it('the same raw <button> in a page still fails', async () => {
    const res = await run({ 'README.md': '#\n' }, { 'app/page.tsx': BUTTON });
    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.data.violations['app/page.tsx'][0].rule, 'raw-button');
  });

  it('raw color classes in a primitive are still reported', async () => {
    const res = await run({ 'README.md': '#\n' }, { 'components/ui/badge.tsx': 'export const Badge = () => <span className="bg-blue-500" />;\n' });
    assert.deepStrictEqual(res.data.violations['components/ui/badge.tsx'].map((v) => v.rule), ['raw-colors']);
  });

  it('ui_reuse.primitives replaces the default globs', async () => {
    const config = 'ui_reuse:\n  primitives:\n    - "src/primitives/**"\n';
    const res = await run({ '.clckernel.yaml': config }, { 'src/primitives/button.tsx': BUTTON, 'components/ui/button.tsx': BUTTON });
    assert.deepStrictEqual(Object.keys(res.data.violations), ['components/ui/button.tsx']);
  });
});
