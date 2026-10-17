/**
 * sdds/monorepo-gaps, gap 2: the Next.js guards decide per changed file with
 * the nearest package.json (read from the snapshot), not the root one. In a
 * workspaces monorepo (root package.json without `next`, apps/web with it)
 * apps/web files are checked and files of a non-Next part are not; a
 * single-stack Next.js repo behaves as before.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const ROOT_PKG = JSON.stringify({ name: 'mono', private: true, workspaces: ['apps/*'] });
const NEXT_PKG = JSON.stringify({ name: 'web', dependencies: { next: '14.0.0', react: '18.0.0', zod: '3.0.0' } });
const PLAIN_PKG = JSON.stringify({ name: 'lib', dependencies: { lodash: '4.0.0' } });

const BASE = {
  'package.json': ROOT_PKG,
  'apps/web/package.json': NEXT_PKG,
  'apps/lib/package.json': PLAIN_PKG,
  'apps/api/requirements.txt': 'fastapi\n',
};

const LAYOUT = "'use client';\nexport default function Layout() { return null; }\n";
const IMG = 'export const P = () => <img src="a.png" alt="a" />;\n';
const FETCH = 'export async function load() { const r = await fetch("/x"); return r.json(); }\n';

function runGuard(guard, staged, committed = BASE) {
  const dir = createGitRepo(committed, staged);
  try {
    const res = spawnSync(process.execPath, [path.join(TOOLS, guard), dir], { cwd: dir, encoding: 'utf-8' });
    return { status: res.status, result: JSON.parse(res.stdout), stdout: res.stdout };
  } finally {
    teardown(dir);
  }
}

const CASES = [
  { guard: 'check_architecture.js', file: 'app/layout.tsx', content: LAYOUT },
  { guard: 'check_performance.js', file: 'src/Pic.tsx', content: IMG },
];

describe('Next.js guards in a workspaces monorepo', () => {
  for (const { guard, file, content } of CASES) {
    it(`${guard}: a violating apps/web file fails`, () => {
      const res = runGuard(guard, { [`apps/web/${file}`]: content });
      assert.strictEqual(res.status, 1, res.stdout);
      assert.ok(res.result.data.violations[`apps/web/${file}`], res.stdout);
    });

    it(`${guard}: the same file in a non-Next part is not flagged`, () => {
      const res = runGuard(guard, { [`apps/lib/${file}`]: content });
      assert.strictEqual(res.status, 0, res.stdout);
      assert.deepStrictEqual(res.result.data.violations, {}, res.stdout);
    });

    it(`${guard}: only the Next part's file is flagged when both change`, () => {
      const res = runGuard(guard, { [`apps/web/${file}`]: content, [`apps/lib/${file}`]: content });
      assert.strictEqual(res.status, 1, res.stdout);
      assert.deepStrictEqual(Object.keys(res.result.data.violations), [`apps/web/${file}`], res.stdout);
    });

    it(`${guard}: no changed file in a Next.js project -> the existing skip`, () => {
      const res = runGuard(guard, { [`apps/lib/${file}`]: content });
      assert.strictEqual(res.result.skipped, true, res.stdout);
      assert.strictEqual(res.result.data.message, 'Not a Next.js project — skipping', res.stdout);
    });

    it(`${guard}: single-stack Next.js root still checked`, () => {
      const res = runGuard(guard, { [file]: content }, { 'package.json': NEXT_PKG });
      assert.strictEqual(res.status, 1, res.stdout);
      assert.ok(res.result.data.violations[file], res.stdout);
    });

    it(`${guard}: single-stack non-Next root still skipped`, () => {
      const res = runGuard(guard, { [file]: content }, { 'package.json': PLAIN_PKG });
      assert.strictEqual(res.status, 0, res.stdout);
      assert.strictEqual(res.result.data.message, 'Not a Next.js project — skipping', res.stdout);
    });
  }

  it('check_api_contracts.js: zod in apps/web/package.json enables its rules for apps/web files', () => {
    const res = runGuard('check_api_contracts.js', { 'apps/web/src/api/load.ts': FETCH });
    assert.strictEqual(res.status, 1, res.stdout);
    const rules = (res.result.data.violations['apps/web/src/api/load.ts'] || []).map((v) => v.rule);
    assert.ok(rules.includes('no-fetch-validation'), res.stdout);
  });

  it('check_api_contracts.js: a part without zod keeps those rules off', () => {
    const res = runGuard('check_api_contracts.js', { 'apps/lib/src/api/load.ts': FETCH });
    assert.strictEqual(res.status, 0, res.stdout);
  });
});
