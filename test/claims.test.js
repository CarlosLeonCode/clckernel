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

// Residual claims (sdds/residual-claims): performance, accuracy, guards and
// orchestrators the code does not have. Also scanned in website/src/**.
const RESIDUAL_FORBIDDEN = [
  /<\s?5\s?ms/,
  '0 false positives',
  '0 falsos positivos',
  'Pydantic V2',
  'Memory Guard',
  'PR Generator',
  'audit.rb',
  'audit.go',
  'audit.php',
  '.git/hooks/pre-commit',
  '100% compliance',
  '100% de cumplimiento',
  '100% of the CLC Kernel standard',
  // sdds/agent-os-generic: no guard validates data files against a schema.
  /strict schema validation/i,
  /validación estricta de esquemas/i,
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
  ...RESIDUAL_FORBIDDEN,
];

const VERIFIER = 'Red→Green TDD Verifier';
const AST_RE = /\bAST\b/;

function matches(text, phrase) {
  return phrase instanceof RegExp ? phrase.test(text) : text.includes(phrase);
}

function findForbidden(text, phrases = FORBIDDEN) {
  return phrases.filter((phrase) => matches(text, phrase)).map(String);
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

// sdds/fullstack-monorepo, decision 6: a multi-part AGENTS.md makes the same
// honest claims: the verifier is named only when some part installs it.
describe('honest claims — multi-part AGENTS.md', () => {
  const { autoDetectStack } = require('../src/detector');
  const { git } = require('./helpers');
  const PKG = (deps) => JSON.stringify({ name: 'x', private: true, dependencies: deps });
  const FIXTURES = {
    'Next.js + backend/ FastAPI': { 'package.json': PKG({ next: '14' }), 'backend/requirements.txt': 'fastapi\n' },
    'frontend/ Astro + backend/ Go': { 'frontend/package.json': PKG({ astro: '4' }), 'backend/go.mod': 'module x\n' },
    'server/ Go + api/ Rust': { 'server/go.mod': 'module x\n', 'api/Cargo.toml': '[package]\nname = "x"\n' },
  };

  for (const [name, files] of Object.entries(FIXTURES)) {
    it(`${name}: no overstated phrases, no vague AST, verifier iff a part installs it`, () => {
      const dir = createTmpProject(files);
      const warn = console.warn;
      try {
        git(dir, 'init', '-q');
        const config = autoDetectStack(dir);
        assert.ok(config.parts && config.parts.length === 2, `expected two parts in ${name}`);
        console.warn = () => {};
        generateHarness(dir, config);
        const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        const hasVerifier = config.parts.some((p) => p.adapter.getTools(dir).some((t) => t.name === 'verify_tdd'));
        assert.deepStrictEqual(findForbidden(text), []);
        assert.strictEqual(text.includes(VERIFIER), hasVerifier);
        const hasAstGuard = config.parts.some((p) => manifestFiles(p.adapter).some((f) => REAL_AST_GUARDS.includes(f)));
        if (hasAstGuard) assert.deepStrictEqual(vagueAstLines(text), []);
        else assert.ok(!AST_RE.test(text), `unexpected AST claim in ${name}`);
      } finally {
        console.warn = warn;
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

function listWebsiteSources(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listWebsiteSources(full);
    return /\.(astro|js)$/.test(entry.name) ? [full] : [];
  });
}

describe('honest claims — website sources', () => {
  const files = listWebsiteSources(path.join(ROOT, 'website', 'src'));

  it('finds website sources to scan', () => {
    assert.ok(files.length > 0, 'expected .astro/.js files under website/src');
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    it(`${rel} contains no residual overstated claims`, () => {
      const text = fs.readFileSync(file, 'utf-8');
      assert.deepStrictEqual(findForbidden(text, RESIDUAL_FORBIDDEN), []);
    });
  }
});

describe('honest claims — doctor summary', () => {
  it('src/doctor.js reports a concrete check count, not a percentage', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src', 'doctor.js'), 'utf-8');
    assert.deepStrictEqual(findForbidden(text), []);
  });
});

// Canonical config name is `.clckernel.yaml`. The other spellings may appear
// only in a compatibility list, i.e. a line naming all four supported names.
const CONFIG_NAMES = ['.clckernel.yaml', '.clckernel.yml', '.clc-forge.yaml', '.clc-forge.yml'];
const NON_CANONICAL_CONFIG_RE = /\.clc-forge\.ya?ml|\.clckernel\.yml(?![a-z])/;

function listTextFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__pycache__' ? [] : listTextFiles(full);
    return /\.(js|py|sh|md)$/.test(entry.name) ? [full] : [];
  });
}

describe('honest claims — config file name', () => {
  it('src/, tools/, bin/, READMEs and the skill name only .clckernel.yaml outside compatibility lists', () => {
    const files = [
      ...listTextFiles(path.join(ROOT, 'src')),
      ...listTextFiles(path.join(ROOT, 'tools')),
      ...listTextFiles(path.join(ROOT, 'bin')),
      ...listTextFiles(path.join(ROOT, '.agents', 'skills', 'clckernel_cli')),
      path.join(ROOT, 'README.md'),
      path.join(ROOT, 'README.es.md'),
    ];
    const offenders = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        if (!NON_CANONICAL_CONFIG_RE.test(line)) return;
        if (CONFIG_NAMES.every((name) => line.includes(`'${name}'`))) return;
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepStrictEqual(offenders, []);
  });

  it('safeguard descriptions installed by adapters name .clckernel.yaml', () => {
    const text = CATALOG.map((entry) => entry.checks).join('\n');
    assert.doesNotMatch(text, NON_CANONICAL_CONFIG_RE);
  });
});

// sdds/domain-agnostic, decision 6: the kernel names no business domain. The
// removed domain guards and their folder appear nowhere in what is shipped or
// installed, nor in the website. Since sdds/unified-discovery src/updater.js
// names them nowhere either: retired kernel guards are recognised by registry
// or published hash, not by name. CHANGELOG.md is the historical record and
// is exempt.
const DOMAIN_FORBIDDEN = ['content-calendar', 'check_domain_data', 'check_test_calendar_sync'];

function domainOffenders(file, text) {
  const rel = path.relative(ROOT, file);
  return text.split('\n').flatMap((line, i) => {
    return DOMAIN_FORBIDDEN.filter((word) => line.includes(word)).map((word) => `${rel}:${i + 1}: ${word}`);
  });
}

describe('honest claims — no business domain in the kernel', () => {
  it('src/, tools/, bin/, READMEs, AGENTS.md, the skill and website/src name no domain guard', () => {
    const files = [
      ...listTextFiles(path.join(ROOT, 'src')),
      ...listTextFiles(path.join(ROOT, 'tools')),
      ...listTextFiles(path.join(ROOT, 'bin')),
      ...listTextFiles(path.join(ROOT, '.agents', 'skills', 'clckernel_cli')),
      ...listWebsiteSources(path.join(ROOT, 'website', 'src')),
      path.join(ROOT, 'README.md'),
      path.join(ROOT, 'README.es.md'),
      path.join(ROOT, 'AGENTS.md'),
    ];
    const offenders = files.flatMap((file) => domainOffenders(file, fs.readFileSync(file, 'utf-8')));
    assert.deepStrictEqual(offenders, []);
  });

  it('the catalog and every adapter\'s installed text (AGENTS.md, safeguards, tools) name no domain guard', () => {
    const texts = [
      JSON.stringify(CATALOG),
      ...loadAdapters().map(({ adapter }) => adapterText(adapter)),
    ];
    for (const text of texts) {
      assert.deepStrictEqual(DOMAIN_FORBIDDEN.filter((word) => text.includes(word)), []);
    }
  });

  it('the Agent-OS AGENTS.md generated next to a content-calendar/ folder names no domain guard', () => {
    const dir = createTmpProject({ 'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\n', 'content-calendar/x.json': '{}\n' });
    try {
      const { autoDetectStack } = require('../src/detector');
      generateHarness(dir, autoDetectStack(dir));
      const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.deepStrictEqual(['check_domain_data', 'check_test_calendar_sync'].filter((word) => text.includes(word)), []);
    } finally {
      teardown(dir);
    }
  });
});
