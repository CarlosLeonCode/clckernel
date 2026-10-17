/**
 * sdds/agent-os-generic: a repository shaped like an agent operating system
 * (skills, playbooks, rules) is detected as Agent-OS and receives guards that
 * hold for any Agent-OS; domain guards are installed only when their
 * structure is present.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTmpProject, teardown } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const AgentOSAdapter = require('../src/adapters/agent-os');

const SKILL = '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n';
const PLAYBOOK = '# Onboarding\n\nHITL: confirm each step with the operator.\n';
const NEXT_PKG = JSON.stringify({ name: 'web', dependencies: { next: '14.0.0' } });

function detect(files) {
  const dir = createTmpProject(files);
  try {
    return autoDetectStack(dir);
  } finally {
    teardown(dir);
  }
}

describe('Agent-OS detection (generic structure)', () => {
  it('skills/<name>/SKILL.md + playbooks/ without package.json => Agent-OS', () => {
    const config = detect({ 'skills/research/SKILL.md': SKILL, 'playbooks/onboarding.md': PLAYBOOK });
    assert.strictEqual(config.projectType, 'agent-os');
  });

  for (const root of ['skills', '.agents/skills', '.claude/skills']) {
    it(`${root}/<name>/SKILL.md alone => Agent-OS`, () => {
      assert.strictEqual(detect({ [`${root}/research/SKILL.md`]: SKILL }).projectType, 'agent-os');
    });
  }

  for (const folder of ['playbooks', 'rules']) {
    it(`a ${folder}/ directory with Markdown alone => Agent-OS`, () => {
      assert.strictEqual(detect({ [`${folder}/style.md`]: '# Style\n' }).projectType, 'agent-os');
    });
  }

  it('the package.json keywords still detect Agent-OS (compatibility)', () => {
    const config = detect({ 'package.json': JSON.stringify({ name: 'laila-mos', keywords: ['marketing-os'] }) });
    assert.strictEqual(config.projectType, 'agent-os');
  });

  it('the same structure with a Next.js package.json => Next.js (the code stack wins)', () => {
    const config = detect({
      'package.json': NEXT_PKG,
      'skills/research/SKILL.md': SKILL,
      'playbooks/onboarding.md': PLAYBOOK,
    });
    assert.strictEqual(config.framework, 'Next.js (App Router)');
  });

  it('agent-os keywords plus a code stack => the code stack wins', () => {
    const pkg = JSON.stringify({ name: 'acme-agent-os', keywords: ['agent-os'], dependencies: { next: '14.0.0' } });
    assert.strictEqual(detect({ 'package.json': pkg }).framework, 'Next.js (App Router)');
  });

  it('an empty repository => unknown', () => {
    assert.strictEqual(detect({}).projectType, 'unknown');
  });

  it('the skill the harness installs (.agents/skills/clckernel_cli) is not a signal', () => {
    const config = detect({
      'README.md': '# generic\n',
      '.agents/skills/clckernel_cli/SKILL.md': '---\nname: clckernel_cli\ndescription: d\n---\n',
    });
    assert.strictEqual(config.projectType, 'unknown');
  });

  it('a flat skills/*.md file alone is no longer a signal', () => {
    assert.strictEqual(detect({ 'skills/notes.md': '# notes\n' }).projectType, 'unknown');
  });
});

/** Installs the harness the way the CLI does and returns the installed tool files. */
function install(files) {
  const dir = createTmpProject(files);
  const config = autoDetectStack(dir);
  assert.strictEqual(config.projectType, 'agent-os');
  const result = generateHarness(dir, config);
  const registry = JSON.parse(fs.readFileSync(path.join(dir, 'tools', '.clckernel-managed.json'), 'utf-8'));
  const hook = fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf-8');
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
  return { dir, result, registry, hook, agents };
}

