/**
 * check_a11y reads each JSX tag whole (attributes may span several lines),
 * understands hidden inputs and labels associated through htmlFor / for or by
 * wrapping, and still reports real violations with the tag's first line.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createGitRepo, teardown } = require('./helpers');

const checkA11y = require('../tools/check_a11y');

async function rulesFor(source) {
  const dir = createGitRepo({ 'README.md': '# app\n' }, { 'src/Form.jsx': source });
  try {
    const result = await checkA11y(dir);
    const found = (result.data.violations['src/Form.jsx'] || []).map((v) => `${v.rule}@${v.lineNo}`);
    return { result, found };
  } finally {
    teardown(dir);
  }
}

describe('check_a11y reads whole JSX tags', () => {
  it('accepts an input whose aria-label is on a later line', async () => {
    const { found } = await rulesFor([
      'export const Search = () => (',
      '  <input',
      '    type="search"',
      '    onChange={(e) => setQuery(e.target.value)}',
      '    aria-label="Search products"',
      '  />',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });

  it('ignores hidden inputs', async () => {
    const { found } = await rulesFor('export const T = () => <input type="hidden" name="token" value={token} />;\n');
    assert.deepStrictEqual(found, []);
  });

  it('accepts an input labelled through htmlFor, even when the label comes first on another line', async () => {
    const { found } = await rulesFor([
      'export const Email = () => (',
      '  <>',
      '    <label htmlFor="email">Email</label>',
      '    <input',
      '      id="email"',
      '      type="email"',
      '    />',
      '  </>',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });

  it('accepts an input wrapped by its label', async () => {
    const { found } = await rulesFor([
      'export const Terms = () => (',
      '  <label>',
      '    <input type="checkbox" name="terms" />',
      '    Accept the terms',
      '  </label>',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });

  it('still reports an unlabelled multi-line input at the line where the tag starts', async () => {
    const { found, result } = await rulesFor([
      'export const Name = () => (',
      '  <input',
      '    type="text"',
      '    name="name"',
      '  />',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, ['input-label@2']);
    assert.strictEqual(result.exitCode, 1);
  });

  it('reports an input whose htmlFor points to a different id', async () => {
    const { found } = await rulesFor([
      'export const F = () => (',
      '  <>',
      '    <label htmlFor="mail">Email</label>',
      '    <input id="email" type="email" />',
      '  </>',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, ['input-label@4']);
  });

  it('accepts a multi-line img whose alt is on a later line, and reports one without alt', async () => {
    const { found } = await rulesFor([
      'export const Pics = () => (',
      '  <>',
      '    <img',
      '      src={logo}',
      '      alt="Company logo"',
      '    />',
      '    <img',
      '      src={banner}',
      '    />',
      '  </>',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, ['img-alt@7']);
  });

  it('accepts role="button" when the keyboard handler is on another line', async () => {
    const { found } = await rulesFor([
      'export const Card = () => (',
      '  <div',
      '    role="button"',
      '    onClick={open}',
      '    onKeyDown={openOnEnter}',
      '  >Open</div>',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });

  it('does not report inputs whose props are spread (the label may come from them)', async () => {
    const { found } = await rulesFor('export const Field = (props) => <input type="text" {...props} />;\n');
    assert.deepStrictEqual(found, []);
  });

  it('checks native <input>/<img> only, not components named Input or Img', async () => {
    const { found } = await rulesFor([
      'export const F = () => (',
      '  <>',
      '    <Input name="q" />',
      '    <Img src={logo} />',
      '  </>',
      ');',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });
});
