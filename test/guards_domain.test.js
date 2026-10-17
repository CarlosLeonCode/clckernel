const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, createGitRepo, teardown } = require('./helpers');
const checkSymlinks = require('../tools/check_symlinks');
const checkHitl = require('../tools/check_hitl');
const checkDomainData = require('../tools/check_domain_data');
const checkTestCalendarSync = require('../tools/check_test_calendar_sync');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

/** Map of relative path -> sha256 for every file under dir (detects writes and new files). */
function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

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

    it('reports drift as a failure and does NOT modify any file (read-only by default)', async () => {
      const dir = createTmpProject({
        'templates/content-calendar/index.html': '<html><body>Template V2</body></html>',
        'templates/content-calendar/data.js': 'const data = {\n    "channelProfiles": {\n      "ig": 1\n    }\n};',
        'tests/index.html': '<html><body>Old Test V1</body></html>',
        'tests/data.js': 'const data = { v: 1 };',
        'tests/mock-content.json': '{\n    "pillarMix": {\n      "a": 1\n    }\n}\n'
      });
      try {
        const before = hashTree(dir);
        const res = await checkTestCalendarSync(dir);
        assert.strictEqual(res.exitCode, 1, 'drift must fail the check');
        assert.strictEqual(res.skipped, false);
        const files = res.data.violations.map(v => v.file);
        assert.ok(files.includes('index.html'), 'lists index.html as out of sync');
        assert.ok(files.includes('data.js'), 'lists data.js as out of sync');
        assert.ok(files.includes('mock-data.js'), 'lists missing mock-data.js as out of sync');
        assert.ok(files.includes('mock-content.json'), 'lists mock-content.json missing channelProfiles');
        assert.ok(res.data.message.includes('--fix'), 'message tells how to fix');
        assert.deepStrictEqual(hashTree(dir), before, 'no file may be created or modified');
      } finally {
        teardown(dir);
      }
    });

    it('syncs files only when run standalone with --fix', () => {
      const dir = createTmpProject({
        'templates/content-calendar/index.html': '<html><body>Template V2</body></html>',
        'templates/content-calendar/data.js': 'const data = {\n    "channelProfiles": {\n      "ig": 1\n    }\n};',
        'tests/index.html': '<html><body>Old Test V1</body></html>',
        'tests/data.js': 'const data = { v: 1 };',
        'tests/mock-content.json': '{\n    "pillarMix": {\n      "a": 1\n    }\n}\n'
      });
      try {
        const script = path.join(__dirname, '..', 'tools', 'check_test_calendar_sync.js');
        const out = execFileSync(process.execPath, [script, dir, '--fix'], { encoding: 'utf-8' });
        const res = JSON.parse(out);
        assert.strictEqual(res.exitCode, 0);
        assert.ok(res.data.syncedFiles.includes('index.html'));
        assert.ok(res.data.syncedFiles.includes('data.js'));
        assert.ok(res.data.syncedFiles.includes('mock-data.js'));
        assert.ok(res.data.syncedFiles.includes('mock-content.json'));

        const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
        assert.strictEqual(read('tests/index.html'), '<html><body>Template V2</body></html>');
        assert.strictEqual(read('tests/mock-data.js'), read('templates/content-calendar/data.js'));
        assert.ok(read('tests/mock-content.json').includes('"channelProfiles"'), 'hydrates channelProfiles');
      } finally {
        teardown(dir);
      }
    });

    it('standalone run without --fix exits 1 on drift and writes nothing', () => {
      const dir = createTmpProject({
        'templates/content-calendar/index.html': '<html><body>Template V2</body></html>',
        'tests/index.html': '<html><body>Old Test V1</body></html>'
      });
      try {
        const before = hashTree(dir);
        const script = path.join(__dirname, '..', 'tools', 'check_test_calendar_sync.js');
        const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf-8' });
        assert.strictEqual(run.status, 1);
        assert.deepStrictEqual(hashTree(dir), before);
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