describe('Agent-OS installation', () => {
  const GENERIC = { 'skills/research/SKILL.md': SKILL, 'playbooks/onboarding.md': PLAYBOOK, 'rules/style.md': '# Style\n' };

  it('a generic Agent-OS gets the generic guards and check_custom, not the calendar guards', () => {
    const { dir, result, registry, hook } = install(GENERIC);
    try {
      for (const guard of ['check_skills', 'check_links', 'check_placeholders', 'check_hitl', 'check_symlinks', 'check_custom', 'scan_secrets']) {
        assert.ok(result.installedGuards.includes(guard), `${guard} must be installed`);
        assert.ok(registry.includes(`tools/${guard}.js`), `${guard} must be in the registry`);
        assert.ok(hook.includes(`tools/${guard}.js`), `${guard} must run in the hook`);
      }
      for (const guard of ['check_domain_data', 'check_test_calendar_sync']) {
        assert.ok(!result.installedGuards.includes(guard), `${guard} must not be installed`);
        assert.ok(!fs.existsSync(path.join(dir, 'tools', `${guard}.js`)), `${guard}.js must not be copied`);
        assert.ok(!hook.includes(guard), `${guard} must not run in the hook`);
      }
      assert.ok(registry.includes('tools/yaml.js'), 'check_custom ships its YAML parser');
      assert.ok(registry.includes('tools/_changes.js'), 'diff-based guards ship the snapshot helper');
    } finally {
      teardown(dir);
    }
  });

  for (const calendar of ['templates/content-calendar/index.html', 'content-calendar/calendar.json']) {
    it(`with ${path.dirname(calendar)}/ the calendar guards are installed too`, () => {
      const { dir, result, registry, hook } = install({ ...GENERIC, [calendar]: '{}\n' });
      try {
        for (const guard of ['check_domain_data', 'check_test_calendar_sync']) {
          assert.ok(result.installedGuards.includes(guard), `${guard} must be installed`);
          assert.ok(registry.includes(`tools/${guard}.js`), `${guard} must be in the registry`);
          assert.ok(hook.includes(`tools/${guard}.js`), `${guard} must run in the hook`);
        }
        assert.ok(result.installedGuards.includes('check_custom'));
      } finally {
        teardown(dir);
      }
    });
  }

  it('getTools() without a directory lists only the generic guards', () => {
    const names = new AgentOSAdapter().getTools().map((t) => t.name);
    assert.ok(names.includes('check_skills'));
    assert.ok(names.includes('check_custom'));
    assert.ok(!names.includes('check_domain_data'));
    assert.ok(!names.includes('check_test_calendar_sync'));
  });
});

describe('Agent-OS AGENTS.md', () => {
  it('names no invented path and describes the folders the repository has', () => {
    const { dir, agents } = install({ 'skills/research/SKILL.md': SKILL, 'playbooks/onboarding.md': PLAYBOOK });
    try {
      assert.ok(!agents.includes('brand/client-profile.md'), 'no invented brand/client-profile.md');
      assert.ok(agents.includes('`skills/`'), 'describes skills/');
      assert.ok(agents.includes('`playbooks/`'), 'describes playbooks/');
      assert.ok(!agents.includes('`prompts/`'), 'prompts/ does not exist here');
      assert.ok(!agents.includes('`templates/`'), 'templates/ does not exist here');
      assert.match(agents, /HITL:/, 'states the HITL marker convention check_hitl enforces');
    } finally {
      teardown(dir);
    }
  });

  it('lists rules/, prompts/ and templates/ when present', () => {
    const { dir, agents } = install({
      'rules/style.md': '# Style\n',
      'prompts/intro.md': '# Intro\n',
      'templates/welcome.md': 'Hello\n',
    });
    try {
      for (const folder of ['rules', 'prompts', 'templates']) {
        assert.ok(agents.includes(`\`${folder}/\``), `describes ${folder}/`);
      }
    } finally {
      teardown(dir);
    }
  });
});
