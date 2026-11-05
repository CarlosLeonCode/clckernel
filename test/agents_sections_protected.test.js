/**
 * `clckernel update` and the kernel-owned AGENTS.md sections (Parts, Core AI
 * Safeguards):
 * - a section is refreshed only when its text is what the kernel last wrote
 *   (sha256 recorded in the registry, `agentsSections`) or already the fresh
 *   text; otherwise AGENTS.md is kept and the proposal goes to
 *   AGENTS.md.clckernel-new (a protected file of the plan);
 * - section 2 lists the guards that are installed, not the detected ones;
 * - a registry without `technologies` is a baseline: nothing is added.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTmpProject, teardown, git } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');

const REGISTRY = 'tools/.clckernel-managed.json';
const NEW = 'AGENTS.md.clckernel-new';
const pkg = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const NEXT = { 'package.json': pkg({ name: 'web', private: true, dependencies: { next: '^15.0.0' } }) };
const MONO = {
  'package.json': pkg({ name: 'mono', private: true, workspaces: ['apps/*', 'packages/*'] }),
  'apps/web/package.json': pkg({ name: 'web', dependencies: { next: '^15.0.0' } }),
  'apps/api/requirements.txt': 'fastapi\n',
};
const quietly = (fn) => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};
const read = (dir, rel = 'AGENTS.md') => fs.readFileSync(path.join(dir, rel), 'utf-8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const registry = (dir) => JSON.parse(read(dir, REGISTRY));
const installed = (files) => {
  const dir = createTmpProject(files);
  git(dir, 'init', '-q');
  quietly(() => generateHarness(dir, autoDetectStack(dir)));
  return dir;
};
const update = (dir, options) => quietly(() => updateHarness(dir, options));
const section2 = (text) => {
  const start = text.indexOf('\n## 2. Core AI Safeguards');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? text.length : end);
};

describe('update keeps an edited kernel section of AGENTS.md', () => {
  it('install records a hash per kernel section', () => {
    const dir = installed(MONO);
    try {
      const sections = registry(dir).agentsSections;
      assert.ok(sections, 'registry.agentsSections');
      assert.deepStrictEqual(Object.keys(sections).sort(), ['## 2. Core AI Safeguards (per part)', '## Parts']);
      for (const sha of Object.values(sections)) assert.match(sha, /^[0-9a-f]{64}$/);
    } finally {
      teardown(dir);
    }
  });

  it('a bullet added to section 2 is preserved; the refreshed file goes to AGENTS.md.clckernel-new', () => {
    const dir = installed(NEXT);
    try {
      const edited = read(dir).replace('- Educational Audit Gate', '- Our own rule: pair on schema changes\n- Educational Audit Gate');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), edited);
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');
      const result = update(dir);
      assert.strictEqual(read(dir), edited, 'AGENTS.md is untouched');
      assert.ok(exists(dir, NEW), 'proposal written');
      assert.match(read(dir, NEW), /- Supabase: SQL migration guard/);
      assert.ok(result.plan.protected.some((p) => p.path === 'AGENTS.md' && p.newPath === NEW), JSON.stringify(result.plan.protected));
      assert.ok(!result.plan.written.includes('AGENTS.md'));
    } finally {
      teardown(dir);
    }
  });

  it('a subsection added inside a multi-part section is preserved', () => {
    const dir = installed(MONO);
    try {
      const text = read(dir);
      const at = text.indexOf('\n## 3. Universal Command Interface');
      const edited = `${text.slice(0, at)}\n### Team rule\nNo direct writes to the api part.\n${text.slice(at)}`;
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), edited);
      write(dir, 'packages/lib/package.json', pkg({ name: 'lib', devDependencies: { vitest: '1' } }));
      write(dir, 'packages/lib/tsconfig.json', '{}\n');
      update(dir);
      assert.strictEqual(read(dir), edited);
      assert.match(read(dir, NEW), /packages\/lib/);
    } finally {
      teardown(dir);
    }
  });

  it('an untouched section is refreshed and its new hash recorded', () => {
    const dir = installed(NEXT);
    try {
      const before = registry(dir).agentsSections['## 2. Core AI Safeguards (Next.js (App Router))'];
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');
      update(dir);
      assert.match(read(dir), /- Supabase: SQL migration guard/);
      assert.ok(!exists(dir, NEW));
      const after = registry(dir).agentsSections['## 2. Core AI Safeguards (Next.js (App Router))'];
      assert.ok(before && after && before !== after);
    } finally {
      teardown(dir);
    }
  });

  it('--dry-run with an edited section writes nothing and reports the protected file', () => {
    const dir = installed(NEXT);
    try {
      const edited = read(dir).replace('- Educational Audit Gate', '- Ours\n- Educational Audit Gate');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), edited);
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');
      const result = update(dir, { dryRun: true });
      assert.strictEqual(read(dir), edited);
      assert.ok(!exists(dir, NEW), 'dry run writes no proposal');
      assert.ok(result.plan.protected.some((p) => p.path === 'AGENTS.md'));
    } finally {
      teardown(dir);
    }
  });

  it('a registry without section hashes: a section that differs from the fresh text is kept', () => {
    const dir = installed(NEXT);
    try {
      const reg = registry(dir);
      delete reg.agentsSections;
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(reg));
      const before = read(dir);
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');
      update(dir);
      assert.strictEqual(read(dir), before);
      assert.match(read(dir, NEW), /- Supabase: SQL migration guard/);
    } finally {
      teardown(dir);
    }
  });

  it('a registry without section hashes: a section equal to the fresh text gets its hash recorded', () => {
    const dir = installed(NEXT);
    try {
      const reg = registry(dir);
      delete reg.agentsSections;
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(reg));
      update(dir);
      assert.ok(!exists(dir, NEW));
      assert.ok(registry(dir).agentsSections['## 2. Core AI Safeguards (Next.js (App Router))']);
    } finally {
      teardown(dir);
    }
  });
});

describe('section 2 lists the installed guards', () => {
  it('--add-guards check_api_contracts turns the agent-enforced Zod line into the guard', () => {
    const dir = installed(NEXT);
    try {
      update(dir, { addGuards: ['check_api_contracts'] });
      const s2 = section2(read(dir));
      assert.match(s2, /\(check_api_contracts\)/);
      assert.doesNotMatch(s2, /Zod API contracts \(agent-enforced/);
    } finally {
      teardown(dir);
    }
  });

  it('a catalog guard added outside the stack is listed', () => {
    const dir = installed(NEXT);
    try {
      update(dir, { addGuards: ['check_sql_migrations'] });
      assert.match(section2(read(dir)), /check_sql_migrations/);
    } finally {
      teardown(dir);
    }
  });

  it('a technology guard the project removed is not listed', () => {
    const dir = installed({ ...NEXT, 'supabase/config.toml': 'project_id = "x"\n' });
    try {
      assert.match(section2(read(dir)), /Supabase/);
      fs.rmSync(path.join(dir, 'tools/check_sql_migrations.js'));
      const reg = registry(dir);
      reg.files = reg.files.filter((f) => f.path !== 'tools/check_sql_migrations.js');
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(reg));
      update(dir);
      assert.doesNotMatch(section2(read(dir)), /Supabase/);
    } finally {
      teardown(dir);
    }
  });

  it('a stack guard the project removed is marked not installed', () => {
    const dir = installed(NEXT);
    try {
      fs.rmSync(path.join(dir, 'tools/check_seo.js'));
      const reg = registry(dir);
      reg.files = reg.files.filter((f) => f.path !== 'tools/check_seo.js');
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(reg));
      update(dir);
      const line = section2(read(dir)).split('\n').find((l) => /SEO, GEO/.test(l));
      assert.match(line, /not installed/);
      assert.match(line, /agent-enforced/);
    } finally {
      teardown(dir);
    }
  });
});

describe('a registry without technologies is a baseline', () => {
  it('a detected technology guard is not added; it is listed as available; the baseline is recorded', () => {
    const dir = installed(NEXT);
    try {
      const reg = registry(dir);
      delete reg.technologies;
      fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify(reg));
      write(dir, 'supabase/config.toml', 'project_id = "x"\n');
      const result = update(dir);
      assert.ok(!exists(dir, 'tools/check_sql_migrations.js'));
      assert.deepStrictEqual(result.plan.detected, []);
      assert.ok(result.plan.available.includes('check_sql_migrations'));
      assert.ok(registry(dir).technologies.includes('supabase'));
    } finally {
      teardown(dir);
    }
  });
});
