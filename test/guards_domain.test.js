const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, createGitRepo, teardown } = require('./helpers');
const checkSymlinks = require('../tools/check_symlinks');
const checkHitl = require('../tools/check_hitl');

describe('Agent-OS Safeguards', () => {
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

    it('fails when a mirror symlink points to a file other than AGENTS.md', async () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'OTHER.md': '# Other rules\n'
      });
      try {
        fs.symlinkSync('OTHER.md', path.join(dir, 'CLAUDE.md'));
        const res = await checkSymlinks(dir);
        assert.strictEqual(res.exitCode, 1);
        assert.strictEqual(res.data.violations[0].file, 'CLAUDE.md');
        assert.match(res.data.violations[0].message, /AGENTS\.md/);
      } finally {
        teardown(dir);
      }
    });

    it('passes an identical copy of AGENTS.md and fails a diverging copy', async () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'GEMINI.md': '# AGENTS\n',
        '.cursorrules': '# stale rules\n'
      });
      try {
        const res = await checkSymlinks(dir);
        assert.strictEqual(res.exitCode, 1);
        assert.deepStrictEqual(res.data.violations.map(v => v.file), ['.cursorrules']);
      } finally {
        teardown(dir);
      }
    });
  });

  describe('check_hitl', () => {
    // sdds/agent-os-generic: an explicit marker is required (a `HITL:` line or a
    // `## Human checkpoint` / `## HITL` section); a keyword such as "review" no
    // longer passes. Skills and playbooks changed in the snapshot are checked.
    async function runHitl(committed, staged) {
      const dir = createGitRepo(committed, staged);
      try {
        return await checkHitl(dir);
      } finally {
        teardown(dir);
      }
    }

    it('skips when no skill or playbook changed', async () => {
      const res = await runHitl({}, { 'README.md': '# readme\n' });
      assert.strictEqual(res.exitCode, 0);
      assert.strictEqual(res.skipped, true);
    });

    it('fails a playbook that mentions "review" but has no explicit marker', async () => {
      const res = await runHitl({}, {
        'playbooks/publish.md': '# Publish\nAsk for a review and confirm before publishing.\n'
      });
      assert.strictEqual(res.exitCode, 1);
      assert.strictEqual(res.data.violations[0].file, 'playbooks/publish.md');
    });

    it('passes a playbook with a HITL: line', async () => {
      const res = await runHitl({}, {
        'playbooks/publish.md': '# Publish\n\nHITL: the operator approves the draft before it is published.\n'
      });
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
      assert.strictEqual(res.skipped, false);
    });

    it('passes skills with a "## Human checkpoint" or "## HITL" section', async () => {
      const res = await runHitl({}, {
        'skills/calendar/SKILL.md': '---\nname: calendar\ndescription: d\n---\n# Calendar\n\n## Human checkpoint\nWait for approval.\n',
        '.agents/skills/publisher/SKILL.md': '# Publisher\n\n## HITL\nThe operator confirms.\n'
      });
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
    });

    it('fails a skill without marker and names it (nested .agents/skills/<name>/SKILL.md)', async () => {
      const res = await runHitl({}, {
        '.agents/skills/onboarding/SKILL.md': '# Onboarding\nUnattended autonomous script with zero manual gates.\n',
        '.agents/skills/publisher/SKILL.md': '# Publisher\nHITL: requires human approval before broadcast.\n'
      });
      assert.strictEqual(res.exitCode, 1, 'Should fail because onboarding skill lacks HITL');
      assert.strictEqual(res.data.violations.length, 1);
      assert.ok(res.data.violations[0].file.includes('onboarding'));
    });

    it('a marker inside a code fence does not count', async () => {
      const res = await runHitl({}, {
        'playbooks/publish.md': '# Publish\n\n```\nHITL: example only\n```\n'
      });
      assert.strictEqual(res.exitCode, 1);
    });

    it('ignores skill reference files, READMEs and harness skills', async () => {
      const res = await runHitl({}, {
        'skills/research/reference/notes.md': '# Notes\n',
        'playbooks/README.md': '# Index of playbooks\n',
        '.agents/skills/clckernel_cli/SKILL.md': '# harness skill\n'
      });
      assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
    });

    it('reads the snapshot, not the working copy', async () => {
      const dir = createGitRepo({}, { 'playbooks/publish.md': '# Publish\nNo marker staged.\n' });
      try {
        fs.writeFileSync(path.join(dir, 'playbooks', 'publish.md'), '# Publish\nHITL: only on disk.\n');
        const res = await checkHitl(dir);
        assert.strictEqual(res.exitCode, 1);
      } finally {
        teardown(dir);
      }
    });
  });
});
