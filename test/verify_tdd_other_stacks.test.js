/**
 * sdds/tdd-other-stacks: tools/verify_tdd.js proves red→green for Go (go test),
 * Rust (cargo test integration tests), Ruby (RSpec / Minitest through bundler)
 * and PHP (Pest / PHPUnit), with the same algorithm as for JS/TS: trees
 * materialized from git, changed tests overlaid on BASE for red, green on
 * CANDIDATE, one group per (language, nearest project root), fail closed.
 *
 * The matrix runs on a hermetic PATH (symlinks to git, node and tar, plus the
 * fake runners of test/helpers/fake_runners.js); a few cases use the real cargo
 * and Ruby toolchains and are skipped when those are absent.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { createGitRepo, stageFiles, teardown } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const VERIFY = path.join(ROOT, 'tools', 'verify_tdd.js');
const FAKE = path.join(__dirname, 'helpers', 'fake_runners.js');

function whichSync(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const file = path.join(dir, cmd);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch { /* next */ }
  }
  return null;
}

/** A bin dir holding only git, node, tar and the requested fake runners. */
function hermeticBin(fakes = []) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-fakebin-'));
  fs.symlinkSync(whichSync('git'), path.join(bin, 'git'));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.symlinkSync(whichSync('tar'), path.join(bin, 'tar'));
  for (const name of fakes) installFake(path.join(bin, name));
  return bin;
}

function installFake(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(FAKE, file);
  fs.chmodSync(file, 0o755);
}

function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && key !== 'NODE_TEST_CONTEXT') env[key] = value;
  }
  return { ...env, CLC_TDD_TIMEOUT: '120', ...extra };
}

function runVerifier(dir, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VERIFY, dir], { cwd: dir, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* asserted below */ }
      resolve({ status, result: parsed, raw: `${stdout}\n${stderr}` });
    });
  });
}

function assertOutcome(res, status, fragment) {
  assert.ok(res.result, `verify_tdd.js printed no JSON (status ${res.status}):\n${res.raw}`);
  assert.strictEqual(res.status, status, `expected exit ${status}, got ${res.status}:\n${res.raw}`);
  assert.strictEqual(res.result.exitCode, status);
  assert.strictEqual(res.result.name, 'verify_tdd');
  assert.match(res.result.data.message, fragment, res.raw);
}

const test = (needs, cases, c = '//') =>
  `${needs.map(([file, token]) => `${c} NEEDS ${file} ${token}`).join('\n')}\n${cases.map((n) => `${c} CASE ${n}`).join('\n')}\n`;

const exported = (tok) => tok[0].toUpperCase() + tok.slice(1);

/**
 * Per language: the committed base project, the code file and a test file,
 * the fakes it needs on PATH (or in vendor/bin), the hint for a missing runner.
 */
