const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

describe('Audit Orchestrator & 4-Lens RDD Receipt', () => {
  const auditScript = path.resolve(__dirname, '..', 'tools', 'audit.js');

  it('runs audit and generates 4-lens summary and audit-receipt.json', () => {
    const dir = createTmpProject({
      'AGENTS.md': '# Law\n',
      'tools/scan_secrets.js': `module.exports = async () => ({ exitCode: 0, skipped: false, name: 'scan_secrets', data: { message: 'No secrets' } });`,
      'tools/check_architecture.js': `module.exports = async () => ({ exitCode: 0, skipped: false, name: 'check_architecture', data: { message: 'Layers intact' } });`,
      'tools/check_scope.js': `module.exports = async () => ({ exitCode: 0, skipped: false, name: 'check_scope', data: { message: 'Scope valid' } });`,
      'tools/check_performance.js': `module.exports = async () => ({ exitCode: 0, skipped: false, name: 'check_performance', data: { message: 'Fast' } });`,
    });

    try {
      // Run audit.js in the project
      const stdout = execSync(`node "${auditScript}" "${dir}"`, { encoding: 'utf-8' });

      // 1. Verify stdout contains 4 Canonical Lenses
      assert.ok(stdout.includes('4-LENS RDD AUDIT SUMMARY'), 'Must display 4-Lens header');
      assert.ok(stdout.includes('CORRECTNESS LENS'), 'Must display Correctness Lens');
      assert.ok(stdout.includes('SECURITY LENS'), 'Must display Security Lens');
      assert.ok(stdout.includes('ARCHITECTURE LENS'), 'Must display Architecture Lens');
      assert.ok(stdout.includes('PERFORMANCE LENS'), 'Must display Performance Lens');

      // 2. Verify audit-receipt.json was written to the active sdd dir
      const sddsDir = path.join(dir, 'sdds');
      assert.ok(fs.existsSync(sddsDir), 'sdds directory must exist');
      const sddSubdirs = fs.readdirSync(sddsDir).filter(f => fs.statSync(path.join(sddsDir, f)).isDirectory());
      assert.ok(sddSubdirs.length > 0, 'at least one active sdd dir must exist');
      
      const receiptPath = path.join(sddsDir, sddSubdirs[0], 'audit-receipt.json');
      assert.ok(fs.existsSync(receiptPath), `audit-receipt.json must exist at ${receiptPath}`);

      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
      assert.strictEqual(receipt.contract, 'clckernel.audit-receipt/v1');
      assert.strictEqual(receipt.verdict, 'PASSED');
      assert.ok(receipt.timestamp, 'Must have timestamp');
      assert.ok(receipt.lenses.correctness, 'Must have correctness lens');
      assert.ok(receipt.lenses.security, 'Must have security lens');
      assert.ok(receipt.lenses.architecture, 'Must have architecture lens');
      assert.ok(receipt.lenses.performance, 'Must have performance lens');
      assert.strictEqual(receipt.gentle_ai.compatible, true);
      assert.strictEqual(receipt.gentle_ai.rdd_ready, true);
    } finally {
      teardown(dir);
    }
  });

  it('marks receipt verdict as FAILED when a guard reports failure', () => {
    const dir = createTmpProject({
      'AGENTS.md': '# Law\n',
      'tools/scan_secrets.js': `module.exports = async () => ({ exitCode: 1, skipped: false, name: 'scan_secrets', data: { violations: [{ message: 'API key leak' }] } });`,
    });

    try {
      try {
        execSync(`node "${auditScript}" "${dir}"`, { encoding: 'utf-8', stdio: 'pipe' });
        assert.fail('Should have exited with non-zero exit code');
      } catch (err) {
        assert.strictEqual(err.status, 1, 'Must exit with code 1');
      }

      const sddsDir = path.join(dir, 'sdds');
      const sddSubdirs = fs.readdirSync(sddsDir).filter(f => fs.statSync(path.join(sddsDir, f)).isDirectory());
      const receiptPath = path.join(sddsDir, sddSubdirs[0], 'audit-receipt.json');
      assert.ok(fs.existsSync(receiptPath), 'audit-receipt.json must be emitted even on failure');

      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
      assert.strictEqual(receipt.verdict, 'FAILED');
      assert.strictEqual(receipt.lenses.security.status, 'FAILED');
      assert.strictEqual(receipt.lenses.security.failed, 1);
    } finally {
      teardown(dir);
    }
  });
});
