const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');
const { updateHarness } = require('../src/updater');

describe('updateHarness (Non-Destructive Update)', () => {
  it('preserves existing sdds/ content without overwriting or deleting', () => {
    const dir = createTmpProject({
      'sdds/auth-jwt/spec.md': '# Spec: Auth JWT\nDO NOT OVERWRITE THIS\n',
      'sdds/payment/plan.md': '# Plan: Payment\nIMPORTANT PLAN\n',
      'tools/audit.js': '// outdated audit orchestrator\n',
      'AGENTS.md': '# Old AGENTS.md\n',
      '.clckernel.yaml': 'safeguards:\n  scan_secrets: true\n  custom_threshold: 42\n',
      'tools/guards/company_rule.js': '// Custom company AST rule\n',
    });

    try {
      const result = updateHarness(dir);
      assert.strictEqual(result.success, true);

      // Verify sdds/ were preserved
      const authSpec = fs.readFileSync(path.join(dir, 'sdds', 'auth-jwt', 'spec.md'), 'utf-8');
      assert.ok(authSpec.includes('DO NOT OVERWRITE THIS'));
      const paymentPlan = fs.readFileSync(path.join(dir, 'sdds', 'payment', 'plan.md'), 'utf-8');
      assert.ok(paymentPlan.includes('IMPORTANT PLAN'));

      // Verify custom guard in tools/guards was preserved
      const customGuard = fs.readFileSync(path.join(dir, 'tools', 'guards', 'company_rule.js'), 'utf-8');
      assert.ok(customGuard.includes('Custom company AST rule'));

      // Verify .clckernel.yaml was preserved
      const yamlContent = fs.readFileSync(path.join(dir, '.clckernel.yaml'), 'utf-8');
      assert.ok(yamlContent.includes('custom_threshold: 42'));

      // Verify core standard tools were updated
      const auditContent = fs.readFileSync(path.join(dir, 'tools', 'audit.js'), 'utf-8');
      assert.ok(!auditContent.includes('outdated audit orchestrator'));
      assert.ok(auditContent.includes('audit') || auditContent.includes('check'));

      // Verify skills were installed with playbooks
      assert.ok(fs.existsSync(path.join(dir, '.agents', 'skills', 'clckernel_cli', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(dir, '.agents', 'skills', 'clckernel_cli', 'reference', 'update.md')));

      // Verify symlinks were created/re-linked
      assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
      assert.ok(fs.existsSync(path.join(dir, 'GEMINI.md')));
    } finally {
      teardown(dir);
    }
  });

  it('updates pre-commit hook and ensures all standard guards run', () => {
    const dir = createTmpProject({
      'AGENTS.md': '# AGENTS.md\n',
      '.husky/pre-commit': '#!/usr/bin/env sh\n# outdated hook\nnode tools/scan_secrets.js\n',
      'tools/guards/my_guard.js': '// my guard\n',
    });

    try {
      const result = updateHarness(dir);
      assert.strictEqual(result.success, true);

      const hook = fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf-8');
      assert.ok(hook.includes('tools/scan_secrets.js'));
    } finally {
      teardown(dir);
    }
  });

  it('never overwrites a project-customized AGENTS.md with the generic template', () => {
    const custom = [
      '# Laila MOS — AGENTS',
      '',
      '- Native format rule for Carruseles and Reels',
      '- One-question-at-a-time onboarding',
      '- Mandatory dynamic calendar strategy',
      '- Calendar immutability invariant',
      '',
    ].join('\n');
    const dir = createTmpProject({ 'AGENTS.md': custom });

    try {
      const result = updateHarness(dir);
      assert.strictEqual(result.success, true);

      const after = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.strictEqual(after, custom, 'AGENTS.md must be byte-identical after update');
      assert.ok(!after.includes('Universal Command Interface'), 'generic template must not be injected');
      assert.ok(!after.includes('MANDATORY EXECUTION OVERRIDE RULE'), 'generic RULE #0 must not be injected');
    } finally {
      teardown(dir);
    }
  });

  it('injects the update row idempotently into an existing command table', () => {
    const withTable = [
      '# CLC Kernel Generic — AGENTS',
      '',
      '## 3. Universal Command Interface',
      '',
      '| Command | Phase | Protocol |',
      '|---|---|---|',
      '| `clckernel start` | Setup | Scan codebase. |',
      '',
    ].join('\n');
    const dir = createTmpProject({ 'AGENTS.md': withTable });

    try {
      updateHarness(dir);
      const first = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');

      const occurrences = first.split('| `clckernel update`').length - 1;
      assert.strictEqual(occurrences, 1, 'update row must appear exactly once');

      const headerIdx = first.indexOf('| Command | Phase | Protocol |');
      const rowIdx = first.indexOf('| `clckernel update`');
      const startIdx = first.indexOf('| `clckernel start`');
      assert.ok(headerIdx < rowIdx, 'update row must live inside the table, below its header');
      assert.ok(rowIdx < startIdx, 'update row must precede the start row');

      // Second run must be a no-op (idempotency guard).
      updateHarness(dir);
      const second = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.strictEqual(second, first, 're-running update must not duplicate the row');
    } finally {
      teardown(dir);
    }
  });

  it('executes update via CLI binary and exits 0', () => {
    const { execSync } = require('child_process');
    const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
    const dir = createTmpProject({
      'AGENTS.md': '# AGENTS.md\n',
      'tools/audit.js': '// old audit\n',
    });

    try {
      const output = execSync(`node "${CLI_PATH}" update "${dir}"`, {
        encoding: 'utf-8',
        timeout: 15000,
      });
      assert.ok(output.includes('Actualizando CLC Kernel'), 'output should confirm update');
      assert.ok(output.includes('ACTIVOS PRESERVADOS AL 100%'), 'output should confirm preservation');
    } finally {
      teardown(dir);
    }
  });
});
