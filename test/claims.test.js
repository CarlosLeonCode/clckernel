/**
 * Regression test for the "honest claims" invariant:
 * no text installed into a consumer project attributes to a guard a technique
 * or guarantee that the code does not implement.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTmpProject, teardown } = require('./helpers');
const { generateHarness } = require('../src/generator');
const { SAFEGUARD_CATALOG: CATALOG } = require('../src/catalog');

const ROOT = path.join(__dirname, '..');
const ADAPTERS_DIR = path.join(ROOT, 'src', 'adapters');

// Guards that really parse source with Python's `ast` module.
const REAL_AST_GUARDS = [
  'check_architecture.py',
  'check_db_efficiency.py',
  'celery_guard.py',
  'redis_guard.py',
  'postgres_guard.py',
];

// Case-sensitive phrases that overstate what a guard does.
const FORBIDDEN = [
  'Idempotency',
  'idempotency',
  'Idempotencia',
  'idempotencia',
  'cannot be bypassed',
  'physically',
  'Physically',
  'físicamente',
  'Real TDD',
  'unbypassable',
  'UNBYPASSABLE',
  'Red-to-Green TDD Validator',
  'N+1 Performance Guard',
  'Scope Guardrail',
  'Scope Guard,',
  'Canonical Lenses',
  'Canonical Review Lenses',
  'Canonical RDD Lenses',
  'Lentes Canónicos',
];

const VERIFIER = 'Red→Green TDD Verifier';
const AST_RE = /\bAST\b/;

function findForbidden(text) {
  return FORBIDDEN.filter((phrase) => text.includes(phrase));
}

/** Lines mentioning AST that are not explicitly about Python's `ast`. */
function vagueAstLines(text) {
  return text
    .split('\n')
    .filter((line) => AST_RE.test(line))
    .filter((line) => !/Python AST|Python `ast`/.test(line));
}

function loadAdapters() {
  return fs
    .readdirSync(ADAPTERS_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'base.js')
    .map((f) => {
      const Adapter = require(path.join(ADAPTERS_DIR, f));
      return { file: f, adapter: new Adapter() };
    });
}

/** Everything an adapter installs as text: AGENTS.md, safeguards, tool descriptions. */
function adapterText(adapter) {
  const dir = createTmpProject({});
  try {
    adapter.provision(dir, {});
    const agentsMd = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    const safeguards = adapter.getSafeguards().join('\n');
    const descriptions = adapter.getTools().map((t) => t.description).join('\n');
    return [agentsMd, safeguards, descriptions].join('\n');
  } finally {
    teardown(dir);
  }
}

function manifestFiles(adapter) {
  return adapter.getTools().map((t) => t.path).filter(Boolean);
}

describe('honest claims — adapters', () => {
  for (const { file, adapter } of loadAdapters()) {
    describe(file, () => {
      const text = adapterText(adapter);
      const files = manifestFiles(adapter);
      const hasVerifier = adapter.getTools().some((t) => t.name === 'verify_tdd');
      const hasAstGuard = files.some((f) => REAL_AST_GUARDS.includes(f));

      it('contains no overstated phrases', () => {
        assert.deepStrictEqual(findForbidden(text), []);
      });

      it(`mentions the ${VERIFIER} only when verify_tdd is installed`, () => {
        assert.strictEqual(text.includes(VERIFIER), hasVerifier);
      });

      it('mentions AST only for guards that really use Python ast', () => {
        if (hasAstGuard) {
          assert.deepStrictEqual(vagueAstLines(text), []);
        } else {
          assert.ok(!AST_RE.test(text), `unexpected AST claim in ${file}`);
        }
      });
    });
  }
});

describe('honest claims — fallback AGENTS.md (no adapter)', () => {
  for (const projectType of ['backend', 'frontend', 'unknown']) {
    it(`${projectType}: no overstated phrases, no vague AST, no verifier claim`, () => {
      const dir = createTmpProject({});
      try {
        generateHarness(dir, { projectType, framework: 'Generic', testRunner: 'npm test', adapter: null });
        const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        assert.deepStrictEqual(findForbidden(text), []);
        assert.deepStrictEqual(vagueAstLines(text), []);
        assert.ok(!text.includes(VERIFIER), 'fallback installs no TDD verifier');
      } finally {
        teardown(dir);
      }
    });
  }
});

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdown(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

describe('honest claims — shipped docs', () => {
  const docs = [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'README.es.md'),
    path.join(ROOT, 'AGENTS.md'),
    ...listMarkdown(path.join(ROOT, '.agents', 'skills', 'clckernel_cli')),
    ...listMarkdown(path.join(ROOT, '.agents', 'skills', 'clc_forge_cli')),
  ];

  for (const doc of docs) {
    const rel = path.relative(ROOT, doc);
    it(`${rel} contains no overstated phrases`, () => {
      const text = fs.readFileSync(doc, 'utf-8');
      assert.deepStrictEqual(findForbidden(text), []);
    });

    it(`${rel} mentions AST only about Python ast`, () => {
      const text = fs.readFileSync(doc, 'utf-8');
      assert.deepStrictEqual(vagueAstLines(text), []);
    });
  }
});

describe('honest claims — catalog and tool docstrings', () => {
  it('catalog `checks` texts contain no overstated phrases', () => {
    const offenders = CATALOG
      .filter((entry) => findForbidden(entry.checks).length > 0 || /idempoten|eager/i.test(entry.checks))
      .map((entry) => `${entry.name}: ${entry.checks}`);
    assert.deepStrictEqual(offenders, []);
  });

  it('catalog `checks` mention AST only for real-ast guards', () => {
    const offenders = CATALOG
      .filter((entry) => AST_RE.test(entry.checks))
      .filter((entry) => !String(entry.file || '').split('+').some((f) => REAL_AST_GUARDS.includes(f)))
      .map((entry) => `${entry.name}: ${entry.checks}`);
    assert.deepStrictEqual(offenders, []);
  });

  it('tool sources contain no overstated phrases', () => {
    const toolsDir = path.join(ROOT, 'tools');
    const offenders = fs
      .readdirSync(toolsDir)
      .filter((f) => /\.(js|py)$/.test(f))
      .flatMap((f) => {
        const text = fs.readFileSync(path.join(toolsDir, f), 'utf-8');
        return findForbidden(text).map((phrase) => `${f}: ${phrase}`);
      });
    assert.deepStrictEqual(offenders, []);
  });
});
