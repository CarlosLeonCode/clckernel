/**
 * sdds/agent-os-generic: check_placeholders flags forgotten placeholders in
 * changed .md/.yml/.yaml/.json files; `{{...}}` is legitimate in templates/.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');
const checkPlaceholders = require('../tools/check_placeholders');

const SCRIPT = path.join(__dirname, '..', 'tools', 'check_placeholders.js');

// Built at runtime so this file never carries the markers literally.
const TODO = ['TO', 'DO'].join('');
const FIXME = ['FIX', 'ME'].join('');
const TBD = ['T', 'BD'].join('');
const LOREM = ['Lorem', 'ipsum'].join(' ');

async function run(committed, staged) {
  const dir = createGitRepo(committed, staged);
  try {
    return await checkPlaceholders(dir);
  } finally {
    teardown(dir);
  }
}

describe('check_placeholders', () => {
  it(`fails a playbook with a ${TODO}`, async () => {
    const res = await run({}, { 'playbooks/onboarding.md': `# Onboarding\n\n${TODO}: write the steps\n` });
    assert.strictEqual(res.name, 'check_placeholders');
    assert.strictEqual(res.exitCode, 1);
    assert.deepStrictEqual(
      { file: res.data.violations[0].file, line: res.data.violations[0].line },
      { file: 'playbooks/onboarding.md', line: 3 },
    );
  });

  for (const [label, text, file] of [
    [FIXME, `steps: "${FIXME}"\n`, 'rules/flow.yml'],
    [TBD, `{ "owner": "${TBD}" }\n`, 'data/owners.json'],
    ['lorem ipsum', `${LOREM} dolor sit amet.\n`, 'prompts/intro.md'],
    ['unresolved {{...}}', 'Hello {{client_name}}, welcome.\n', 'playbooks/welcome.md'],
  ]) {
    it(`fails ${label} outside templates/`, async () => {
      const res = await run({}, { [file]: text });
      assert.strictEqual(res.exitCode, 1, JSON.stringify(res.data));
    });
  }

  it('passes {{name}} inside templates/', async () => {
    const res = await run({}, { 'templates/welcome.md': 'Hello {{name}}, welcome.\n' });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
  });

  it('ignores GitHub Actions expressions, code spans and fenced code', async () => {
    const res = await run({}, {
      '.github/workflows/ci.yml': 'env:\n  TOKEN: ${{ secrets.TOKEN }}\n',
      'playbooks/howto.md': `Use \`{{name}}\` in templates.\n\n\`\`\`\n${TODO} example\n\`\`\`\n`,
    });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
  });

  it('does not flag words that merely contain the markers', async () => {
    const res = await run({}, { 'playbooks/todos.md': '# Todos\nThe TODOS list and TBDX code are fine.\n' });
    assert.strictEqual(res.exitCode, 0, JSON.stringify(res.data));
  });

  it('skips when no matching file changed', async () => {
    const res = await run({}, { 'src/app.js': `// ${TODO}\n` });
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.skipped, true);
  });

  it('standalone run prints JSON and exits with the exit code', () => {
    const dir = createGitRepo({}, { 'README.md': `${TODO}\n` });
    try {
      const out = spawnSync(process.execPath, [SCRIPT, dir], { cwd: dir, encoding: 'utf-8' });
      assert.strictEqual(out.status, 1);
      assert.strictEqual(JSON.parse(out.stdout).name, 'check_placeholders');
    } finally {
      teardown(dir);
    }
  });
});
