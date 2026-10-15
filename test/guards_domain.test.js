const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');
const checkSymlinks = require('../tools/check_symlinks');
const checkHitl = require('../tools/check_hitl');
const checkDomainData = require('../tools/check_domain_data');
const checkTestCalendarSync = require('../tools/check_test_calendar_sync');

describe('Domain Safeguards (Agent-OS)', () => {
  describe('check_symlinks', () => {
    it('skips gracefully when no AGENTS.md exists', async () => {
      const dir = createTmpProject({});
      try {
        const res = await checkSymlinks(dir);
        assert.strictEqual(res.exitCode, 0);
        assert.strictEqual(res.skipped, true);
      } finally {
        teardown(dir);
      }
    });

    it('passes when symlink points to AGENTS.md', async () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n'
      });
      try {
        fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
        fs.symlinkSync('AGENTS.md', path.join(dir, 'GEMINI.md'));
        const res = await checkSymlinks(dir);
        assert.strictEqual(res.exitCode, 0);
      } finally {
        teardown(dir);
      }
    });

    it('fails when symlink is broken (points to non-existent file)', async () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n'
      });
      try {
        fs.symlinkSync('non-existent.md', path.join(dir, 'CLAUDE.md'));
        const res = await checkSymlinks(dir);
        assert.strictEqual(res.exitCode, 1);
        assert.strictEqual(res.data.violations.length, 1);
      } finally {
        teardown(dir);
      }
    });
  });

  describe('check_hitl', () => {
    it('skips when no skills directory exists', async () => {
      const dir = createTmpProject({});
      try {
        const res = await checkHitl(dir);
        assert.strictEqual(res.exitCode, 0);
        assert.strictEqual(res.skipped, true);
      } finally {
        teardown(dir);
      }
    });

    it('passes when skills contain HITL review checkpoints', async () => {
      const dir = createTmpProject({
        'skills/skill_calendar.md': '# Calendar Skill\nPause and request human-in-the-loop review before continuing.\n'
      });
      try {
        const res = await checkHitl(dir);
        assert.strictEqual(res.exitCode, 0);
      } finally {
        teardown(dir);
      }
    });

    it('fails when skills omit HITL checkpoints', async () => {
      const dir = createTmpProject({
        'skills/skill_bad.md': '# Unattended Autonomous Skill\nRuns all steps automatically without pauses.\n'
      });
      try {
        const res = await checkHitl(dir);
        assert.strictEqual(res.exitCode, 1);
        assert.strictEqual(res.data.violations.length, 1);
      } finally {
        teardown(dir);
      }
    });

    it('scans nested skills inside subdirectories (e.g. .agents/skills/subagent/SKILL.md)', async () => {
      const dir = createTmpProject({
        '.agents/skills/onboarding/SKILL.md': '# Onboarding\nUnattended autonomous script with zero manual gates.\n',
        '.agents/skills/publisher/SKILL.md': '# Publisher\nRequires human approval before broadcast.\n'
      });
      try {
        const res = await checkHitl(dir);
        assert.strictEqual(res.exitCode, 1, 'Should fail because onboarding skill lacks HITL');
        assert.strictEqual(res.data.violations.length, 1);
        assert.ok(res.data.violations[0].file.includes('onboarding'));
      } finally {
        teardown(dir);
      }
    });
  });

  describe('check_domain_data', () => {
    it('passes on valid json with null metrics for pending posts', async () => {
      const dir = createTmpProject({
        'output/content.json': JSON.stringify({
          posts: [
            { id: 1, title: 'Test post', status: 'pending', metrics: { impressions: null, likes: null } }
          ]
        })
      });
      try {
        const res = await checkDomainData(dir);
        assert.strictEqual(res.exitCode, 0);
      } finally {
        teardown(dir);
      }
    });

    it('fails when pending post has fake non-null numbers in metrics', async () => {
      const dir = createTmpProject({
        'output/content.json': JSON.stringify({
          posts: [
            { id: 1, title: 'Hallucinated post', status: 'pending', metrics: { impressions: 14200, likes: 350 } }
          ]
        })
      });
      try {
        const res = await checkDomainData(dir);
        assert.strictEqual(res.exitCode, 1);
        assert.strictEqual(res.data.violations.length, 1);
      } finally {
        teardown(dir);
      }
    });
  });

  describe('check_test_calendar_sync', () => {
    it('skips gracefully when templates/content-calendar or tests/ directory does not exist', async () => {
      const dir = createTmpProject({});
      try {
        const res = await checkTestCalendarSync(dir);
        assert.strictEqual(res.exitCode, 0);
        assert.strictEqual(res.skipped, true);
      } finally {
        teardown(dir);
      }
    });

    it('auto-synchronizes files from templates/content-calendar to tests/ when differing', async () => {
      const dir = createTmpProject({
        'templates/content-calendar/index.html': '<html><body>Template V2</body></html>',
        'templates/content-calendar/data.js': 'const data = { v: 2 };',
        'tests/index.html': '<html><body>Old Test V1</body></html>',
        'tests/data.js': 'const data = { v: 1 };'
      });
      try {
        const res = await checkTestCalendarSync(dir);
        assert.strictEqual(res.exitCode, 0);
        assert.strictEqual(res.skipped, false);
        assert.ok(res.data.syncedFiles.includes('index.html'));
        assert.ok(res.data.syncedFiles.includes('data.js'));

        // Verify files were actually overwritten in tests/
        const newTestHtml = fs.readFileSync(path.join(dir, 'tests', 'index.html'), 'utf-8');
        assert.strictEqual(newTestHtml, '<html><body>Template V2</body></html>');
      } finally {
        teardown(dir);
      }
    });

    it('passes cleanly when test calendar is already 100% in sync', async () => {
      const dir = createTmpProject({
        'templates/content-calendar/index.html': '<html><body>Sync OK</body></html>',
        'templates/content-calendar/data.js': 'const data = {};',
        'tests/index.html': '<html><body>Sync OK</body></html>',
        'tests/data.js': 'const data = {};',
        'tests/mock-data.js': 'const data = {};'
      });
      try {
        const res = await checkTestCalendarSync(dir);
        assert.strictEqual(res.exitCode, 0);
        assert.strictEqual(res.skipped, false);
        assert.strictEqual(res.data.syncedFiles.length, 0);
        assert.ok(res.data.message.includes('100% in sync'));
      } finally {
        teardown(dir);
      }
    });
  });
});
