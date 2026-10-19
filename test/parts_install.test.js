/**
 * sdds/fullstack-monorepo, decisions 2, 3, 6 and 7 (TDD plan item 2): a
 * multi-part repo gets the union of its parts' guards installed once in the
 * root tools/, one orchestrator per guard language, an AGENTS.md that lists
 * every part, a summary that names them, and `update` re-detects the parts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTmpProject, teardown, git, registryPaths, plannedGuards, hookRunsGuard, HOOK_ORCHESTRATOR_LINES } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');
const { printSuccess } = require('../src/ui');

const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;
const NEXT_BACKEND = {
  'package.json': PACKAGE({ name: 'web', private: true, dependencies: { next: '^14.0.0' } }),
  'backend/requirements.txt': 'fastapi\n',
  'backend/app/__init__.py': '',
};
const VERIFIER = 'Red→Green TDD Verifier';

function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

function install(files) {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  const result = quietly(() => generateHarness(dir, autoDetectStack(dir)));
  return { dir, result };
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

describe('install — Next.js at the root + backend/ FastAPI', () => {
  it('installs the JS and the Python guards once, both orchestrators and both snapshot helpers', () => {
    const { dir, result } = install(NEXT_BACKEND);
    try {
      const tools = fs.readdirSync(path.join(dir, 'tools'));
      for (const file of [
        'verify_tdd.js', 'verify_tdd.py', 'check_a11y.js', 'check_architecture.js', 'check_architecture.py',
        'check_db_efficiency.py', 'check_migrations.py', 'scan_secrets.js', 'scan_secrets.py',
        'check_custom.js', 'check_custom.py', 'audit.js', 'audit.py', '_changes.js', '_changes.py', 'yaml.js',
      ]) {
        assert.ok(tools.includes(file), `tools/${file} missing: ${tools.join(', ')}`);
      }
      // The hashed registry lists every installed tool (not itself), plus the hook and the skill.
      const registry = registryPaths(JSON.parse(read(dir, 'tools/.clckernel-managed.json')));
      assert.deepStrictEqual(
        registry.filter((p) => p.startsWith('tools/')),
        tools.filter((f) => f !== '.clckernel-managed.json').map((f) => `tools/${f}`).sort()
      );
      assert.ok(result.installedGuards.includes('verify_tdd'));
      assert.ok(result.installedGuards.includes('check_db_efficiency'));
    } finally {
      teardown(dir);
    }
  });

  it('runs every guard once from the root and each external tool in its part dir', () => {
    const { dir, result } = install(NEXT_BACKEND);
    try {
      const hook = read(dir, result.hook.file);
      const lines = hook.split('\n');
      const count = (line) => lines.filter((l) => l === line).length;
      // sdds/unified-discovery: one call per orchestrator; each plans each guard once.
      for (const line of HOOK_ORCHESTRATOR_LINES) assert.strictEqual(count(line), 1, hook);
      const planned = plannedGuards(dir);
      for (const guard of ['scan_secrets.js', 'scan_secrets.py', 'verify_tdd.js', 'verify_tdd.py']) {
        assert.strictEqual(planned.filter((g) => g === guard).length, 1, planned.join(', '));
      }
      assert.ok(lines.some((l) => l.startsWith('if [ -x node_modules/.bin/tsc ]') && l.includes('tsc (.) not available')), hook);
      assert.ok(lines.some((l) => l.startsWith("( cd 'backend' && if python3 -m pytest --version") &&
        l.includes('clckernel: pytest (backend) not available, skipped')), hook);
      assert.ok(lines.some((l) => l.startsWith("( cd 'backend' && if python3 -m ruff --version")), hook);
      assert.match(hook, /^echo "Running CLC Kernel /m);
    } finally {
      teardown(dir);
    }
  });

  it('AGENTS.md is one law listing every part with its stack and test runner', () => {
    const { dir } = install(NEXT_BACKEND);
    try {
      const agents = read(dir, 'AGENTS.md');
      assert.match(agents, /\| `\.` \| Next\.js \(App Router\) \| Vitest \/ Jest \|/);
      assert.match(agents, /\| `backend` \| FastAPI Framework \| Pytest \|/);
      assert.match(agents, /Core AI Safeguards — `\.` \(Next\.js \(App Router\)\)/);
      assert.match(agents, /Core AI Safeguards — `backend` \(FastAPI Framework\)/);
      assert.ok(agents.includes(VERIFIER));
      assert.match(agents, /clckernel update/);
      assert.strictEqual((agents.match(/authoritative law/g) || []).length, 1);
    } finally {
      teardown(dir);
    }
  });

  it('the success summary names every part', () => {
    const dir = createTmpProject(NEXT_BACKEND);
    const config = autoDetectStack(dir);
    const out = [];
    const log = console.log;
    const write = process.stdout.write;
    console.log = (...args) => out.push(args.join(' '));
    process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
    try {
      printSuccess(dir, { file: '.githooks/pre-commit', active: true }, config, ['verify_tdd']);
    } finally {
      console.log = log;
      process.stdout.write = write;
      teardown(dir);
    }
    const text = out.join('\n');
    assert.match(text, /backend/);
    assert.match(text, /FastAPI Framework/);
    assert.match(text, /Next\.js \(App Router\)/);
  });
});

describe('update re-detects the parts', () => {
  // sdds/update-no-additions: the new part's external tools join the hook;
  // its guards are offered (available) and installed with --add-guards.
  it('a Next.js repo that gains backend/ gets the backend tools in hook and registry on update', () => {
    const dir = createTmpProject({ 'package.json': NEXT_BACKEND['package.json'] });
    try {
      git(dir, 'init', '-q');
      quietly(() => generateHarness(dir, autoDetectStack(dir)));
      assert.ok(!read(dir, '.githooks/pre-commit').includes("cd 'backend'"));

      fs.mkdirSync(path.join(dir, 'backend'));
      fs.writeFileSync(path.join(dir, 'backend', 'requirements.txt'), 'fastapi\n');
      const plain = quietly(() => updateHarness(dir));
      assert.match(read(dir, '.githooks/pre-commit'), /\( cd 'backend' && if python3 -m pytest --version/);
      assert.ok(!plannedGuards(dir).includes('verify_tdd.py'));
      assert.ok(plain.plan.available.includes('verify_tdd'));

      quietly(() => updateHarness(dir, { addGuards: ['verify_tdd'] }));
      const hook = read(dir, '.githooks/pre-commit');
      assert.match(hook, /\( cd 'backend' && if python3 -m pytest --version/);
      assert.ok(hookRunsGuard(dir, 'verify_tdd.py'), hook);
      const registry = registryPaths(JSON.parse(read(dir, 'tools/.clckernel-managed.json')));
      assert.ok(registry.includes('tools/verify_tdd.py'));
      assert.ok(registry.includes('tools/audit.py'));
    } finally {
      teardown(dir);
    }
  });
});
