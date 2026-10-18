/**
 * verify_tdd.js / verify_tdd.py ignore PURE renames: a file whose content is
 * identical to a file removed in the same change (git R100) is not a code
 * change, and a pure-renamed test is not test evidence. A rename with any
 * content change is still a code change under the full red->green rules.
 * Covers the `clckernel update` move of the old domain guards to tools/guards/.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { teardown, registryPaths } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const LEGACY_DIR = path.join(__dirname, 'fixtures', 'legacy_guards');
const LEGACY_GUARDS = ['check_test_calendar_sync.js', 'check_domain_data.js'];

/** No git variables inherited from a running hook, no user/system git config. */
function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  delete env.NODE_TEST_CONTEXT;
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', CI: '1', CLC_TDD_TIMEOUT: '60' };
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, env: childEnv(), encoding: 'utf-8' });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}`, stdout: res.stdout || '' };
}

function git(dir, ...args) {
  const res = run('git', args, dir);
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed:\n${res.output}`);
  return res.stdout.trim();
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }
}

function initRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-tdd-renames-'));
  write(dir, files);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Renames');
  git(dir, 'config', 'user.email', 'renames@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'base');
  return dir;
}

const VERIFIERS = [
  {
    lang: 'js',
    cmd: process.execPath,
    script: path.join(ROOT, 'tools', 'verify_tdd.js'),
    files: {
      'src/lib.js': 'module.exports = (a, b) => a + b;\n',
      'test/lib.test.js': "require('node:test')('adds', () => require('assert').strictEqual(require('../src/lib')(1, 2), 3));\n",
    },
    code: ['src/lib.js', 'src/moved/lib.js'],
    test: ['test/lib.test.js', 'test/moved.test.js'],
  },
  {
    lang: 'py',
    cmd: 'python3',
    script: path.join(ROOT, 'tools', 'verify_tdd.py'),
    files: {
      'calc/__init__.py': '',
      'calc/ops.py': 'def add(a, b):\n    return a + b\n',
      'tests/test_ops.py': 'from calc import ops\n\n\ndef test_add():\n    assert ops.add(2, 3) == 5\n',
    },
    code: ['calc/ops.py', 'calc/moved_ops.py'],
    test: ['tests/test_ops.py', 'tests/test_moved.py'],
  },
];

function verify(v, dir) {
  const res = run(v.cmd, [v.script, dir], dir);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    assert.fail(`verify_tdd printed no JSON (status ${res.status}):\n${res.output}`);
  }
  return { status: res.status, message: parsed.data.message, raw: res.output };
}

function withRepo(v, fn) {
  const dir = initRepo(v.files);
  try {
    fn(dir);
  } finally {
    teardown(dir);
  }
}

for (const v of VERIFIERS) {
  describe(`verify_tdd.${v.lang} pure renames`, () => {
    it('staged git mv with identical content => exit 0, nothing to verify', () => {
      withRepo(v, (dir) => {
        fs.mkdirSync(path.dirname(path.join(dir, v.code[1])), { recursive: true });
        git(dir, 'mv', v.code[0], v.code[1]);
        const res = verify(v, dir);
        assert.strictEqual(res.status, 0, res.raw);
        assert.match(res.message, /only pure renames/i, res.raw);
      });
    });

    it('committed git mv with identical content (last-commit mode) => exit 0', () => {
      withRepo(v, (dir) => {
        fs.mkdirSync(path.dirname(path.join(dir, v.code[1])), { recursive: true });
        git(dir, 'mv', v.code[0], v.code[1]);
        git(dir, 'commit', '-q', '--no-verify', '-m', 'move');
        const res = verify(v, dir);
        assert.strictEqual(res.status, 0, res.raw);
        assert.match(res.message, /only pure renames/i, res.raw);
      });
    });

    it('git mv plus a content change without a test => exit 1, no test evidence', () => {
      withRepo(v, (dir) => {
        fs.mkdirSync(path.dirname(path.join(dir, v.code[1])), { recursive: true });
        git(dir, 'mv', v.code[0], v.code[1]);
        fs.appendFileSync(path.join(dir, v.code[1]), v.lang === 'js' ? '// changed\n' : '# changed\n');
        git(dir, 'add', '-A');
        const res = verify(v, dir);
        assert.strictEqual(res.status, 1, res.raw);
        assert.match(res.message, /no test evidence/i, res.raw);
      });
    });

    it('a pure-renamed test is not test evidence for a code change', () => {
      withRepo(v, (dir) => {
        git(dir, 'mv', v.test[0], v.test[1]);
        fs.appendFileSync(path.join(dir, v.code[0]), v.lang === 'js' ? '// changed\n' : '# changed\n');
        git(dir, 'add', '-A');
        const res = verify(v, dir);
        assert.strictEqual(res.status, 1, res.raw);
        assert.match(res.message, /no test evidence/i, res.raw);
      });
    });
  });
}

describe('clckernel update moving the old domain guards does not block the next commit', () => {
  it('real git commit after update: exit 0 and the moved guard runs in the hook', () => {
    const dir = initRepo({
      'skills/research/SKILL.md': '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n',
      'playbooks/onboarding.md': '# Onboarding\n\n## Human checkpoint\nConfirm each step with the operator.\n',
    });
    try {
      const installed = run(process.execPath, [CLI, dir, '--yes'], dir);
      assert.strictEqual(installed.status, 0, `install failed:\n${installed.output}`);
      // An older install: the domain guards shipped in tools/ and were managed.
      const registryFile = path.join(dir, 'tools', '.clckernel-managed.json');
      // An older install: the registry was a list of paths.
      const registry = registryPaths(JSON.parse(fs.readFileSync(registryFile, 'utf-8')));
      for (const file of LEGACY_GUARDS) {
        fs.copyFileSync(path.join(LEGACY_DIR, file), path.join(dir, 'tools', file));
        registry.push(`tools/${file}`);
      }
      fs.writeFileSync(registryFile, JSON.stringify(registry.sort(), null, 2) + '\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '--no-verify', '-m', 'legacy install');

      const updated = run(process.execPath, [CLI, 'update', dir], dir);
      assert.strictEqual(updated.status, 0, `update failed:\n${updated.output}`);
      assert.ok(fs.existsSync(path.join(dir, 'tools', 'guards', 'check_test_calendar_sync.js')), updated.output);
      git(dir, 'add', '-A');
      const commit = run('git', ['commit', '-m', 'chore: clckernel update'], dir);
      assert.strictEqual(commit.status, 0, `the commit after update must pass the hook:\n${commit.output}`);
      assert.match(commit.output, /project guard tools\/guards\/check_test_calendar_sync\.js/, commit.output);
    } finally {
      teardown(dir);
    }
  });
});
