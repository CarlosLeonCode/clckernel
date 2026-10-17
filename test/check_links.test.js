/**
 * sdds/agent-os-generic: check_links verifies that relative links in every
 * changed Markdown file point to files present in the snapshot.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');
const checkLinks = require('../tools/check_links');

const SCRIPT = path.join(__dirname, '..', 'tools', 'check_links.js');

async function run(committed, staged) {
  const dir = createGitRepo(committed, staged);
  try {
    return await checkLinks(dir);
  } finally {
    teardown(dir);
  }
}

describe('check_links', () => {
  it('fails a link to a file that does not exist', async () => {
    const res = await run({}, { 'playbooks/onboarding.md': 'See [the rules](../rules/missing.md).\n' });
    assert.strictEqual(res.name, 'check_links');
    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.data.violations[0].file, 'playbooks/onboarding.md');
    assert.strictEqual(res.data.violations[0].line, 1);
    assert.match(res.data.violations[0].message, /rules\/missing\.md/);
  });

  it('fails a broken image link', async () => {
    const res = await run({}, { 'docs/guide.md': '![diagram](img/flow.png)\n' });
    assert.strictEqual(res.exitCode, 1);
  });

  it('passes valid relative links, URLs, mailto, anchors and links inside code', async () => {
    const doc = [
      '# Onboarding',
      'Follow [the style rules](../rules/style.md#tone) and [the skill](/skills/research/SKILL.md).',
      'Folder link: [rules](../rules/).',
      'External: [site](https://example.com/x.md), [mail](mailto:team@example.com), [top](#onboarding).',
      'Inline code: `[x](nowhere.md)`.',
      '```md',
      '[inside a fence](does-not-exist.md)',
      '```',
      '~~~',
      '![also fenced](missing.png)',
      '~~~',
      '',
    ].join('\n');
    const res = await run(
      { 'rules/style.md': '# Style\n', 'skills/research/SKILL.md': '# r\n' },
      { 'playbooks/onboarding.md': doc },
    );
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
    assert.strictEqual(res.skipped, false);
  });

  it('reads the snapshot: a target that exists only in the working copy is broken', async () => {
    const dir = createGitRepo({}, { 'playbooks/onboarding.md': 'See [style](../rules/style.md).\n' });
    try {
      fs.mkdirSync(path.join(dir, 'rules'));
      fs.writeFileSync(path.join(dir, 'rules', 'style.md'), '# not staged\n');
      const res = await checkLinks(dir);
      assert.strictEqual(res.exitCode, 1);
    } finally {
      teardown(dir);
    }
  });

  it('skips when no Markdown file changed', async () => {
    const res = await run({}, { 'data/x.json': '{}\n' });
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.skipped, true);
  });

  it('standalone run prints JSON and exits with the exit code', () => {
    const dir = createGitRepo({}, { 'README.md': '[x](nope.md)\n' });
    try {
      const out = spawnSync(process.execPath, [SCRIPT, dir], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(out.status, 1);
      assert.strictEqual(JSON.parse(out.stdout).name, 'check_links');
    } finally {
      teardown(dir);
    }
  });
});
