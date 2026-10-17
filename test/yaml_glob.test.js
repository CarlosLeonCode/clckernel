/**
 * globToRegex (tools/yaml.js) must share the semantics of the Python
 * _glob_to_regex in tools/check_custom.py: `**` / `*` / `?` / `{a,b}` are
 * wildcards and every other character is matched literally.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { globToRegex } = require('../tools/yaml.js');

function assertGlob(glob, file, expected) {
  assert.strictEqual(
    globToRegex(glob).test(file),
    expected,
    `"${glob}" ${expected ? 'should' : 'should not'} match "${file}"`
  );
}

describe('yaml.js globToRegex', () => {
  it('regex special characters are matched literally', () => {
    assertGlob('file(1).js', 'file(1).js', true);
    assertGlob('file(1).js', 'file1.js', false);
    assertGlob('a.js', 'abjs', false);
    assertGlob('a+b$^|.js', 'a+b$^|.js', true);
    assertGlob('[ab].js', '[ab].js', true);
    assertGlob('[ab].js', 'a.js', false);
  });

  it('"*" does not cross directory separators', () => {
    assertGlob('src/*.js', 'src/a.js', true);
    assertGlob('src/*.js', 'src/x/a.js', false);
  });

  it('"?" matches exactly one non-separator character', () => {
    assertGlob('a?.js', 'ab.js', true);
    assertGlob('a?.js', 'a/.js', false);
    assertGlob('a?.js', 'a.js', false);
  });

  it('"**/" matches zero or more leading directories', () => {
    assertGlob('**/*.js', 'a.js', true);
    assertGlob('**/*.js', 'src/x/a.js', true);
    assertGlob('**/*.js', 'src/a.ts', false);
  });

  it('trailing "**" matches anything below a directory', () => {
    assertGlob('docs/**', 'docs/a/b.md', true);
    assertGlob('docs/**', 'src/docs.md', false);
  });

  it('"{a,b}" expands to a literal alternation', () => {
    assertGlob('*.{js,ts}', 'a.js', true);
    assertGlob('*.{js,ts}', 'a.ts', true);
    assertGlob('*.{js,ts}', 'a.py', false);
    assertGlob('*.{j.s,ts}', 'a.jxs', false);
  });
});
