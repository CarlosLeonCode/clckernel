/**
 * verify_tdd.js in npm workspaces.
 * REQ-2: a part whose package.json does not declare the runner uses the
 * workspace root's (package.json + node_modules/.bin); a part node_modules
 * without the binary falls through to the root's.
 * REQ-13: generated files (Supabase / Prisma / GraphQL codegen) are not
 * production code that needs a test, unless tdd.code / tdd.ignore say otherwise.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createGitRepo, teardown } = require('./helpers');

const TOOLS = path.join(__dirname, '..', 'tools');
const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;

function env() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) out[key] = value;
  return { ...out, CLC_TDD_TIMEOUT: '60' };
}

function run(dir) {
  const res = spawnSync(process.execPath, [path.join(TOOLS, 'verify_tdd.js'), dir], { cwd: dir, encoding: 'utf-8', env: env() });
  let result;
  try {
    result = JSON.parse(res.stdout);
  } catch {
    assert.fail(`verify_tdd.js printed no JSON (status ${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  return { status: res.status, data: result.data, raw: `${res.stdout}\n${res.stderr}` };
}

/** Fake vitest: says which node_modules it came from, runs the files with node:test. */
function fakeVitest(origin) {
  return [
    '#!/usr/bin/env node',
    "const { spawnSync } = require('child_process');",
    `console.log('FAKE_VITEST origin=${origin} cwd=' + process.cwd());`,
    "const files = process.argv.slice(2).filter((a) => a !== 'run');",
    "const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });",
    'process.exit(res.status === null ? 1 : res.status);',
    '',
  ].join('\n');
}

function installBin(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
}

const ROOT_RUNNER = {
  '.gitignore': 'node_modules/\n',
  'package.json': PACKAGE({ name: 'mono', private: true, workspaces: ['packages/*'], devDependencies: { vitest: '^1.0.0' } }),
  'packages/lib/package.json': PACKAGE({ name: 'lib', private: true }),
  'packages/lib/src/sum.ts': 'export const sum = (a: number, b: number) => a + b;\n',
};
const LIB_CHANGE = {
  'packages/lib/src/mul.ts': 'export const mul = (a: number, b: number) => a * b;\n',
  // A .test.ts the fake runs through node:test (Node strips the types).
  'packages/lib/src/mul.test.js': [
    "const { test } = require('node:test');",
    "const assert = require('node:assert');",
    "const fs = require('fs');",
    "test('mul exists', () => assert.ok(fs.existsSync(require('path').join(__dirname, 'mul.ts'))));",
    '',
  ].join('\n'),
};

describe('REQ-2: verify_tdd.js resolves a runner hoisted to the workspace root', () => {
  it('runner declared and installed only at the root => the part uses it', () => {
    const dir = createGitRepo(ROOT_RUNNER, LIB_CHANGE);
    installBin(dir, 'node_modules/.bin/vitest', fakeVitest('root'));
    try {
      const res = run(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.strictEqual(res.data.runner, 'vitest', res.raw);
      assert.match(res.data.green.output, /FAKE_VITEST origin=root cwd=\S+\/candidate\/packages\/lib/, res.raw);
    } finally {
      teardown(dir);
    }
  });

  it('the part declares the runner but its node_modules has no binary => the root binary runs', () => {
    const dir = createGitRepo({
      ...ROOT_RUNNER,
      'packages/lib/package.json': PACKAGE({ name: 'lib', private: true, devDependencies: { vitest: '^1.0.0' } }),
    }, LIB_CHANGE);
    installBin(dir, 'node_modules/.bin/vitest', fakeVitest('root'));
    fs.mkdirSync(path.join(dir, 'packages/lib/node_modules/.vite'), { recursive: true });
    try {
      const res = run(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.match(res.data.green.output, /FAKE_VITEST origin=root /, res.raw);
    } finally {
      teardown(dir);
    }
  });

  it('a runner installed in the part wins over the root one', () => {
    const dir = createGitRepo(ROOT_RUNNER, LIB_CHANGE);
    installBin(dir, 'node_modules/.bin/vitest', fakeVitest('root'));
    installBin(dir, 'packages/lib/node_modules/.bin/vitest', fakeVitest('part'));
    try {
      const res = run(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.match(res.data.green.output, /FAKE_VITEST origin=part /, res.raw);
    } finally {
      teardown(dir);
    }
  });
});

describe('REQ-13: generated files are not production code by default', () => {
  const generated = {
    'src/adapters/database.types.ts': 'export type Database = {};\n',
    'src/graphql/schema.generated.ts': 'export const x = 1;\n',
    'src/types/api.gen.ts': 'export const y = 1;\n',
    'src/__generated__/client.ts': 'export const z = 1;\n',
  };

  it('a change made only of generated files needs no test', () => {
    const dir = createGitRepo({ 'package.json': PACKAGE({ name: 'app', private: true }) }, generated);
    try {
      const res = run(dir);
      assert.strictEqual(res.status, 0, res.raw);
      assert.deepStrictEqual(res.data.changed_code || [], [], res.raw);
    } finally {
      teardown(dir);
    }
  });

  it('setting tdd.ignore replaces the default list: a generated file counts again', () => {
    const dir = createGitRepo({
      'package.json': PACKAGE({ name: 'app', private: true }),
      '.clckernel.yaml': 'tdd:\n  ignore:\n    - "docs/**"\n',
    }, { 'src/adapters/database.types.ts': 'export type Database = {};\n' });
    try {
      const res = run(dir);
      assert.strictEqual(res.status, 1, res.raw);
      assert.deepStrictEqual(res.data.changed_code, ['src/adapters/database.types.ts'], res.raw);
    } finally {
      teardown(dir);
    }
  });

  it('ordinary code next to a generated file still needs a test', () => {
    const dir = createGitRepo({ 'package.json': PACKAGE({ name: 'app', private: true }) }, {
      ...generated,
      'src/real.ts': 'export const real = 1;\n',
    });
    try {
      const res = run(dir);
      assert.strictEqual(res.status, 1, res.raw);
      assert.deepStrictEqual(res.data.changed_code, ['src/real.ts'], res.raw);
    } finally {
      teardown(dir);
    }
  });
});
