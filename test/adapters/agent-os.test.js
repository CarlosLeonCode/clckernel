const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTmpProject, teardown } = require('../helpers');

describe('AgentOSAdapter', () => {
  const AgentOSAdapter = require('../../src/adapters/agent-os');

  describe('constructor', () => {
    it('creates adapter with correct name and projectType', () => {
      const adapter = new AgentOSAdapter();
      assert.strictEqual(adapter.name, 'Agent-OS (Domain & AI Workflows)');
      assert.strictEqual(adapter.projectType, 'agent-os');
      assert.strictEqual(adapter.testRunner, 'Playbook / Contract Test');
    });
  });

  describe('detect()', () => {
    it('returns true when package.json keywords include ai-agents', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({
          name: 'my-agent-system',
          keywords: ['ai-agents']
        }),
      });
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), true);
      } finally {
        teardown(dir);
      }
    });

    it('returns true when skills/<name>/SKILL.md exists (sdds/agent-os-generic)', () => {
      const dir = createTmpProject({
        'skills/onboarding/SKILL.md': '---\nname: onboarding\ndescription: d\n---\n',
      });
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), true);
      } finally {
        teardown(dir);
      }
    });

    it('a README mentioning agents next to brand/ is no longer a signal (sdds/agent-os-generic)', () => {
      const dir = createTmpProject({
        'brand/client-profile.md': '# Brand Profile\n',
        'README.md': '# Operating System powered by AI Subagents\n'
      });
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), false);
      } finally {
        teardown(dir);
      }
    });

    it('returns false for standard React/Next.js app without agent-os signatures', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      });
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), false);
      } finally {
        teardown(dir);
      }
    });

    it('returns false when empty project', () => {
      const dir = createTmpProject({});
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), false);
      } finally {
        teardown(dir);
      }
    });
  });

  describe('provision()', () => {
    it('never overwrites an existing project-customized AGENTS.md', () => {
      const custom = [
        '# Custom project law — 13 rules',
        '',
        '- Output format rule for every channel',
        '- One-question-at-a-time onboarding',
        '- Mandatory planning step before execution',
        '- Published records are immutable',
        '',
      ].join('\n');
      const dir = createTmpProject({ 'AGENTS.md': custom });
      try {
        const adapter = new AgentOSAdapter();
        adapter.provision(dir, { gitHooks: 'githooks' });

        const after = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        assert.strictEqual(after, custom, 'AGENTS.md must be byte-identical after provision');
        assert.ok(!after.includes('Layer 2: Domain Runtime'), 'dual-layer template must not be injected');
        assert.ok(after.includes('One-question-at-a-time onboarding'), 'project invariants must survive');
      } finally {
        teardown(dir);
      }
    });

    it('creates Dual-Layer AGENTS.md, symlinks, and tools directory', () => {
      const dir = createTmpProject({});
      try {
        const adapter = new AgentOSAdapter();
        adapter.provision(dir, { gitHooks: 'githooks' });

        // AGENTS.md exists and has dual-layer architecture
        const agentsPath = path.join(dir, 'AGENTS.md');
        assert.ok(fs.existsSync(agentsPath), 'AGENTS.md must exist');
        const agentsContent = fs.readFileSync(agentsPath, 'utf-8');
        assert.match(agentsContent, /Layer 1: Development & Maintenance/i);
        assert.match(agentsContent, /Layer 2: Domain Runtime/i);
        assert.match(agentsContent, /Human-in-the-Loop/i);

        // Symlinks exist
        const claudeLink = path.join(dir, 'CLAUDE.md');
        const geminiLink = path.join(dir, 'GEMINI.md');
        const cursorrules = path.join(dir, '.cursorrules');
        assert.ok(fs.existsSync(claudeLink), 'CLAUDE.md link must exist');
        assert.ok(fs.existsSync(geminiLink), 'GEMINI.md link must exist');
        assert.ok(fs.existsSync(cursorrules), '.cursorrules link must exist');

        // tools/ exists; guards are copied by generateHarness from getTools(targetDir).
        assert.ok(fs.existsSync(path.join(dir, 'tools')), 'tools/ must exist');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('getTools() contract', () => {
    it('declares tool paths without "tools/" prefix and all declared files exist in bundled tools/', () => {
      const adapter = new AgentOSAdapter();
      const tools = adapter.getTools();
      assert.ok(tools.length >= 5, 'must declare at least 5 tools');
      const bundledToolsDir = path.join(__dirname, '..', '..', 'tools');

      for (const tool of tools) {
        assert.ok(
          !tool.path.startsWith('tools/'),
          `tool path for ${tool.name} must not start with tools/: got ${tool.path}`
        );
        const bundledFile = path.join(bundledToolsDir, tool.path);
        assert.ok(
          fs.existsSync(bundledFile),
          `bundled tool file for ${tool.name} must exist on disk at ${bundledFile}`
        );
      }
    });
  });

  describe('full harness generation & pre-commit hook execution', () => {
    it('generateHarness copies all tools and pre-commit hook runs without MODULE_NOT_FOUND', () => {
      const { generateHarness } = require('../../src/generator');
      const { execSync } = require('child_process');
      const adapter = new AgentOSAdapter();
      const dir = createTmpProject({});

      try {
        generateHarness(dir, {
          adapter,
          projectType: adapter.projectType,
          framework: adapter.name,
          testRunner: adapter.testRunner,
          gitHooks: 'githooks'
        });

        // 1. All manifest tools must exist in tools/
        for (const tool of adapter.getTools()) {
          const installedPath = path.join(dir, 'tools', tool.path);
          assert.ok(
            fs.existsSync(installedPath),
            `Tool ${tool.name} must be copied to ${installedPath}`
          );
        }

        // 2. audit.js should be installed, NOT audit.py
        assert.ok(fs.existsSync(path.join(dir, 'tools', 'audit.js')), 'audit.js must be installed for agent-os');
        assert.ok(!fs.existsSync(path.join(dir, 'tools', 'audit.py')), 'audit.py must NOT be installed for agent-os');

        // 3. Pre-commit hook runs to completion without module errors
        const hookFile = path.join(dir, '.githooks', 'pre-commit');
        assert.ok(fs.existsSync(hookFile), '.githooks/pre-commit must exist');

        const hookOutput = execSync(`bash "${hookFile}"`, { cwd: dir, encoding: 'utf-8' });
        assert.ok(hookOutput.includes('Running CLC Kernel Agent-OS'), 'hook executed header');
        assert.ok(!hookOutput.includes('MODULE_NOT_FOUND'), 'hook must not fail with MODULE_NOT_FOUND');
      } finally {
        teardown(dir);
      }
    });
  });
});
