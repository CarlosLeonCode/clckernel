/**
 * "Elegir otro stack": choosing a different stack in the interactive prompt
 * returns the config the detector would build for that adapter, so the chosen
 * adapter (not the detected one) drives provisioning, AGENTS.md and the hook.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTmpProject, teardown } = require('./helpers');
const detector = require('../src/detector');
const { promptOptions } = require('../src/ui');
const { generateHarness } = require('../src/generator');

const RAILS_FILES = {
  Gemfile: "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\n",
  'config/routes.rb': 'Rails.application.routes.draw do\nend\n',
};
const NEXT_FILES = {
  'package.json': JSON.stringify({ dependencies: { next: '14.0.0', react: '18.0.0' } }),
};

function railsAdapter() {
  return detector.adapters.find((a) => a.name === 'Ruby on Rails');
}

describe('detector.buildStackConfig', () => {
  it('builds the same config autoDetectStack builds for that adapter', () => {
    const dir = createTmpProject(RAILS_FILES);
    try {
      const detected = detector.autoDetectStack(dir);
      assert.strictEqual(detected.adapter, railsAdapter());
      assert.deepStrictEqual(detector.buildStackConfig(dir, railsAdapter()), detected);
    } finally {
      teardown(dir);
    }
  });

  it('builds the generic config for a null adapter', () => {
    const dir = createTmpProject({ 'README.md': '# x\n' });
    try {
      assert.deepStrictEqual(detector.buildStackConfig(dir, null), detector.autoDetectStack(dir));
    } finally {
      teardown(dir);
    }
  });
});

describe('promptOptions — Elegir otro stack', () => {
  let answers;
  let calls;
  // @clack/prompts is an ES module namespace (read-only), so promptOptions
  // takes the prompts implementation as an option; this stub answers selects.
  const prompts = {
    intro: () => {},
    cancel: () => {},
    isCancel: () => false,
    select: async (opts) => {
      calls.push(opts);
      return answers.shift();
    },
  };
  const run = (dir) => promptOptions(detector.autoDetectStack(dir), { targetDir: dir, prompts, interactive: true });

  beforeEach(() => {
    calls = [];
  });

  it('offers one "Elegir otro stack" option instead of the force modes', async () => {
    const dir = createTmpProject(NEXT_FILES);
    try {
      answers = ['confirm'];
      await run(dir);
      const values = calls[0].options.map((o) => o.value);
      assert.deepStrictEqual(values, ['confirm', 'other', 'cancel']);
    } finally {
      teardown(dir);
    }
  });

  it('lists every adapter plus Genérico in the second select', async () => {
    const dir = createTmpProject(NEXT_FILES);
    try {
      answers = ['other', 'generic'];
      const config = await run(dir);
      const labels = calls[1].options.map((o) => o.label);
      assert.deepStrictEqual(labels, [...detector.adapters.map((a) => a.name), 'Genérico']);
      assert.strictEqual(config.adapter, null);
      assert.strictEqual(config.projectType, 'unknown');
    } finally {
      teardown(dir);
    }
  });

  it('choosing Rails on a Next.js project provisions Rails, not Next.js', async () => {
    const dir = createTmpProject(NEXT_FILES);
    try {
      answers = ['other', 'Ruby on Rails'];
      const config = await run(dir);
      assert.strictEqual(config.adapter, railsAdapter());
      assert.deepStrictEqual(config, detector.buildStackConfig(dir, railsAdapter()));

      const { installedGuards } = generateHarness(dir, config);
      const expected = railsAdapter().getTools().filter((t) => t.path).map((t) => t.name);
      assert.deepStrictEqual([...installedGuards].sort(), [...expected].sort());
      const tools = fs.readdirSync(path.join(dir, 'tools'));
      assert.deepStrictEqual(tools.filter((f) => f.endsWith('.py')), []);
      assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8'), /Ruby on Rails/);
    } finally {
      teardown(dir);
    }
  });
});
