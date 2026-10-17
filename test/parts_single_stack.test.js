/**
 * sdds/fullstack-monorepo, decision 2 (TDD plan items 1 and 7): a repo with a
 * single code part installs byte for byte what it installed before
 * multi-part support. The golden file was captured with that earlier code.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SINGLE_STACK_FIXTURES, captureSingleStack } = require('./helpers/single_stack');
const GOLDEN = require('./fixtures/single_stack_snapshot.json');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');

describe('single-stack repos are installed exactly as before', () => {
  it('the golden file covers every fixture', () => {
    assert.deepStrictEqual(Object.keys(GOLDEN).sort(), Object.keys(SINGLE_STACK_FIXTURES).sort());
  });

  for (const [stack, files] of Object.entries(SINGLE_STACK_FIXTURES)) {
    it(`${stack}: same config shape, hook bytes, AGENTS.md and tools/`, () => {
      const actual = captureSingleStack(files, { autoDetectStack, generateHarness });
      const expected = GOLDEN[stack];
      assert.deepStrictEqual(actual.config, expected.config);
      assert.strictEqual(actual.hookFile, expected.hookFile);
      assert.strictEqual(actual.hook, expected.hook);
      assert.strictEqual(actual.agents, expected.agents);
      assert.deepStrictEqual(actual.tools, expected.tools);
    });
  }
});