const LANGS = {
  go: {
    runner: 'go test',
    fakes: ['go'],
    base: {
      'go.mod': 'module example.com/calc\n\ngo 1.21\n',
      'calc/calc.go': 'package calc\n\nfunc Add(a, b int) int { return a + b }\n',
      'calc/calc_test.go': `package calc\n${test([['calc/calc.go', 'Add']], ['TestAdd'])}`,
    },
    code: 'calc/calc.go',
    codeWith: (tok) => `package calc\n\nfunc Add(a, b int) int { return a + b }\nfunc ${exported(tok)}(a, b int) int { return a * b }\n`,
    test: 'calc/calc_test.go',
    testFor: (tok, cases) => `package calc\n${test([['calc/calc.go', exported(tok)]], cases)}`,
    missing: /go is not on PATH/,
  },
  rust: {
    runner: 'cargo test',
    fakes: ['cargo'],
    base: {
      'Cargo.toml': '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n',
      '.gitignore': 'target/\n',
      'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n',
      'tests/calc.rs': test([['src/lib.rs', 'add']], ['adds']),
    },
    code: 'src/lib.rs',
    codeWith: (tok) => `pub fn add(a: i32, b: i32) -> i32 { a + b }\npub fn ${tok}(a: i32, b: i32) -> i32 { a * b }\n`,
    test: 'tests/calc.rs',
    testFor: (tok, cases) => test([['src/lib.rs', tok]], cases),
    missing: /cargo is not on PATH/,
  },
  ruby: {
    runner: 'minitest',
    fakes: ['bundle'],
    base: {
      Gemfile: "source 'https://rubygems.org'\ngem 'minitest'\n",
      'lib/calc.rb': 'module Calc\n  def self.add(a, b) = a + b\nend\n',
      'test/calc_test.rb': test([['lib/calc.rb', 'add']], ['test_add'], '#'),
    },
    code: 'lib/calc.rb',
    codeWith: (tok) => `module Calc\n  def self.add(a, b) = a + b\n  def self.${tok}(a, b) = a * b\nend\n`,
    test: 'test/calc_test.rb',
    testFor: (tok, cases) => test([['lib/calc.rb', tok]], cases, '#'),
    missing: /bundle is not on PATH/,
  },
  php: {
    runner: 'phpunit',
    fakes: [],
    vendorBin: ['phpunit'],
    base: {
      'composer.json': '{ "name": "acme/calc" }\n',
      '.gitignore': 'vendor/\n',
      'app/Calc.php': '<?php\nclass Calc { public static function add($a, $b) { return $a + $b; } }\n',
      'tests/Unit/CalcTest.php': `<?php\n${test([['app/Calc.php', 'add']], ['test_add'])}`,
    },
    code: 'app/Calc.php',
    codeWith: (tok) => `<?php\nclass Calc {\n  public static function add($a, $b) { return $a + $b; }\n  public static function ${tok}($a, $b) { return $a * $b; }\n}\n`,
    test: 'tests/Unit/CalcTest.php',
    testFor: (tok, cases) => `<?php\n${test([['app/Calc.php', tok]], cases)}`,
    missing: /composer install/,
  },
};

