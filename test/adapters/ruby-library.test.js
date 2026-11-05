/**
 * sdds/monorepo-library-parts: the Ruby library adapter (*.gemspec or Gemfile
 * without Rails' config/routes.rb), used only for monorepo parts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('../helpers');
const RubyLibraryAdapter = require('../../src/adapters/ruby-library');
const { adapters } = require('../../src/detector');

function withDir(files, fn) {
  const dir = createTmpProject(files);
  try {
    return fn(dir);
  } finally {
    teardown(dir);
  }
}

describe('RubyLibraryAdapter', () => {
  it('has the library name, project type and test runner', () => {
    const adapter = new RubyLibraryAdapter();
    assert.deepStrictEqual([adapter.name, adapter.projectType, adapter.testRunner], ['Ruby Library', 'library', 'RSpec / Minitest']);
  });

  it('is not offered as a root stack (not in the detector adapters list)', () => {
    assert.ok(!adapters.some((a) => a instanceof RubyLibraryAdapter));
  });

  it('detect(): a *.gemspec or a Gemfile; false otherwise', () => {
    withDir({ 'thing.gemspec': '' }, (dir) => assert.strictEqual(new RubyLibraryAdapter().detect(dir), true));
    withDir({ Gemfile: '' }, (dir) => assert.strictEqual(new RubyLibraryAdapter().detect(dir), true));
    withDir({ 'lib/thing.rb': '' }, (dir) => assert.strictEqual(new RubyLibraryAdapter().detect(dir), false));
  });

  it('getTools(): JS guards, rubocop and rspec from Gemfile.lock, minitest via rake when rspec is absent', () => {
    const tools = new RubyLibraryAdapter().getTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ['check_custom', 'minitest', 'rspec', 'rubocop', 'scan_secrets', 'verify_tdd']);
    const rspec = tools.find((t) => t.name === 'rspec');
    assert.deepStrictEqual([rspec.command, rspec.availableIf], ['bundle exec rspec', "grep -q '^    rspec-core ' Gemfile.lock"]);
    const minitest = tools.find((t) => t.name === 'minitest');
    assert.strictEqual(minitest.command, 'bundle exec rake test');
    assert.strictEqual(minitest.availableIf, "[ -f Rakefile ] && grep -q '^    minitest ' Gemfile.lock && ! grep -q '^    rspec-core ' Gemfile.lock");
  });
});
