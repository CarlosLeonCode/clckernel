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
    it('returns true when package.json keywords or name include agent-os or marketing-os or laila-mos', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({
          name: 'my-agent-system',
          keywords: ['marketing-os', 'ai-agents']
        }),
      });
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), true);
      } finally {
        teardown(dir);
      }
    });

    it('returns true when skills/ directory has prompt markdown files', () => {
      const dir = createTmpProject({
        'skills/skill_onboarding.md': '# Onboarding Skill\n',
      });
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), true);
      } finally {
        teardown(dir);
      }
    });

    it('returns true when brand/ or templates/ exist alongside README referencing agents', () => {
      const dir = createTmpProject({
        'brand/client-profile.md': '# Brand Profile\n',
        'README.md': '# Operating System powered by AI Subagents\n'
      });
      try {
        const adapter = new AgentOSAdapter();
        assert.strictEqual(adapter.detect(dir), true);
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
        '# Laila MOS — 13 reglas',
        '',
        '- Regla de formato nativo de Carruseles y Reels',
        '- One-question-at-a-time onboarding',
        '- Estrategia dinamica obligatoria por calendario',
        '- Invariante de inmutabilidad del calendario',
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

        // Tools exist
        assert.ok(fs.existsSync(path.join(dir, 'tools', 'check_symlinks.js')), 'check_symlinks must exist');
        assert.ok(fs.existsSync(path.join(dir, 'tools', 'check_hitl.js')), 'check_hitl must exist');
        assert.ok(fs.existsSync(path.join(dir, 'tools', 'check_domain_data.js')), 'check_domain_data must exist');
      } finally {
        teardown(dir);
      }
    });
  });
});
