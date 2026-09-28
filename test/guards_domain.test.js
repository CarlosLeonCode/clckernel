const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');
const checkSymlinks = require('../tools/check_symlinks');
const checkHitl = require('../tools/check_hitl');
const checkDomainData = require('../tools/check_domain_data');

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
});
