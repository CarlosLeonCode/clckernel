/**
 * sdds/agent-os-generic: check_skills validates the frontmatter of every
 * SKILL.md changed in the snapshot (name, description, uniqueness).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');
const checkSkills = require('../tools/check_skills');

const SCRIPT = path.join(__dirname, '..', 'tools', 'check_skills.js');

const skill = (name, description, body = '# Skill\n') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;

async function run(committed, staged) {
  const dir = createGitRepo(committed, staged);
  try {
    return await checkSkills(dir);
  } finally {
    teardown(dir);
  }
}

describe('check_skills', () => {
  it('passes a valid SKILL.md', async () => {
    const res = await run({}, { 'skills/research/SKILL.md': skill('research', 'Researches a topic and drafts a brief.') });
    assert.strictEqual(res.name, 'check_skills');
    assert.strictEqual(res.skipped, false);
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
    assert.deepStrictEqual(res.data.violations, []);
  });

  it('fails a SKILL.md without frontmatter', async () => {
    const res = await run({}, { 'skills/research/SKILL.md': '# Research\nNo frontmatter here.\n' });
    assert.strictEqual(res.exitCode, 1);
    assert.match(res.data.violations[0].message, /frontmatter/i);
  });

  it('fails a SKILL.md without description', async () => {
    const res = await run({}, { 'skills/research/SKILL.md': '---\nname: research\n---\n# Research\n' });
    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.data.violations[0].file, 'skills/research/SKILL.md');
    assert.match(res.data.violations[0].message, /description/);
  });

  it('fails an empty description and a name that is not lowercase with hyphens/underscores', async () => {
    const res = await run({}, { 'skills/Research/SKILL.md': '---\nname: Research Skill\ndescription: ""\n---\n' });
    assert.strictEqual(res.exitCode, 1);
    const messages = res.data.violations.map((v) => v.message).join('\n');
    assert.match(messages, /description/);
    assert.match(messages, /name/);
  });

  it('fails a description longer than 1024 characters', async () => {
    const res = await run({}, { 'skills/long/SKILL.md': skill('long', 'x'.repeat(1025)) });
    assert.strictEqual(res.exitCode, 1);
    assert.match(res.data.violations[0].message, /1024/);
  });

  it('reads a folded block description', async () => {
    const content = '---\nname: research\ndescription: >\n  Researches a topic\n  and drafts a brief.\n---\n';
    const res = await run({}, { 'skills/research/SKILL.md': content });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
  });

  it('fails a name already used by another skill of the repository (even an unchanged one)', async () => {
    const res = await run(
      { '.claude/skills/research/SKILL.md': skill('research', 'The original.') },
      { 'skills/research/SKILL.md': skill('research', 'A duplicate.') },
    );
    assert.strictEqual(res.exitCode, 1);
    assert.match(res.data.violations[0].message, /duplicate|already used/i);
    assert.match(res.data.violations[0].message, /\.claude\/skills\/research\/SKILL\.md/);
  });

  it('a folder that differs from the name is a warning, not an error', async () => {
    const res = await run({}, { 'skills/research-v2/SKILL.md': skill('research', 'Researches a topic.') });
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.data.warnings.length, 1);
    assert.match(res.data.warnings[0].message, /folder/);
  });

  it('ignores the skills the harness installs (clckernel_cli and the registry)', async () => {
    const res = await run({}, {
      '.agents/skills/clckernel_cli/SKILL.md': '# no frontmatter\n',
      'tools/.clckernel-managed.json': JSON.stringify(['skills/managed/SKILL.md', 'tools/.clckernel-managed.json']),
      'skills/managed/SKILL.md': '# managed, no frontmatter\n',
    });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
    assert.strictEqual(res.skipped, true);
  });

  it('reads the snapshot, not the working copy', async () => {
    const fs = require('fs');
    const dir = createGitRepo({}, { 'skills/research/SKILL.md': '# staged without frontmatter\n' });
    try {
      fs.writeFileSync(path.join(dir, 'skills/research/SKILL.md'), skill('research', 'Fixed only on disk.'));
      const res = await checkSkills(dir);
      assert.strictEqual(res.exitCode, 1);
    } finally {
      teardown(dir);
    }
  });

  it('standalone run prints JSON and exits with the exit code', () => {
    const dir = createGitRepo({}, { 'skills/research/SKILL.md': '---\nname: research\n---\n' });
    try {
      const out = spawnSync(process.execPath, [SCRIPT, dir], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(out.status, 1);
      assert.strictEqual(JSON.parse(out.stdout).name, 'check_skills');
    } finally {
      teardown(dir);
    }
  });
});
