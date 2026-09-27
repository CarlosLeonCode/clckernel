const { describe, it } = require('node:test');
const assert = require('node:assert');
const { promptOptions, colors, printBanner, printBox, printSuccess } = require('../src/ui');

describe('UI & Prompts (@clack/prompts integration)', () => {
  const dummyDetected = {
    projectType: 'frontend',
    framework: 'Next.js',
    styling: 'Tailwind CSS',
    uiLibrary: 'shadcn/ui',
    testRunner: 'Vitest',
    gitHooks: 'husky'
  };

  it('exports expected UI helper functions and color palette', () => {
    assert.strictEqual(typeof promptOptions, 'function');
    assert.strictEqual(typeof printBanner, 'function');
    assert.strictEqual(typeof printBox, 'function');
    assert.strictEqual(typeof printSuccess, 'function');
    assert.ok(colors.cyan);
    assert.ok(colors.emerald);
  });

  it('promptOptions resolves detected config automatically in non-interactive mode', async () => {
    // When stdin is not a TTY (like in test environments)
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;

    try {
      const result = await promptOptions({ ...dummyDetected });
      assert.deepStrictEqual(result.projectType, 'frontend');
      assert.deepStrictEqual(result.framework, 'Next.js');
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it('promptOptions resolves immediately when --yes or -y flag is present', async () => {
    const originalArgv = process.argv;
    process.argv = [...originalArgv, '--yes'];

    try {
      const result = await promptOptions({ ...dummyDetected });
      assert.deepStrictEqual(result.projectType, 'frontend');
    } finally {
      process.argv = originalArgv;
    }
  });
});
