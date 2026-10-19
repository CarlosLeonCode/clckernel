/**
 * sdds/onboarding: right after an install the product says what to do next,
 * in the terminal (Next steps block) and inside every AI harness (the
 * "First session after install" section of the generated AGENTS.md).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown, git } = require('./helpers');
const { generateHarness } = require('../src/generator');
const { autoDetectStack } = require('../src/detector');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const ADAPTERS_DIR = path.join(ROOT, 'src', 'adapters');
const SECTION = '## First session after install';
const NEXT_JS = { 'package.json': JSON.stringify({ name: 'web', private: true, dependencies: { next: '^14.0.0' } }) };
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function env() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) out[key] = value;
  }
  return { ...out, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', CI: '1' };
}

function cli(args, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, env: env(), encoding: 'utf-8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}`.replace(ANSI, '') };
}

function gitInit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir, env: env() });
}

/** The Next steps block (from its title to the end of the output). */
function nextSteps(out) {
  const at = out.indexOf('Next steps');
  return at === -1 ? '' : out.slice(at);
}

describe('onboarding — terminal Next steps after install', () => {
  it('a real install in a git repo prints the steps, the harnesses written and an active hook', () => {
    const dir = createTmpProject(NEXT_JS);
    try {
      gitInit(dir);
      const { status, out } = cli([dir, '--yes'], dir);
      assert.strictEqual(status, 0, out);
      const block = nextSteps(out);
      assert.ok(block, `no Next steps block in:\n${out}`);
      assert.match(block, /git add -A && git commit -m "chore: install clckernel"/);
      assert.match(block, /pre-commit hook \(\.githooks\/pre-commit\) runs on this commit/);
      for (const name of ['Claude Code (CLAUDE.md)', 'Gemini (GEMINI.md)', 'Cursor', 'Copilot', 'Antigravity']) {
        assert.ok(block.includes(name), `missing ${name} in:\n${block}`);
      }
      assert.ok(!block.includes('Windsurf'), 'Windsurf mirror is not written by the default install');
      assert.match(block, /clckernel start/);
      assert.doesNotMatch(block, /npx clckernel start/);
      assert.match(block, /npx clckernel audit/);
      assert.match(block, /tools\/guards\//);
      assert.match(block, /npx clckernel update --dry-run/);
    } finally {
      teardown(dir);
    }
  });

  it('outside a git repository step 1 says how to activate the hook', () => {
    const dir = createTmpProject(NEXT_JS);
    try {
      const { status, out } = cli([dir, '--yes'], dir);
      assert.strictEqual(status, 0, out);
      const block = nextSteps(out);
      assert.match(block, /not active/);
      assert.match(block, /git init && git config core\.hooksPath \.githooks/);
      assert.doesNotMatch(block, /runs on this commit/);
    } finally {
      teardown(dir);
    }
  });

  it('a multi-part repo says the hook runs every part from the root', () => {
    const dir = createTmpProject({ ...NEXT_JS, 'backend/requirements.txt': 'fastapi\n' });
    try {
      gitInit(dir);
      const { status, out } = cli([dir, '--yes'], dir);
      assert.strictEqual(status, 0, out);
      assert.match(nextSteps(out), /^ {5}The hook runs the checks of every part \(\., backend\) from the repository root\.$/m);
    } finally {
      teardown(dir);
    }
  });

  it('lists only the harnesses whose mirrors were written', () => {
    const dir = createTmpProject({ ...NEXT_JS, '.clckernel.yaml': 'mirrors:\n  list:\n    - CLAUDE.md\n' });
    try {
      gitInit(dir);
      const { status, out } = cli([dir, '--yes'], dir);
      assert.strictEqual(status, 0, out);
      const block = nextSteps(out);
      assert.match(block, /Claude Code \(CLAUDE\.md\)/);
      for (const name of ['Gemini', 'Cursor', 'Copilot', 'Antigravity']) {
        assert.ok(!block.includes(name), `${name} listed although its mirror was not written`);
      }
    } finally {
      teardown(dir);
    }
  });

  it('--dry-run prints no Next steps', () => {
    const dir = createTmpProject(NEXT_JS);
    try {
      gitInit(dir);
      const { status, out } = cli([dir, '--yes', '--dry-run'], dir);
      assert.strictEqual(status, 0, out);
      assert.strictEqual(nextSteps(out), '');
    } finally {
      teardown(dir);
    }
  });
});

describe('onboarding — update Next steps only when something needs attention', () => {
  it('a clean update prints no Next steps', () => {
    const dir = createTmpProject(NEXT_JS);
    try {
      gitInit(dir);
      assert.strictEqual(cli([dir, '--yes'], dir).status, 0);
      const { status, out } = cli(['update', dir], dir);
      assert.strictEqual(status, 0, out);
      assert.strictEqual(nextSteps(out), '');
    } finally {
      teardown(dir);
    }
  });

  it('an update that protects a locally edited file says to review the .clckernel-new copy', () => {
    const dir = createTmpProject(NEXT_JS);
    try {
      gitInit(dir);
      assert.strictEqual(cli([dir, '--yes'], dir).status, 0);
      fs.appendFileSync(path.join(dir, 'tools', 'scan_secrets.js'), '\n// local edit\n');
      const { status, out } = cli(['update', dir], dir);
      assert.strictEqual(status, 0, out);
      const block = nextSteps(out);
      assert.ok(block, `no Next steps block in:\n${out}`);
      assert.match(block, /tools\/scan_secrets\.js\.clckernel-new/);
    } finally {
      teardown(dir);
    }
  });
});

function adapters() {
  return fs.readdirSync(ADAPTERS_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'base.js')
    .map((f) => ({ file: f, adapter: new (require(path.join(ADAPTERS_DIR, f)))() }));
}

describe('onboarding — every generated AGENTS.md has the First session section', () => {
  for (const { file, adapter } of adapters()) {
    it(`${file}`, () => {
      const dir = createTmpProject({});
      try {
        adapter.provision(dir, {});
        const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        assert.ok(text.includes(SECTION), `${file} AGENTS.md has no First session section`);
        assert.match(text, /tools\/\.clckernel-managed\.json/);
        assert.match(text, /reference\/start\.md/);
        assert.match(text, /STOP/);
      } finally {
        teardown(dir);
      }
    });
  }

  for (const projectType of ['backend', 'frontend', 'unknown']) {
    it(`fallback ${projectType}`, () => {
      const dir = createTmpProject({});
      const warn = console.warn;
      try {
        console.warn = () => {};
        generateHarness(dir, { projectType, framework: 'Generic', testRunner: 'npm test', adapter: null });
        assert.ok(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8').includes(SECTION));
      } finally {
        console.warn = warn;
        teardown(dir);
      }
    });
  }

  it('multi-part', () => {
    const dir = createTmpProject({ 'package.json': JSON.stringify({ name: 'x', dependencies: { next: '14' } }), 'backend/requirements.txt': 'fastapi\n' });
    const warn = console.warn;
    try {
      git(dir, 'init', '-q');
      const config = autoDetectStack(dir);
      assert.strictEqual(config.parts.length, 2);
      console.warn = () => {};
      generateHarness(dir, config);
      assert.ok(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8').includes(SECTION));
    } finally {
      console.warn = warn;
      teardown(dir);
    }
  });
});

describe('onboarding — the skill triggers on the first session', () => {
  it('SKILL.md description mentions the first session after install', () => {
    const skill = fs.readFileSync(path.join(ROOT, '.agents', 'skills', 'clckernel_cli', 'SKILL.md'), 'utf-8');
    const frontmatter = skill.split('---')[1];
    assert.match(frontmatter, /first session after install/);
  });
});

describe('onboarding — .gitignore names legacy artifacts only when they exist', () => {
  it('a fresh install adds no clc_forge or resolved-config entry', () => {
    const dir = createTmpProject(NEXT_JS);
    const warn = console.warn;
    try {
      console.warn = () => {};
      generateHarness(dir, autoDetectStack(dir));
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
      assert.doesNotMatch(content, /clc_forge/);
      assert.doesNotMatch(content, /resolved\.json/);
      assert.match(content, /\.agents\/skills\/clckernel_cli\//);
    } finally {
      console.warn = warn;
      teardown(dir);
    }
  });

  it('a project with the legacy clc_forge_cli skill still gets its entry', () => {
    const dir = createTmpProject({ ...NEXT_JS, '.agents/skills/clc_forge_cli/SKILL.md': '# legacy\n' });
    const warn = console.warn;
    try {
      console.warn = () => {};
      generateHarness(dir, autoDetectStack(dir));
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
      assert.match(content, /^\.agents\/skills\/clc_forge_cli\/$/m);
      assert.doesNotMatch(content, /resolved\.json/);
    } finally {
      console.warn = warn;
      teardown(dir);
    }
  });

  it('a project with a legacy resolved config still gets its entry', () => {
    const dir = createTmpProject({ ...NEXT_JS, '.clc-forge.resolved.json': '{}\n' });
    const warn = console.warn;
    try {
      console.warn = () => {};
      generateHarness(dir, autoDetectStack(dir));
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
      assert.match(content, /^\.clc-forge\.resolved\.json$/m);
      assert.doesNotMatch(content, /^\.clckernel\.resolved\.json$/m);
    } finally {
      console.warn = warn;
      teardown(dir);
    }
  });
});

describe('onboarding — this repository describes itself', () => {
  const text = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf-8');

  it('AGENTS.md names node:test and the hook guards, not Pytest or FastAPI', () => {
    assert.match(text, /node:test/);
    assert.match(text, /verify_tdd\.js/);
    assert.match(text, /scan_secrets\.js/);
    assert.match(text, /build-known-hashes\.js/);
    assert.match(text, /single_stack_snapshot\.json/);
    assert.doesNotMatch(text, /Pytest|FastAPI/);
    assert.doesNotMatch(text, /no verifier installed/);
  });
});
