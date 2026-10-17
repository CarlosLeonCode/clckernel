/**
 * sdds/agent-os-generic (Plan TDD item 8): a generic Agent-OS goes through the
 * real hook. The install commit passes; a skill without `description` is
 * blocked. Real `git commit` calls (never --no-verify) in a throwaway repo,
 * same setup as first_commit_e2e.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

/** No git variables inherited from a running hook, no user/system git config. */
function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', CI: '1' };
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (err) => resolve({ status: null, output: `${output}${err.message}` }));
    child.on('close', (status) => resolve({ status, output }));
  });
}

async function git(dir, ...args) {
  const res = await run('git', args, dir);
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed:\n${res.output}`);
  return res.output.trim();
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }
}

async function commitAll(dir, message) {
  await git(dir, 'add', '-A');
  return run('git', ['commit', '-m', message], dir);
}

const AGENT_OS = {
  'skills/research/SKILL.md': [
    '---',
    'name: research',
    'description: Researches a topic and drafts a brief for the operator.',
    '---',
    '# Research',
    '',
    'Follow [the style rules](../../rules/style.md).',
    '',
    'HITL: the operator approves the brief before it is shared.',
    '',
  ].join('\n'),
  'playbooks/onboarding.md': '# Onboarding\n\n## Human checkpoint\nConfirm each step with the operator.\n',
  'rules/style.md': '# Style\n\nPlain, direct sentences.\n',
};

describe('generic Agent-OS through the real hook', () => {
  it('install commit passes; a skill without description is blocked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-agent-os-'));
    try {
      write(dir, AGENT_OS);
      await git(dir, 'init', '-q');
      await git(dir, 'config', 'user.name', 'Agent OS');
      await git(dir, 'config', 'user.email', 'agent-os@example.com');
      await git(dir, 'add', '-A');
      await git(dir, 'commit', '-q', '--no-verify', '-m', 'project');

      const installed = await run(process.execPath, [CLI, dir, '--yes'], dir);
      assert.strictEqual(installed.status, 0, `install failed:\n${installed.output}`);
      assert.match(installed.output, /Agent-OS/, `not detected as Agent-OS:\n${installed.output}`);

      const first = await commitAll(dir, 'install');
      assert.strictEqual(first.status, 0, `install commit failed:\n${first.output}`);
      assert.ok(first.output.includes('Running CLC Kernel'), `the hook did not run:\n${first.output}`);

      write(dir, { 'skills/broken/SKILL.md': '---\nname: broken\n---\n# Broken\n\nHITL: confirm.\n' });
      const second = await commitAll(dir, 'add broken skill');
      assert.notStrictEqual(second.status, 0, `commit must be blocked:\n${second.output}`);
      assert.match(second.output, /skills\/broken\/SKILL\.md/, `blocked for the wrong reason:\n${second.output}`);
      assert.match(second.output, /description/, `blocked for the wrong reason:\n${second.output}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