/** Installs the project's vendor/ (gitignored) with an autoloader and fake runners. */
function installVendor(dir, bins) {
  fs.mkdirSync(path.join(dir, 'vendor', 'composer'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'vendor', 'acme', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor', 'autoload.php'), "<?php\nrequire __DIR__ . '/composer/autoload_real.php';\n");
  fs.writeFileSync(path.join(dir, 'vendor', 'composer', 'autoload_real.php'), '<?php\n');
  fs.writeFileSync(path.join(dir, 'vendor', 'acme', 'lib', 'Lib.php'), '<?php\n');
  for (const bin of bins) installFake(path.join(dir, 'vendor', 'bin', bin));
}

function prefixed(files, prefix) {
  return Object.fromEntries(Object.entries(files).map(([rel, content]) => [`${prefix}${rel}`, content]));
}

/**
 * Builds the repo (base committed), stages `staged`, runs the verifier on a
 * hermetic PATH and cleans up. `fakes: false` leaves the runner out.
 */
async function scenario(lang, staged, { fakes = true, prefixes = [''], vendorBin } = {}) {
  const spec = LANGS[lang];
  const base = Object.assign({}, ...prefixes.map((p) => prefixed(spec.base, p)));
  const dir = createGitRepo(base);
  const bin = hermeticBin(fakes ? spec.fakes : []);
  try {
    for (const p of prefixes) {
      const bins = vendorBin || spec.vendorBin;
      if (bins && fakes) installVendor(path.join(dir, p), bins);
    }
    stageFiles(dir, staged);
    return await runVerifier(dir, cleanEnv({ PATH: bin }));
  } finally {
    teardown(dir);
    teardown(bin);
  }
}

for (const [lang, spec] of Object.entries(LANGS)) {
  describe(`verify_tdd.js — ${lang} (fake ${spec.runner})`, { concurrency: true }, () => {
    it('proper TDD: the changed test fails on BASE and passes with the change -> exit 0', async () => {
      const res = await scenario(lang, { [spec.code]: spec.codeWith('mul'), [spec.test]: spec.testFor('mul', ['one']) });
      assertOutcome(res, 0, /red->green verified/);
      assert.strictEqual(res.result.data.runner, spec.runner);
      assert.deepStrictEqual(res.result.data.changed_code, [spec.code]);
      assert.deepStrictEqual(res.result.data.changed_tests, [spec.test]);
    });

    it('production code without a changed test -> exit 1', async () => {
      const res = await scenario(lang, { [spec.code]: spec.codeWith('mul') });
      assertOutcome(res, 1, /No test evidence/);
    });

    it('a changed test that already passes on BASE -> exit 1', async () => {
      const res = await scenario(lang, { [spec.code]: spec.codeWith('mul'), [spec.test]: spec.testFor('add', ['one']) });
      assertOutcome(res, 1, /pass without the change/);
    });

    it('a changed test that fails with the change -> exit 1', async () => {
      const res = await scenario(lang, { [spec.code]: spec.codeWith('mul'), [spec.test]: spec.testFor('div', ['one']) });
      assertOutcome(res, 1, /do not pass with the change/);
    });

    it('green with zero tests executed -> exit 1', async () => {
      const res = await scenario(lang, { [spec.code]: spec.codeWith('mul'), [spec.test]: spec.testFor('mul', []) });
      assertOutcome(res, 1, /no tests executed/);
    });

    it('runner missing -> fails closed with an install hint', async () => {
      const res = await scenario(lang, { [spec.code]: spec.codeWith('mul'), [spec.test]: spec.testFor('mul', ['one']) }, { fakes: false });
      assertOutcome(res, 1, spec.missing);
    });

    it('two project roots: code in svc/b without a test there fails, though svc/a is proper TDD', async () => {
      const res = await scenario(lang, {
        [`svc/a/${spec.code}`]: spec.codeWith('mul'),
        [`svc/a/${spec.test}`]: spec.testFor('mul', ['one']),
        [`svc/b/${spec.code}`]: spec.codeWith('mul'),
      }, { prefixes: ['svc/a/', 'svc/b/'] });
      assertOutcome(res, 1, new RegExp(`\\[svc/b \\(${lang}\\)\\] No test evidence`));
      const groups = res.result.data.groups;
      assert.deepStrictEqual(groups.map((g) => [g.root, g.language, g.exit_code]), [['svc/a', lang, 0], ['svc/b', lang, 1]]);
    });

    it('two project roots, both proper TDD -> exit 0', async () => {
      const res = await scenario(lang, {
        [`svc/a/${spec.code}`]: spec.codeWith('mul'),
        [`svc/a/${spec.test}`]: spec.testFor('mul', ['one']),
        [`svc/b/${spec.code}`]: spec.codeWith('mul'),
        [`svc/b/${spec.test}`]: spec.testFor('mul', ['one', 'two']),
      }, { prefixes: ['svc/a/', 'svc/b/'] });
      assertOutcome(res, 0, /red->green verified/);
    });
  });
}

describe('verify_tdd.js — other stacks: scope and dependencies', { concurrency: true }, () => {
  it('a .rb file outside any Gemfile project is out of scope, as before', async () => {
    const dir = createGitRepo({ 'README.md': '# x\n' }, { 'scripts/tool.rb': 'puts 1\n' });
    const bin = hermeticBin();
    try {
      const res = await runVerifier(dir, cleanEnv({ PATH: bin }));
      assertOutcome(res, 0, /nothing to verify/);
    } finally {
      teardown(dir);
      teardown(bin);
    }
  });

  it('go: files under vendor/ are not production code', async () => {
    const res = await scenario('go', { 'vendor/example.com/dep/dep.go': 'package dep\n' });
    assertOutcome(res, 0, /nothing to verify/);
  });

  it('ruby: config/ and db/ files are not production code', async () => {
    const res = await scenario('ruby', {
      'config/routes.rb': 'x = 1\n',
      'db/migrate/001_x.rb': 'x = 1\n',
    });
    assertOutcome(res, 0, /nothing to verify/);
  });

  it('rust: cargo builds into a temp CARGO_TARGET_DIR, never the project target/', async () => {
    const dir = createGitRepo(LANGS.rust.base, { 'src/lib.rs': LANGS.rust.codeWith('mul'), 'tests/calc.rs': LANGS.rust.testFor('mul', ['one']) });
    const bin = hermeticBin(['cargo']);
    try {
      const res = await runVerifier(dir, cleanEnv({ PATH: bin }));
      assertOutcome(res, 0, /red->green verified/);
      assert.ok(!fs.existsSync(path.join(dir, 'target')), 'project target/ must not be created');
    } finally {
      teardown(dir);
      teardown(bin);
    }
  });

  it('rust: a helper under tests/common/ is support, not evidence', async () => {
    const res = await scenario('rust', { 'src/lib.rs': LANGS.rust.codeWith('mul'), 'tests/common/mod.rs': '// helper\n' });
    assertOutcome(res, 1, /No test evidence/);
    assert.deepStrictEqual(res.result.data.changed_support, ['tests/common/mod.rs']);
  });

  it('ruby: RSpec specs run with bundle exec rspec when rspec-core is locked', async () => {
    const res = await scenario('ruby', {
      'Gemfile.lock': 'GEM\n  specs:\n    rspec-core (3.13.0)\n',
      'lib/calc.rb': LANGS.ruby.codeWith('mul'),
      'spec/calc_spec.rb': LANGS.ruby.testFor('mul', ['one']),
    });
    assertOutcome(res, 0, /red->green verified/);
    assert.strictEqual(res.result.data.runner, 'rspec');
  });

  it('ruby: specs without rspec-core in Gemfile.lock fail closed', async () => {
    const res = await scenario('ruby', {
      'lib/calc.rb': LANGS.ruby.codeWith('mul'),
      'spec/calc_spec.rb': LANGS.ruby.testFor('mul', ['one']),
    });
    assertOutcome(res, 1, /rspec-core/);
  });

  it('php: Pest is preferred when vendor/bin/pest exists', async () => {
    const res = await scenario('php', {
      'app/Calc.php': LANGS.php.codeWith('mul'),
      'tests/Unit/CalcTest.php': LANGS.php.testFor('mul', ['one']),
      'tests/Feature/OtherTest.php': LANGS.php.testFor('mul', ['two']),
    }, { vendorBin: ['pest', 'phpunit'] });
    assertOutcome(res, 0, /red->green verified/);
    assert.strictEqual(res.result.data.runner, 'pest');
  });

  it('php: PHPUnit runs once per changed test file', async () => {
    const res = await scenario('php', {
      'app/Calc.php': LANGS.php.codeWith('mul'),
      'tests/Unit/CalcTest.php': LANGS.php.testFor('mul', ['one']),
      'tests/Feature/OtherTest.php': LANGS.php.testFor('mul', ['two']),
    });
    assertOutcome(res, 0, /red->green verified: 2 test file/);
  });

  it('a Ruby group and a JS group at the same root are verified separately', async () => {
    const res = await scenario('ruby', {
      'package.json': '{ "name": "web", "private": true }\n',
      'lib/calc.rb': LANGS.ruby.codeWith('mul'),
      'test/calc_test.rb': LANGS.ruby.testFor('mul', ['one']),
      'src/sum.js': 'module.exports = 1;\n',
    });
    assertOutcome(res, 1, /\[\.\] No test evidence/);
    assert.deepStrictEqual(res.result.data.groups.map((g) => [g.language, g.exit_code]), [['ruby', 0], ['js', 1]]);
  });
});

// ---------------------------------------------------------------- real toolchains

const cargo = whichSync('cargo');

describe('verify_tdd.js — real cargo', { skip: cargo ? false : 'cargo is not installed' }, () => {
  it('a tiny crate: new integration test fails to compile on BASE and passes with the change', async () => {
    const dir = createGitRepo({
      'Cargo.toml': '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
      '.gitignore': 'target/\n',
      'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n',
    }, {
      'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\npub fn mul(a: i32, b: i32) -> i32 { a * b }\n',
      'tests/calc.rs': '#[test]\nfn multiplies() {\n    assert_eq!(calc::mul(2, 3), 6);\n}\n',
    });
    try {
      const res = await runVerifier(dir, cleanEnv());
      assertOutcome(res, 0, /red->green verified/);
      assert.match(res.result.data.red.output, /mul/);
      assert.ok(!fs.existsSync(path.join(dir, 'target')), 'project target/ must not be created');
    } finally {
      teardown(dir);
    }
  });
});

function rubyReady() {
  if (!whichSync('bundle') || !whichSync('ruby')) return 'ruby/bundler is not installed';
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'clc-ruby-probe-'));
  try {
    fs.writeFileSync(path.join(probe, 'Gemfile'), "source 'https://rubygems.org'\ngem 'minitest'\n");
    const res = spawnSync('bundle', ['lock', '--local'], { cwd: probe, encoding: 'utf-8', env: cleanEnv({ BUNDLE_GEMFILE: path.join(probe, 'Gemfile') }) });
    return res.status === 0 ? fs.readFileSync(path.join(probe, 'Gemfile.lock'), 'utf-8') : 'minitest is not installed locally';
  } finally {
    teardown(probe);
  }
}

