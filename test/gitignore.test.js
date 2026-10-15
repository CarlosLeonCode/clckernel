const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');
const { ensureGitignoreEntries } = require('../src/gitignore');

describe('ensureGitignoreEntries', () => {
  it('creates .gitignore with all required mirrors and ephemeral entries when missing', () => {
    const dir = createTmpProject({});

    try {
      const gitignorePath = path.join(dir, '.gitignore');
      assert.strictEqual(fs.existsSync(gitignorePath), false);

      ensureGitignoreEntries(dir);

      assert.strictEqual(fs.existsSync(gitignorePath), true);
      const content = fs.readFileSync(gitignorePath, 'utf-8');

      // AI IDE mirrors
      assert.ok(content.includes('CLAUDE.md'), 'must ignore CLAUDE.md');
      assert.ok(content.includes('GEMINI.md'), 'must ignore GEMINI.md');
      assert.ok(content.includes('.cursorrules'), 'must ignore .cursorrules');
      assert.ok(content.includes('.windsurfrules'), 'must ignore .windsurfrules');
      assert.ok(content.includes('.cursor/'), 'must ignore .cursor/');
      assert.ok(content.includes('.antigravity/'), 'must ignore .antigravity/');
      assert.ok(content.includes('.github/copilot-instructions.md'), 'must ignore copilot instructions');

      // CLI skills
      assert.ok(content.includes('.agents/skills/clckernel_cli/'), 'must ignore clckernel_cli skill');
      assert.ok(content.includes('.agents/skills/clc_forge_cli/'), 'must ignore clc_forge_cli skill');

      // Local SDDs & Ephemeral artifacts
      assert.ok(content.includes('sdds/*'), 'must ignore sdds/*');
      assert.ok(content.includes('!sdds/.gitkeep'), 'must keep sdds/.gitkeep');
      assert.ok(content.includes('openspec/*'), 'must ignore openspec/*');
      assert.ok(content.includes('.clckernel.resolved.json'), 'must ignore .clckernel.resolved.json');
      assert.ok(content.includes('.clc-forge.resolved.json'), 'must ignore .clc-forge.resolved.json');
      assert.ok(content.includes('.husky/_/'), 'must ignore .husky/_/');
    } finally {
      teardown(dir);
    }
  });

  it('appends only missing entries idempotently without duplicates or overwriting existing content', () => {
    const dir = createTmpProject({
      '.gitignore': 'node_modules/\ndist/\nCLAUDE.md\nsdds/*\n',
    });

    try {
      const gitignorePath = path.join(dir, '.gitignore');

      ensureGitignoreEntries(dir);
      const content1 = fs.readFileSync(gitignorePath, 'utf-8');

      // Existing entries preserved
      assert.ok(content1.includes('node_modules/'));
      assert.ok(content1.includes('dist/'));

      // Missing entries added
      assert.ok(content1.includes('GEMINI.md'));
      assert.ok(content1.includes('.cursorrules'));
      assert.ok(content1.includes('.antigravity/'));

      // Check no duplicates of CLAUDE.md
      const claudeMatches = content1.match(/^CLAUDE\.md$/gm);
      assert.strictEqual(claudeMatches.length, 1, 'CLAUDE.md should appear exactly once');

      // Run a second time to ensure absolute idempotence
      ensureGitignoreEntries(dir);
      const content2 = fs.readFileSync(gitignorePath, 'utf-8');
      assert.strictEqual(content1, content2, 'second run must not modify anything');
    } finally {
      teardown(dir);
    }
  });
});
