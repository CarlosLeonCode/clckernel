const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('CLC Kernel Skills & Playbooks Structure', () => {
  const rootDir = process.cwd();
  const skillDir = path.join(rootDir, '.agents/skills/clckernel_cli');
  const skillPath = path.join(skillDir, 'SKILL.md');

  it('SKILL.md exists and contains valid metadata and routing table', () => {
    assert.strictEqual(fs.existsSync(skillPath), true, 'SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    
    assert.match(content, /^---\n/, 'Must start with frontmatter');
    assert.match(content, /name:\s*clckernel_cli/, 'Must declare skill name');
    assert.match(content, /description:/, 'Must declare description');
    assert.match(content, /## Commands/, 'Must have a Commands table');
    assert.match(content, /\| Command \| Category \| Description \| Reference \|/, 'Table must contain Reference column');
  });

  it('all referenced playbooks in SKILL.md exist on disk', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    const referenceMatches = [...content.matchAll(/\[reference\/([a-zA-Z0-9_-]+\.md)\]\(reference\/([a-zA-Z0-9_-]+\.md)\)/g)];
    
    assert.ok(referenceMatches.length >= 5, 'Must reference at least 5 playbooks (start, guard, phase, audit, doctor)');

    for (const match of referenceMatches) {
      const filename = match[1];
      const playbookPath = path.join(skillDir, 'reference', filename);
      assert.strictEqual(
        fs.existsSync(playbookPath),
        true,
        `Referenced playbook ${filename} must exist on disk`
      );
    }
  });
});
