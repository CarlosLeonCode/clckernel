const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function git(...args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
}

const inRepo = git('rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';

describe('repository hygiene', { skip: !inRepo && 'not a git checkout' }, () => {
  it('tracks no file that .gitignore excludes', () => {
    const out = git('ls-files', '-ci', '--exclude-standard').stdout.trim();
    assert.strictEqual(out, '', `tracked but ignored:\n${out}`);
  });

  it('does not gitignore anything published through package.json#files', () => {
    const { files } = require(path.join(ROOT, 'package.json'));
    // --no-index: evaluate the rules themselves, even for paths that are tracked.
    const ignored = files.filter((entry) => git('check-ignore', '-q', '--no-index', entry).status === 0);
    assert.deepStrictEqual(ignored, []);
  });

  it('does not version platform binaries that skill launchers download on demand', () => {
    const out = git('ls-files', '*/scripts/bin/*').stdout.trim();
    assert.strictEqual(out, '', `tracked launcher binaries:\n${out}`);
  });
});
