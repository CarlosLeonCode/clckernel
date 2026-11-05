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

  it('ignores node_modules, .git, vendor, dist and build, and dirs below the `dir/*` level of a conventional dir', () => {
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

  it('a subdir holding no manifest of any stack is not a part', () => {
    withProject({
      'package.json': PACKAGE({ name: 'web', workspaces: ['packages/*'], dependencies: { next: '^14.0.0' } }),
      'packages/ui/README.md': '# ui\n',
      'packages/ui/src/index.ts': 'export const x = 1;\n',
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

/**
 * sdds/monorepo-ts-library-parts + sdds/monorepo-library-parts: a subdir with
 * a package manifest and no framework is a library part of its ecosystem
 * (TypeScript, JavaScript, Python, PHP, Ruby), so its tools run in the hook.
 * Library parts count on their own; the root is never a library part.
 */
const TS_LIB = 'TypeScript Library';
const JS_LIB = 'JavaScript Library';
const PY_LIB = 'Python Library';
const PHP_LIB = 'PHP Library';
const RB_LIB = 'Ruby Library';
const TSCONFIG = `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }, null, 2)}\n`;
const LIB_PKG = (name, devDependencies = {}) => PACKAGE({ name, private: true, devDependencies: { typescript: '^5.0.0', ...devDependencies } });
const MONO_ROOT = PACKAGE({ name: 'mono', private: true, workspaces: ['apps/*', 'packages/*'] });
const PYPROJECT = (name) => `[project]\nname = "${name}"\nversion = "0.1.0"\n`;

describe('detectParts — library parts (shapes)', () => {
  it('apps/web Next.js + packages/* TypeScript libraries -> one library part per package, monorepo', () => {
    withProject({
      'package.json': MONO_ROOT,
      'tsconfig.base.json': TSCONFIG,
      'apps/web/package.json': NEXT_PKG,
      'packages/core/package.json': LIB_PKG('core', { vitest: '^2.0.0' }),
      'packages/core/tsconfig.json': TSCONFIG,
      'packages/legacy/package.json': LIB_PKG('legacy', { jest: '^29.0.0' }),
      'packages/legacy/tsconfig.json': TSCONFIG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [
        `apps/web: ${NEXT}`, `packages/core: ${TS_LIB}`, `packages/legacy: ${TS_LIB}`,
      ]);
      const config = autoDetectStack(dir);
      assert.strictEqual(config.projectType, 'monorepo');
      assert.strictEqual(config.framework, NEXT, 'the first framework part stays the primary stack');
      assert.strictEqual(config.adapter.name, NEXT);
      assert.deepStrictEqual(config.parts.map((p) => p.testRunner), ['Vitest / Jest', 'Vitest', 'Jest']);
      assert.deepStrictEqual(config.parts.map((p) => p.projectType), ['frontend', 'library', 'library']);
    });
  });

  it('FastAPI backend + packages/sdk TypeScript library -> both parts', () => {
    withProject({
      'backend/requirements.txt': 'fastapi\n',
      'packages/sdk/package.json': LIB_PKG('sdk'),
      'packages/sdk/tsconfig.json': TSCONFIG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`backend: ${FASTAPI}`, `packages/sdk: ${TS_LIB}`]);
    });
  });

  it('pure TypeScript library monorepo (no framework anywhere) -> library parts, monorepo', () => {
    withProject({
      'package.json': MONO_ROOT,
      'tsconfig.json': TSCONFIG,
      'packages/core/package.json': LIB_PKG('core'),
      'packages/core/tsconfig.json': TSCONFIG,
      'packages/utils/package.json': LIB_PKG('utils'),
      'packages/utils/tsconfig.json': TSCONFIG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`packages/core: ${TS_LIB}`, `packages/utils: ${TS_LIB}`]);
      const config = autoDetectStack(dir);
      assert.strictEqual(config.projectType, 'monorepo');
      assert.strictEqual(config.framework, TS_LIB, 'with only libraries the first library is the primary');
      assert.strictEqual(config.adapter.name, TS_LIB);
    });
  });

  it('Next.js at the root + packages/ui TypeScript library -> fullstack', () => {
    withProject({
      'package.json': PACKAGE({ name: 'web', workspaces: ['packages/*'], dependencies: { next: '^14.0.0' } }),
      'tsconfig.json': TSCONFIG,
      'packages/ui/package.json': LIB_PKG('ui'),
      'packages/ui/tsconfig.json': TSCONFIG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`.: ${NEXT}`, `packages/ui: ${TS_LIB}`]);
      const config = autoDetectStack(dir);
      assert.strictEqual(config.projectType, 'fullstack');
      assert.strictEqual(config.framework, NEXT);
    });
  });

  it('workspaces `packages/**` with scoped dirs packages/<scope>/<pkg> (depth 3) -> found', () => {
    withProject({
      'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['packages/**'] }),
      'packages/scope/core/package.json': LIB_PKG('@scope/core'),
      'packages/scope/core/tsconfig.json': TSCONFIG,
      'packages/top/nested/package.json': LIB_PKG('nested'),
      'packages/top/package.json': LIB_PKG('top'),
      'packages/top/tsconfig.json': TSCONFIG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [
        `packages/scope/core: ${TS_LIB}`, `packages/top: ${TS_LIB}`,
      ], 'the walk stops at a dir holding a manifest');
    });
  });

  it('workspaces `modules/*/*` (two levels) -> found', () => {
    withProject({
      'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['modules/*/*'] }),
      'modules/shared/fmt/package.json': LIB_PKG('fmt'),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`modules/shared/fmt: ${JS_LIB}`]);
    });
  });

  it('Nx: nx.json, apps/web Next.js, libs/ui (project.json + tsconfig, no workspaces) -> libs/ui found', () => {
    withProject({
      'package.json': PACKAGE({ name: 'nx-mono', private: true, devDependencies: { nx: '^19.0.0' } }),
      'nx.json': '{}\n',
      'apps/web/package.json': NEXT_PKG,
      'libs/ui/project.json': '{ "name": "ui" }\n',
      'libs/ui/package.json': LIB_PKG('ui'),
      'libs/ui/tsconfig.json': TSCONFIG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`apps/web: ${NEXT}`, `libs/ui: ${TS_LIB}`]);
    });
  });

  it('Nx library without package.json: project.json + tsconfig.json -> TypeScript Library, default runner', () => {
    withProject({
      'package.json': PACKAGE({ name: 'nx-mono', private: true, devDependencies: { nx: '^19.0.0' } }),
      'nx.json': '{}\n',
      'apps/web/package.json': NEXT_PKG,
      'libs/ui/project.json': '{ "name": "ui" }\n',
      'libs/ui/tsconfig.json': TSCONFIG,
    }, (dir) => {
      const config = autoDetectStack(dir);
      assert.deepStrictEqual(partNames(config.parts), [`apps/web: ${NEXT}`, `libs/ui: ${TS_LIB}`]);
      assert.deepStrictEqual(config.parts.map((p) => p.testRunner), ['Vitest / Jest', 'Vitest / Jest']);
    });
  });

  it('Nx project.json without tsconfig.json -> JavaScript Library, dropped next to another node part', () => {
    withProject({
      'nx.json': '{}\n',
      'apps/api/requirements.txt': 'fastapi\n',
      'libs/js/project.json': '{ "name": "js" }\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`apps/api: ${FASTAPI}`, `libs/js: ${JS_LIB}`]);
    });
    withProject({
      'nx.json': '{}\n',
      'apps/web/package.json': NEXT_PKG,
      'libs/js/project.json': '{ "name": "js" }\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`apps/web: ${NEXT}`]);
    });
  });

  it('root unaffected: a root with project.json + tsconfig.json is never a library part', () => {
    withProject({ 'nx.json': '{}\n', 'project.json': '{}\n', 'tsconfig.json': TSCONFIG }, (dir) => {
      assert.deepStrictEqual(detectParts(dir), []);
    });
  });

  it('lerna.json packages are part patterns', () => {
    withProject({
      'package.json': PACKAGE({ name: 'mono', private: true }),
      'lerna.json': JSON.stringify({ packages: ['modules/*'] }),
      'modules/fmt/package.json': LIB_PKG('fmt'),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`modules/fmt: ${JS_LIB}`]);
    });
  });

  it('JavaScript library (package.json, no tsconfig.json) next to a non-node part -> JavaScript Library', () => {
    withProject({
      'backend/requirements.txt': 'fastapi\n',
      'packages/js/package.json': PACKAGE({ name: 'js', devDependencies: { jest: '^29.0.0' } }),
    }, (dir) => {
      const config = autoDetectStack(dir);
      assert.deepStrictEqual(partNames(config.parts), [`backend: ${FASTAPI}`, `packages/js: ${JS_LIB}`]);
      assert.deepStrictEqual(config.parts.map((p) => p.testRunner), ['Pytest', 'Jest']);
    });
  });

  it('pure JavaScript library monorepo -> JavaScript Library parts, monorepo', () => {
    withProject({
      'package.json': MONO_ROOT,
      'packages/a/package.json': PACKAGE({ name: 'a' }),
      'packages/b/package.json': PACKAGE({ name: 'b' }),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`packages/a: ${JS_LIB}`, `packages/b: ${JS_LIB}`]);
      assert.strictEqual(autoDetectStack(dir).projectType, 'monorepo');
    });
  });

  it('a JavaScript library is dropped when another node part already installs the JS guards', () => {
    withProject({
      'package.json': MONO_ROOT,
      'apps/web/package.json': NEXT_PKG,
      'packages/js/package.json': PACKAGE({ name: 'js', devDependencies: { jest: '^29.0.0' } }),
      'packages/ts/package.json': LIB_PKG('ts'),
      'packages/ts/tsconfig.json': TSCONFIG,
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`apps/web: ${NEXT}`, `packages/ts: ${TS_LIB}`]);
    });
  });

  it('root unaffected: Next.js root + plain JS workspace packages stays single-stack (golden snapshot)', () => {
    withProject({
      'package.json': PACKAGE({ name: 'web', workspaces: ['packages/*'], dependencies: { next: '^14.0.0' } }),
      'packages/ui/package.json': PACKAGE({ name: 'ui', dependencies: { react: '^18.0.0' } }),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`.: ${NEXT}`]);
      assert.strictEqual(autoDetectStack(dir).parts, undefined);
    });
  });

  it('FastAPI services/api + plain Python library packages/core -> Python Library part', () => {
    withProject({
      'services/api/requirements.txt': 'fastapi\n',
      'packages/core/pyproject.toml': PYPROJECT('core'),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [`packages/core: ${PY_LIB}`, `services/api: ${FASTAPI}`]);
    });
  });

  it('pure Python library monorepo (pyproject.toml, setup.py, setup.cfg) -> Python Library parts, monorepo', () => {
    withProject({
      'packages/a/pyproject.toml': PYPROJECT('a'),
      'packages/b/setup.py': 'from setuptools import setup\nsetup(name="b")\n',
      'packages/c/setup.cfg': '[metadata]\nname = c\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [
        `packages/a: ${PY_LIB}`, `packages/b: ${PY_LIB}`, `packages/c: ${PY_LIB}`,
      ]);
      const config = autoDetectStack(dir);
      assert.strictEqual(config.projectType, 'monorepo');
      assert.strictEqual(config.framework, PY_LIB);
    });
  });

  it('Laravel apps/web + plain PHP package packages/pkg -> PHP Library part', () => {
    withProject({
      'apps/web/artisan': '#!/usr/bin/env php\n',
      'apps/web/composer.json': '{"require":{"laravel/framework":"^11.0"}}\n',
      'packages/pkg/composer.json': '{"name":"vendor/pkg"}\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), ['apps/web: PHP / Laravel', `packages/pkg: ${PHP_LIB}`]);
    });
  });

  it('Rails apps/web (Gemfile + config/routes.rb) + plain gem packages/gem -> Ruby Library part', () => {
    withProject({
      'apps/web/Gemfile': "gem 'rails'\n",
      'apps/web/config/routes.rb': 'Rails.application.routes.draw do\nend\n',
      'packages/gem/thing.gemspec': 'Gem::Specification.new do |s|\n  s.name = "thing"\nend\n',
      'packages/tool/Gemfile': "source 'https://rubygems.org'\n",
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [
        'apps/web: Ruby on Rails', `packages/gem: ${RB_LIB}`, `packages/tool: ${RB_LIB}`,
      ]);
    });
  });

  it('Go service + Go library (go.mod each) -> two Go parts (the Go adapter matches plain modules)', () => {
    withProject({
      'services/api/go.mod': 'module example.com/api\n',
      'packages/lib/go.mod': 'module example.com/lib\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), ['packages/lib: Go (Golang)', 'services/api: Go (Golang)']);
    });
  });

  it('go.work `use` dirs are part patterns', () => {
    withProject({
      'go.work': 'go 1.22\n\nuse (\n\t./cmd/tool // the CLI\n\t./internal/kit\n)\nuse ./single\n',
      'cmd/tool/go.mod': 'module example.com/tool\n',
      'internal/kit/go.mod': 'module example.com/kit\n',
      'single/go.mod': 'module example.com/single\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [
        'cmd/tool: Go (Golang)', 'internal/kit: Go (Golang)', 'single: Go (Golang)',
      ]);
    });
  });

  it('Cargo workspace root -> one root Rust part (members under packages/* are covered by cargo at the root)', () => {
    withProject({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*", "packages/*"]\n',
      'crates/a/Cargo.toml': '[package]\nname = "a"\n',
      'packages/b/Cargo.toml': '[package]\nname = "b"\n',
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), ['.: Rust Engine']);
      assert.strictEqual(autoDetectStack(dir).parts, undefined, 'single-stack config, as before');
    });
  });

  it('a framework wins over every library adapter in the same dir', () => {
    withProject({
      'package.json': MONO_ROOT,
      'apps/web/package.json': NEXT_PKG,
      'apps/web/tsconfig.json': TSCONFIG,
      'apps/web/pyproject.toml': PYPROJECT('tooling'),
      'packages/docs/package.json': PACKAGE({ name: 'docs', dependencies: { astro: '^4.0.0' } }),
      'packages/docs/tsconfig.json': TSCONFIG,
      'services/api/requirements.txt': 'fastapi\n',
      'services/api/package.json': PACKAGE({ name: 'api-tooling', private: true }),
    }, (dir) => {
      assert.deepStrictEqual(partNames(detectParts(dir)), [
        `apps/web: ${NEXT}`, 'packages/docs: Astro Framework', `services/api: ${FASTAPI}`,
      ]);
    });
  });

  it('root unaffected: a root with package.json + tsconfig.json is never a library part', () => {
    withProject({ 'package.json': PACKAGE({ name: 'single', private: true }), 'tsconfig.json': TSCONFIG }, (dir) => {
      assert.deepStrictEqual(detectParts(dir), []);
      assert.strictEqual(autoDetectStack(dir).projectType, 'unknown');
    });
  });

  it('root unaffected: a single Python package root (pyproject.toml) stays generic', () => {
    withProject({ 'pyproject.toml': PYPROJECT('single') }, (dir) => {
      assert.deepStrictEqual(detectParts(dir), []);
      assert.strictEqual(autoDetectStack(dir).projectType, 'unknown');
    });
  });

  it('root unaffected: an Agent-OS root with only library packages stays Agent-OS', () => {
    withProject({
      'package.json': PACKAGE({ name: 'acme-agent-os', private: true, keywords: ['agent-os'] }),
      'packages/a/package.json': LIB_PKG('a'),
      'packages/a/tsconfig.json': TSCONFIG,
      'packages/b/pyproject.toml': PYPROJECT('b'),
    }, (dir) => {
      assert.deepStrictEqual(detectParts(dir), []);
      assert.strictEqual(autoDetectStack(dir).projectType, 'agent-os');
    });
  });
});
