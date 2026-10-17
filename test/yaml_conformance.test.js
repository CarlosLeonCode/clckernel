/**
 * YAML subset conformance suite.
 *
 * Every fixture in test/fixtures/yaml/valid must parse to its sibling .json in
 * the JS parser (tools/yaml.js), the Python fallback parser
 * (check_custom._minimal_yaml_parse, forced even when PyYAML is installed) and
 * PyYAML itself when it is importable (oracle; skipped otherwise).
 *
 * Every fixture in test/fixtures/yaml/invalid must be rejected by both of our
 * parsers with an error that names the offending line.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const { parseYaml } = require('../tools/yaml.js');

const toolsDir = path.resolve(__dirname, '..', 'tools');
const fixturesDir = path.join(__dirname, 'fixtures', 'yaml');
const validDir = path.join(fixturesDir, 'valid');
const invalidDir = path.join(fixturesDir, 'invalid');

const LINE_RE = /line \d+/;

function listYaml(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
}

/**
 * Run every fixture through a Python parser in a single interpreter.
 * mode "fallback" forces check_custom._minimal_yaml_parse; mode "pyyaml" uses
 * yaml.safe_load and reports { skip: true } when PyYAML is not importable.
 * Returns a map: fixture path -> { value } | { error, type } | { skip }.
 */
function runPython(mode, files) {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(toolsDir)})`,
    'mode = sys.argv[1]',
    'files = json.loads(sys.stdin.read())',
    'if mode == "pyyaml":',
    '    try:',
    '        import yaml',
    '    except ImportError:',
    '        print(json.dumps({"skip": True}))',
    '        sys.exit(0)',
    '    parse = yaml.safe_load',
    'else:',
    '    from check_custom import _minimal_yaml_parse as parse',
    'out = {}',
    'for f in files:',
    '    with open(f, encoding="utf-8") as fh:',
    '        text = fh.read()',
    '    try:',
    '        out[f] = {"value": parse(text)}',
    '    except Exception as e:',
    '        out[f] = {"error": str(e), "type": type(e).__name__}',
    'print(json.dumps(out))',
  ].join('\n');
  const res = spawnSync('python3', ['-c', script, mode], {
    input: JSON.stringify(files),
    encoding: 'utf-8',
  });
  assert.strictEqual(res.status, 0, `python3 (${mode}) failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const validFixtures = listYaml(validDir).map((f) => ({
  name: f.replace(/\.yaml$/, ''),
  yamlPath: path.join(validDir, f),
  expected: JSON.parse(fs.readFileSync(path.join(validDir, f.replace(/\.yaml$/, '.json')), 'utf-8')),
}));
const invalidFixtures = listYaml(invalidDir).map((f) => ({
  name: f.replace(/\.yaml$/, ''),
  yamlPath: path.join(invalidDir, f),
}));

const validPaths = validFixtures.map((f) => f.yamlPath);
const invalidPaths = invalidFixtures.map((f) => f.yamlPath);
const pyFallbackValid = runPython('fallback', validPaths);
const pyFallbackInvalid = runPython('fallback', invalidPaths);
const pyYamlValid = runPython('pyyaml', validPaths);
const hasPyYaml = !pyYamlValid.skip;

describe('YAML conformance: valid fixtures', () => {
  it('has fixtures to check', () => {
    assert.ok(validFixtures.length > 0);
  });

  for (const fx of validFixtures) {
    describe(fx.name, () => {
      const text = fs.readFileSync(fx.yamlPath, 'utf-8');

      it('JS parseYaml matches the expected object', () => {
        assert.deepStrictEqual(parseYaml(text), fx.expected);
      });

      it('Python _minimal_yaml_parse matches the expected object', () => {
        const res = pyFallbackValid[fx.yamlPath];
        assert.ok(!res.error, `python fallback raised ${res.type}: ${res.error}`);
        assert.deepStrictEqual(res.value, fx.expected);
      });

      it('PyYAML safe_load matches the expected object (oracle)', { skip: !hasPyYaml && 'PyYAML not installed' }, () => {
        const res = pyYamlValid[fx.yamlPath];
        assert.ok(!res.error, `PyYAML raised ${res.type}: ${res.error}`);
        assert.deepStrictEqual(res.value, fx.expected);
      });
    });
  }
});

describe('YAML conformance: invalid fixtures', () => {
  it('has fixtures to check', () => {
    assert.ok(invalidFixtures.length > 0);
  });

  for (const fx of invalidFixtures) {
    describe(fx.name, () => {
      const text = fs.readFileSync(fx.yamlPath, 'utf-8');

      it('JS parseYaml throws an error naming the line', () => {
        assert.throws(() => parseYaml(text), (err) => {
          assert.ok(err instanceof Error, 'must throw an Error');
          assert.match(err.message, LINE_RE);
          return true;
        });
      });

      it('Python _minimal_yaml_parse raises ValueError naming the line', () => {
        const res = pyFallbackInvalid[fx.yamlPath];
        assert.ok(res.error !== undefined, `expected an error, got ${JSON.stringify(res.value)}`);
        assert.strictEqual(res.type, 'ValueError');
        assert.match(res.error, LINE_RE);
      });
    });
  }
});
