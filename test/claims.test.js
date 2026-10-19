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
  // sdds/residual-fixes item 4: no guard run proves code "100%" correct.
  '100% Verified',
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

describe('honest claims — website hook example (sdds/residual-fixes item 4)', () => {
  const text = fs.readFileSync(path.join(ROOT, 'website', 'src', 'components', 'HarnessFileTree.astro'), 'utf-8');

  it('shows the hook the kernel writes: .githooks/pre-commit calling the orchestrators with --hook', () => {
    assert.match(text, /\.githooks\/pre-commit/);
    assert.match(text, /node tools\/audit\.js --hook/);
    assert.match(text, /python3 tools\/audit\.py --hook/);
  });

  it('no longer presents .husky/pre-commit as the default hook', () => {
    assert.doesNotMatch(text, /path: '\.husky\/pre-commit'/);
  });
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

// sdds/final-sweep item 1: every website page describes the hook the kernel
// writes (src/generator.js writeHook): .githooks/pre-commit (.husky only when
// Husky already owns core.hooksPath) calling the audit orchestrators with
// --hook; install is `npx clckernel` / `npx clckernel . --yes` (the CLI
// rejects `start`, an agent command); config examples use real keys.
describe('honest claims — website hook, install command and config (sdds/final-sweep)', () => {
  const files = listWebsiteSources(path.join(ROOT, 'website', 'src'));
  const read = (file) => fs.readFileSync(file, 'utf-8');
  const rel = (file) => path.relative(ROOT, file);
  const HOOK_EXAMPLE_RE = /Hook (installed|instalado)|pre-commit — git hook|Pre-commit lock/;

  it('website pages that show a hook example show the orchestrators with --hook', () => {
    const shown = files.filter((file) => HOOK_EXAMPLE_RE.test(read(file)));
    assert.ok(shown.length > 0, 'expected hook examples in website/src');
    const offenders = shown.filter((file) => !/tools\/audit\.(js|py) --hook/.test(read(file))).map(rel);
    assert.deepStrictEqual(offenders, []);
  });

  it('no website page presents .husky/pre-commit as the installed hook', () => {
    const offenders = files.flatMap((file) => read(file).split('\n').flatMap((line, i) => {
      if (!line.includes('.husky/pre-commit')) return [];
      // Allowed only where the text states the Husky exception.
      if (/Husky/.test(line.replace('.husky/pre-commit', ''))) return [];
      return [`${rel(file)}:${i + 1}: ${line.trim()}`];
    }));
    assert.deepStrictEqual(offenders, []);
  });

  it('no website page lists single guards as the hook body', () => {
    const offenders = files.filter((file) => /Hook (installed|instalado): [^\n]*-> (node|python3) tools\/(scan_|check_)/.test(read(file))).map(rel);
    assert.deepStrictEqual(offenders, []);
  });

  it('neither the website nor the READMEs present `npx clckernel start` (the CLI rejects it)', () => {
    const docs = [...files, path.join(ROOT, 'README.md'), path.join(ROOT, 'README.es.md')];
    const offenders = docs.filter((file) => /npx clckernel start/.test(read(file))).map(rel);
    assert.deepStrictEqual(offenders, []);
  });

  it('website .clckernel.yaml examples use only keys tools/_config.js knows', () => {
    const invented = /^(version|framework|test_runner|safeguards|custom_guards|project_type|execution_phases):/m;
    const offenders = files.filter((file) => invented.test(read(file))).map(rel);
    assert.deepStrictEqual(offenders, []);
  });

  it('no website page shows an audit flag the orchestrators do not have', () => {
    const offenders = files.filter((file) => /tools\/audit\.(js|py) --strict/.test(read(file))).map(rel);
    assert.deepStrictEqual(offenders, []);
  });
});

// sdds/final-sweep item 3: the READMEs state their known limitations.
describe('honest claims — known limitations (sdds/final-sweep)', () => {
  const cases = [
    ['README.md', /## [^\n]*Known limitations/],
    ['README.es.md', /## [^\n]*Limitaciones conocidas/],
  ];
  for (const [file, heading] of cases) {
    it(`${file} has a known-limitations section with the facts`, () => {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      assert.match(text, heading);
      const section = text.slice(text.search(heading)).split(/\n## /)[0];
      assert.match(section, /Windows/);
      assert.match(section, /Git Bash/);
      assert.match(section, /tools\/\.clckernel-managed\.json/);
      assert.match(section, /lint-staged/);
      assert.match(section, /#\[cfg\(test\)\]|Rust/);
    });
  }

  it('CONTRIBUTING.md has a known-limitations section', () => {
    const text = fs.readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf-8');
    assert.match(text, /## Known limitations/);
    assert.match(text, /Windows/);
  });
});

// sdds/final-sweep item 4: the shipped playbooks and the AGENTS.md templates
// describe the current CLI and config.
describe('honest claims — playbooks and AGENTS.md vs the CLI (sdds/final-sweep)', () => {
  const SKILL_DIR = path.join(ROOT, '.agents', 'skills', 'clckernel_cli');
  const skill = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf-8');
  const START_MATERIALIZES = /materiali[sz]e `?\.clckernel\.yaml|initiali[sz]e `?\.clckernel\.yaml/i;

  function generatedAgentsMd() {
    const texts = loadAdapters().map(({ adapter }) => {
      const dir = createTmpProject({});
      try {
        adapter.provision(dir, {});
        return fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      } finally {
        teardown(dir);
      }
    });
    const dir = createTmpProject({});
    try {
      generateHarness(dir, { projectType: 'backend', framework: 'Generic', testRunner: 'npm test', adapter: null });
      texts.push(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8'));
    } finally {
      teardown(dir);
    }
    return texts;
  }

  it('AGENTS.md templates name the real CLI options and never say start materializes the config', () => {
    const texts = generatedAgentsMd();
    for (const text of texts) assert.doesNotMatch(text, START_MATERIALIZES);
    // Only the templates with a command table (fallback, multi-part, Agent-OS) describe commands.
    const withTable = texts.filter((text) => text.includes('Universal Command Interface'));
    assert.ok(withTable.length >= 2, 'expected the fallback and Agent-OS command tables');
    for (const text of withTable) {
      assert.match(text, /clckernel audit \[dir\] \[--change <name>\]/);
      assert.match(text, /--dry-run/);
      assert.match(text, /--add-guards/);
      assert.match(text, /npx clckernel \. --yes/);
    }
  });

  it('the skill never says start initializes the config', () => {
    assert.doesNotMatch(skill('SKILL.md'), START_MATERIALIZES);
  });

  it('playbooks list every config key, severities included', () => {
    for (const rel of ['reference/start.md', 'reference/doctor.md']) {
      assert.match(skill(rel), /`severities`/, rel);
    }
  });

  it('update.md runs the CLI and does not claim retired guards are moved', () => {
    const text = skill('reference/update.md');
    assert.match(text, /npx clckernel update/);
    assert.match(text, /--dry-run/);
    assert.match(text, /--add-guards/);
    assert.doesNotMatch(text, /moved into `tools\/guards\/`/);
    assert.match(text, /--hook/);
  });

  it('audit.md and doctor.md name the CLI entry points', () => {
    assert.match(skill('reference/audit.md'), /clckernel audit \[dir\] \[--change <name>\]/);
    assert.match(skill('reference/doctor.md'), /npx clckernel doctor/);
  });
});
