/**
 * sdds/laila-platform-fit, REQ-3: `clckernel update` refreshes the
 * kernel-owned AGENTS.md sections (the Parts table and the safeguards of
 * section 2) and keeps every other section as the project edited it. A dry
 * run lists AGENTS.md in the plan and writes nothing.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTmpProject, teardown, git } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');

const pkg = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const quietly = (fn) => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};
const read = (dir) => fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const installed = (files) => {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  quietly(() => generateHarness(dir, autoDetectStack(dir)));
  return dir;
};
const MONO = {
  'package.json': pkg({ name: 'mono', private: true, workspaces: ['apps/*', 'packages/*'] }),
  'apps/web/package.json': pkg({ name: 'web', dependencies: { next: '^15.0.0' } }),
  'apps/api/requirements.txt': 'fastapi\n',
};

describe('REQ-3: update refreshes the kernel-owned AGENTS.md sections', () => {
  it('a part added after install appears in the Parts table and section 2; edited sections are kept', () => {
    const dir = installed(MONO);
    try {
      fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\n## Team notes\nKeep this paragraph.\n');
      write(dir, 'packages/lib/package.json', pkg({ name: 'lib', devDependencies: { vitest: '1' } }));
      write(dir, 'packages/lib/tsconfig.json', '{}\n');

      const dry = quietly(() => updateHarness(dir, { dryRun: true }));
      assert.ok(dry.plan.written.includes('AGENTS.md'), JSON.stringify(dry.plan.written));
      assert.doesNotMatch(read(dir), /packages\/lib/, 'dry run writes nothing');

      quietly(() => updateHarness(dir));
      const agents = read(dir);
      assert.match(agents, /\| `packages\/lib` \| TypeScript Library \| Vitest \|/);
      assert.match(agents, /Core AI Safeguards — `packages\/lib` \(TypeScript Library\)/);
      assert.match(agents, /## Team notes\nKeep this paragraph\./);
      assert.match(agents, /## 1\. The Loop/);
    } finally {
      teardown(dir);
    }
  });

  it('a single-stack AGENTS.md gets the guards of a new technology in section 2', () => {
    const dir = installed({ 'package.json': pkg({ name: 'web', dependencies: { next: '^15.0.0' } }) });
    try {
      const edited = read(dir).replace('## 1. The Loop (Every Task)', '## 1. The Loop (Every Task)\nOur own rule: pair on migrations.');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), edited);
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');
      quietly(() => updateHarness(dir));
      const agents = read(dir);
      assert.match(agents, /- Supabase: SQL migration guard/);
      assert.match(agents, /Our own rule: pair on migrations\./);
    } finally {
      teardown(dir);
    }
  });

  it('nothing changed => AGENTS.md is not rewritten', () => {
    const dir = installed(MONO);
    try {
      const result = quietly(() => updateHarness(dir));
      assert.ok(!result.plan.written.includes('AGENTS.md'));
    } finally {
      teardown(dir);
    }
  });

  it('an AGENTS.md without the kernel sections is left alone', () => {
    const dir = installed(MONO);
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Our rules\n\nWe write our own.\n');
      write(dir, 'packages/lib/package.json', pkg({ name: 'lib' }));
      write(dir, 'packages/lib/tsconfig.json', '{}\n');
      quietly(() => updateHarness(dir));
      assert.strictEqual(read(dir), '# Our rules\n\nWe write our own.\n');
    } finally {
      teardown(dir);
    }
  });
});