const rubyLock = rubyReady();
const rubySkip = rubyLock.startsWith('GEM') ? false : rubyLock;

describe('verify_tdd.js — real Ruby (Minitest through bundler)', { skip: rubySkip }, () => {
  it('a new test fails on BASE (NoMethodError) and passes with the change', async () => {
    const dir = createGitRepo({
      Gemfile: "source 'https://rubygems.org'\ngem 'minitest'\n",
      'Gemfile.lock': rubyLock,
      'lib/calc.rb': 'module Calc\n  def self.add(a, b)\n    a + b\n  end\nend\n',
    }, {
      'lib/calc.rb': 'module Calc\n  def self.add(a, b)\n    a + b\n  end\n\n  def self.mul(a, b)\n    a * b\n  end\nend\n',
      'test/calc_test.rb': "require 'minitest/autorun'\nrequire 'calc'\n\nclass CalcTest < Minitest::Test\n  def test_mul\n    assert_equal 6, Calc.mul(2, 3)\n  end\nend\n",
    });
    try {
      const res = await runVerifier(dir, cleanEnv());
      assertOutcome(res, 0, /red->green verified/);
      assert.match(res.result.data.green.output, /1 runs/);
    } finally {
      teardown(dir);
    }
  });
});

// ---------------------------------------------------------------- install

describe('verify_tdd.js is installed for Go, Rust, Rails and Laravel', () => {
  for (const file of ['go', 'rust', 'rails', 'laravel']) {
    it(`${file}: the manifest runs node tools/verify_tdd.js before check_custom`, () => {
      const Adapter = require(path.join(ROOT, 'src', 'adapters', `${file}.js`));
      const names = new Adapter().getTools().map((t) => t.name);
      const tdd = new Adapter().getTools().find((t) => t.name === 'verify_tdd');
      assert.ok(tdd, `${file}: verify_tdd must be in the manifest`);
      assert.strictEqual(tdd.path, 'verify_tdd.js');
      assert.strictEqual(tdd.command, 'node tools/verify_tdd.js');
      assert.ok(names.indexOf('verify_tdd') < names.indexOf('check_custom'), names.join(', '));
    });
  }
});
