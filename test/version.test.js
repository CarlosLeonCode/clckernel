/**
 * sdds/update-whats-new, TDD item 1: src/version.js compares kernel versions
 * numerically on major.minor.patch, ignoring a prerelease or build suffix.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { compareVersions, isNewer } = require('../src/version');

describe('compareVersions', () => {
  it('compares each part as a number, not as text', () => {
    assert.strictEqual(compareVersions('2.10.0', '2.9.9'), 1);
    assert.strictEqual(compareVersions('2.9.9', '2.10.0'), -1);
    assert.strictEqual(compareVersions('10.0.0', '9.99.99'), 1);
    assert.strictEqual(compareVersions('2.2.10', '2.2.9'), 1);
  });

  it('returns 0 for equal versions', () => {
    assert.strictEqual(compareVersions('2.2.0', '2.2.0'), 0);
    assert.strictEqual(compareVersions('0.0.0', '0.0.0'), 0);
  });

  it('ignores a prerelease or build suffix', () => {
    assert.strictEqual(compareVersions('2.2.0-beta.1', '2.2.0'), 0);
    assert.strictEqual(compareVersions('2.2.0+build.7', '2.2.0-rc.1'), 0);
    assert.strictEqual(compareVersions('2.3.0-rc.1', '2.2.9'), 1);
  });

  it('throws a clear error on invalid input', () => {
    for (const bad of ['2.2', 'abc', '', ' 2.2.0', 'v2.2.0', '2.2.0.1', null, undefined, 220, {}]) {
      assert.throws(() => compareVersions(bad, '2.2.0'), /Invalid version .*major\.minor\.patch/, String(bad));
      assert.throws(() => compareVersions('2.2.0', bad), /Invalid version/, String(bad));
    }
  });
});

describe('isNewer', () => {
  it('is true only when the first version is strictly newer than the second', () => {
    assert.strictEqual(isNewer('2.2.0', '2.1.0'), true);
    assert.strictEqual(isNewer('2.10.0', '2.9.0'), true);
    assert.strictEqual(isNewer('2.2.0', '2.2.0'), false);
    assert.strictEqual(isNewer('2.1.0', '2.2.0'), false);
    assert.strictEqual(isNewer('2.2.0-beta.1', '2.2.0'), false);
  });

  it('throws on an invalid version', () => {
    assert.throws(() => isNewer('2.2', '2.1.0'), /Invalid version/);
  });
});
