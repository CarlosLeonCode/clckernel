/**
 * sdds/monorepo-library-parts: the PHP library adapter (composer.json without
 * Laravel's artisan), used only for monorepo parts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('../helpers');
const PhpLibraryAdapter = require('../../src/adapters/php-library');
const { adapters } = require('../../src/detector');

function withDir(files, fn) {
  const dir = createTmpProject(files);
  try {
    return fn(dir);
  } finally {
    teardown(dir);
  }
}

describe('PhpLibraryAdapter', () => {
  it('has the library name, project type and test runner', () => {
    const adapter = new PhpLibraryAdapter();
    assert.deepStrictEqual([adapter.name, adapter.projectType, adapter.testRunner], ['PHP Library', 'library', 'Pest / PHPUnit']);
  });

  it('is not offered as a root stack (not in the detector adapters list)', () => {
    assert.ok(!adapters.some((a) => a instanceof PhpLibraryAdapter));
  });

  it('detect(): true with composer.json, false without', () => {
    withDir({ 'composer.json': '{}' }, (dir) => assert.strictEqual(new PhpLibraryAdapter().detect(dir), true));
    withDir({ 'index.php': '' }, (dir) => assert.strictEqual(new PhpLibraryAdapter().detect(dir), false));
  });

  it('getTools(): JS guards, phpstan and one test step (Pest when installed, else PHPUnit) from vendor/bin', () => {
    const tools = new PhpLibraryAdapter().getTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ['check_custom', 'phpstan', 'phpunit', 'scan_secrets', 'verify_tdd']);
    const phpstan = tools.find((t) => t.name === 'phpstan');
    assert.deepStrictEqual([phpstan.command, phpstan.availableIf], ['./vendor/bin/phpstan analyse', '[ -x vendor/bin/phpstan ]']);
    const tests = tools.find((t) => t.name === 'phpunit');
    assert.strictEqual(tests.availableIf, '[ -x vendor/bin/pest ] || [ -x vendor/bin/phpunit ]');
    assert.strictEqual(tests.command, 'if [ -x vendor/bin/pest ]; then ./vendor/bin/pest; else ./vendor/bin/phpunit; fi');
  });
});
