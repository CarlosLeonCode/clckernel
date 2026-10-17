/**
 * sdds/fullstack-monorepo, decision 1 + 2 (TDD plan items 1 and 7): the
 * detector returns one part per code stack found at the root, in declared
 * workspaces and in conventional directories; a repo with a single part at
 * its root is detected exactly as before (see parts_single_stack.test.js).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTmpProject, teardown } = require('./helpers');
const { autoDetectStack, detectParts } = require('../src/detector');

const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;
const NEXT = 'Next.js (App Router)';
const FASTAPI = 'FastAPI Framework';

/** Parts as plain `dir: adapter name` strings, in detection order. */
function partNames(parts) {
  return parts.map((p) => `${p.dir}: ${p.adapter ? p.adapter.name : p.framework}`);
}

function withProject(files, fn) {
  const dir = createTmpProject(files);
  try {
    return fn(dir);
  } finally {
    teardown(dir);
  }
}

const NEXT_PKG = PACKAGE({ name: 'web', private: true, dependencies: { next: '^14.0.0' } });

describe('detectParts — the three fixtures of the spec', () => {
  it('Next.js at the root + backend/ FastAPI -> two parts, fullstack', () => {
    withProject({
      'package.json': NEXT_PKG,
      'backend/requirements.txt': 'fastapi\n',
      'backend/app/__init__.py': '',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`.: ${NEXT}`, `backend: ${FASTAPI}`]);
      const config = autoDetectStack(dir);
      assert.strictEqual(config.projectType, 'fullstack');
      assert.deepStrictEqual(partNames(config.parts), [`.: ${NEXT}`, `backend: ${FASTAPI}`]);
      assert.strictEqual(config.adapter.name, NEXT, 'config.adapter keeps the first part for compatibility');
      assert.deepStrictEqual(config.parts.map((p) => p.testRunner), ['Vitest / Jest', 'Pytest']);
      assert.deepStrictEqual(config.parts.map((p) => p.projectType), ['frontend', 'backend']);
    });
  });

  it('Next.js package.json + FastAPI requirements.txt at the root -> two parts with the same dir', () => {
    withProject({ 'package.json': NEXT_PKG, 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`.: ${NEXT}`, `.: ${FASTAPI}`]);
      assert.strictEqual(autoDetectStack(dir).projectType, 'fullstack');
    });
  });

  it('workspaces monorepo (apps/web Next.js, apps/api FastAPI) -> two parts, monorepo', () => {
    withProject({
      'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['apps/*'] }),
      'apps/web/package.json': NEXT_PKG,
      'apps/api/requirements.txt': 'fastapi\n',
      'apps/api/app/__init__.py': '',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`apps/api: ${FASTAPI}`, `apps/web: ${NEXT}`]);
      const config = autoDetectStack(dir);
      assert.strictEqual(config.projectType, 'monorepo');
      assert.strictEqual(config.framework, FASTAPI, 'framework, like adapter, is the first part');
    });
  });
});

describe('detectParts — where parts are looked for', () => {
  it('package.json workspaces in object form ({ packages }) with a non-conventional dir', () => {
    withProject({
      'package.json': PACKAGE({ name: 'mono', private: true, workspaces: { packages: ['modules/*'] } }),
      'modules/site/package.json': NEXT_PKG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`modules/site: ${NEXT}`]);
    });
  });

  it('pnpm-workspace.yaml packages: literal dirs and dir/* globs', () => {
    withProject({
      'package.json': PACKAGE({ name: 'mono', private: true }),
      'pnpm-workspace.yaml': "packages:\n  - 'svc/api'\n  - \"modules/*\"\n  # - 'ignored/*'\n",
      'svc/api/requirements.txt': 'fastapi\n',
      'modules/site/package.json': NEXT_PKG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`modules/site: ${NEXT}`, `svc/api: ${FASTAPI}`]);
    });
  });

  it('conventional dirs: frontend, server, services/*, packages/*', () => {
    withProject({
      'frontend/package.json': NEXT_PKG,
      'server/go.mod': 'module example.com/server\n',
      'services/billing/requirements.txt': 'fastapi\n',
      'packages/docs/package.json': PACKAGE({ name: 'docs', dependencies: { astro: '^4.0.0' } }),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [
        `frontend: ${NEXT}`,
        'packages/docs: Astro Framework',
        'server: Go (Golang)',
        `services/billing: ${FASTAPI}`,
      ]);
    });
  });

  it('ignores node_modules, .git, vendor, dist and build, and anything deeper than 2 levels', () => {
    withProject({
      'apps/node_modules/package.json': NEXT_PKG,
      'apps/dist/package.json': NEXT_PKG,
      'packages/build/package.json': NEXT_PKG,
      'services/vendor/requirements.txt': 'fastapi\n',
      'node_modules/next/package.json': NEXT_PKG,
      'apps/web/nested/package.json': NEXT_PKG,
    }, (dir) => {
      assert.deepStrictEqual(detectParts(dir), []);
    });
  });

  it('ignores a dir whose name is not safe to put in a shell command', () => {
    withProject({ 'apps/we b/package.json': NEXT_PKG, "apps/it's/package.json": NEXT_PKG }, (dir) => {
      assert.deepStrictEqual(detectParts(dir), []);
    });
  });

  it('a subdir holding no code stack is not a part', () => {
    withProject({
      'package.json': PACKAGE({ name: 'web', workspaces: ['packages/*'], dependencies: { next: '^14.0.0' } }),
      'packages/ui/package.json': PACKAGE({ name: 'ui', dependencies: { react: '^18.0.0' } }),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`.: ${NEXT}`]);
      assert.strictEqual(autoDetectStack(dir).parts, undefined, 'one root part keeps the single-stack config');
    });
  });

  it('a single part in a subdir is a monorepo (its tools must run in that dir)', () => {
    withProject({ 'backend/requirements.txt': 'fastapi\n' }, (dir) => {
      const config = autoDetectStack(dir);
      assert.strictEqual(config.projectType, 'monorepo');
      assert.deepStrictEqual(partNames(config.parts), [`backend: ${FASTAPI}`]);
    });
  });

  it('two stacks of the same ecosystem in one dir stay one part (adapter order wins, as before)', () => {
    withProject({ 'requirements.txt': 'fastapi\ndjango\n' }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`.: ${FASTAPI}`]);
      assert.strictEqual(autoDetectStack(dir).parts, undefined);
    });
  });

  it('Agent-OS is never a part; code parts in subdirs win over it', () => {
    withProject({
      'package.json': PACKAGE({ name: 'acme-agent-os', private: true, keywords: ['agent-os'] }),
      'backend/requirements.txt': 'fastapi\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`backend: ${FASTAPI}`]);
      assert.strictEqual(autoDetectStack(dir).projectType, 'monorepo');
    });
  });

  it('technology tools are detected in every part dir and the root (union, deduplicated)', () => {
    withProject({
      'package.json': NEXT_PKG,
      Dockerfile: 'FROM node:20\n',
      'backend/requirements.txt': 'fastapi\nredis\n',
      'backend/Dockerfile': 'FROM python:3.12\n',
    }, (dir) => {
      const names = autoDetectStack(dir).techTools.map((t) => t.name).sort();
      assert.deepStrictEqual(names, ['docker_guard', 'redis_guard']);
    });
  });
});
