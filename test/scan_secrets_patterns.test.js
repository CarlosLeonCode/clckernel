/**
 * scan_secrets pattern coverage (sdds/secret-patterns), JS and Python:
 *   - provider tokens: Anthropic, OpenAI project/service, Google, Slack, GitHub (all prefixes);
 *   - quoted JSON/YAML keys and committed dotenv files, with placeholder values left alone;
 *   - findSecrets (JS) and find_secrets (Python) return identical findings on the whole table;
 *   - redaction holds and the guard does not flag its own sources.
 *
 * Every secret-shaped value is built at runtime from fragments so this file never contains one.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const toolsDir = path.resolve(__dirname, '..', 'tools');
const j = (...parts) => parts.join('');
const body = (n) => 'A1b2C3d4e5F6'.repeat(Math.ceil(n / 12)).slice(0, n);
const Q = '"';
const S = "'";

/** [id, filename, text, expected label or null, the secret value that must never be printed]. */
const TABLE = [
  ['anthropic', 'a.js', j('const k = ', S, j('sk', '-ant-', 'api03-', body(40)), S, ';'), 'Anthropic API Key'],
  ['openai-proj', 'a.js', j('k = ', S, j('sk', '-proj-', body(20), '_', body(20), '-', body(8)), S), 'OpenAI Project Key'],
  ['openai-svcacct', 'a.py', j('k = ', S, j('sk', '-svcacct-', body(30), '-', body(10)), S), 'OpenAI Project Key'],
  ['google', 'a.js', j('const g = ', S, j('AI', 'za', body(33), '-_'), S, ';'), 'Google API Key'],
  ['slack-bot', 'a.js', j('const s = ', S, j('xo', 'xb-', '1234567890', '-', '9876543210', '-', body(24)), S, ';'), 'Slack Token'],
  ['slack-user', 'a.py', j('s = ', S, j('xo', 'xp-', '1234567890', '-', '1234567', '-', body(24)), S), 'Slack Token'],
  ['github-oauth', 'a.js', j('t = ', S, j('gh', 'o_', body(36)), S), 'GitHub Token'],
  ['github-user', 'a.js', j('t = ', S, j('gh', 'u_', body(36)), S), 'GitHub Token'],
  ['github-server', 'a.js', j('t = ', S, j('gh', 's_', body(36)), S), 'GitHub Token'],
  ['github-refresh', 'a.js', j('t = ', S, j('gh', 'r_', body(36)), S), 'GitHub Token'],
  ['github-fine', 'a.js', j('t = ', S, j('github', '_pat_', body(22), '_', body(59)), S), 'GitHub Fine-Grained PAT'],
  ['json-api-key', 'c.json', j('  ', Q, 'api_key', Q, ': ', Q, body(24), Q, ','), 'Quoted Key Secret'],
  ['yaml-token', 'c.yaml', j(S, 'token', S, ': ', S, body(20), S), 'Quoted Key Secret'],
  ['json-client-secret', 'c.json', j(Q, 'clientSecret', Q, ':', Q, body(16), Q), 'Quoted Key Secret'],
  ['json-i18n-password', 'en.json', j(Q, 'password', Q, ': ', Q, 'Password', Q), null],
  ['json-placeholder', 'c.json', j(Q, 'api_key', Q, ': ', Q, 'your-', 'api-key-1', Q), null],
  ['json-env-ref', 'c.json', j(Q, 'token', Q, ': ', Q, '${', 'TOKEN_1}', Q), null],
  ['json-angle', 'c.json', j(Q, 'token', Q, ': ', Q, '<', 'token-1>', Q), null],
  ['json-same-char', 'c.json', j(Q, 'secret', Q, ': ', Q, 'x'.repeat(12), Q), null],
  ['upper-assign', 'a.py', j('API', '_KEY = ', Q, body(20), Q), 'API Key'],
  ['dotenv', '.env', j('API', '_KEY=', body(24)), 'Dotenv Secret'],
  ['dotenv-local', 'app/.env.local', j('export DB', '_PASSWORD=', 'hunter', '2pass', '  # prod'), 'Dotenv Secret'],
  ['dotenv-production', '.env.production', j('STRIPE', '_SECRET=', Q, body(12), Q), 'Dotenv Secret'],
  ['dotenv-named', 'prod.env', j('AUTH', '_TOKEN=', body(16)), 'Dotenv Secret'],
  ['dotenv-crlf', '.env', j('API', '_KEY=', body(24), '\r'), 'Dotenv Secret'],
  ['dotenv-example', '.env.example', j('API', '_KEY=', body(24)), null],
  ['dotenv-sample', '.env.sample', j('API', '_KEY=', body(24)), null],
  ['dotenv-template', '.env.template', j('API', '_KEY=', body(24)), null],
  ['dotenv-empty', '.env', j('API', '_KEY='), null],
  ['dotenv-placeholder', '.env', j('API', '_KEY=', 'change', 'me'), null],
  ['dotenv-placeholder-angle', '.env', j('API', '_KEY=', '<', 'your key>'), null],
  ['dotenv-var-ref', '.env', j('API', '_KEY=', '${', 'OTHER}'), null],
  ['dotenv-numeric', '.env', j('PASSWORD', '_MIN_LENGTH=', '12'), null],
  ['dotenv-bool', '.env', j('TOKEN', '_ROTATION=', 'true'), null],
  ['dotenv-non-secret', '.env', j('PORT=', '3000'), null],
  ['dotenv-commented', '.env', j('# API', '_KEY=', body(24)), null],
  ['dotenv-rule-only-in-dotenv', 'notes.txt', j('API', '_KEY=', body(24)), null],
].map(([id, filename, text, label]) => ({ id, filename, text, label }));

/** The value part of a case: everything after the first `=` or `: ` quote, used for leak checks. */
function secretOf(text) {
  const m = /(?:[=:]\s*["']?)([^"'\s#]{8,})/.exec(text) || /([A-Za-z0-9_-]{20,})/.exec(text);
  return m ? m[1] : null;
}

function jsFind(filename, text) {
  delete require.cache[require.resolve('../tools/scan_secrets.js')];
  const mod = require('../tools/scan_secrets.js');
  assert.strictEqual(typeof mod.findSecrets, 'function', 'scan_secrets.js must export findSecrets');
  return mod.findSecrets(text, filename);
}

const PY_DRIVER = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import scan_secrets',
  'cases = json.load(sys.stdin)',
  'print(json.dumps([scan_secrets.find_secrets(c["text"], c["filename"]) for c in cases]))',
].join('\n');

function pyFindAll(cases) {
  const res = spawnSync('python3', ['-c', PY_DRIVER, toolsDir], {
    input: JSON.stringify(cases.map(({ text, filename }) => ({ text, filename }))), encoding: 'utf-8',
  });
  assert.strictEqual(res.status, 0, `python driver failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const FINDERS = {
  js: (cases) => cases.map((c) => jsFind(c.filename, c.text)),
  py: pyFindAll,
};

for (const [lang, findAll] of Object.entries(FINDERS)) {
  describe(`scan_secrets.${lang} pattern table`, () => {
    const results = {};
    const get = (c) => {
      if (!(c.id in results)) {
        const all = findAll(TABLE);
        TABLE.forEach((t, i) => { results[t.id] = all[i]; });
      }
      return results[c.id];
    };

    for (const c of TABLE) {
      it(`${c.id}: ${c.label ? `flagged as ${c.label}` : 'not flagged'}`, () => {
        const findings = get(c);
        if (!c.label) {
          assert.deepStrictEqual(findings, [], `unexpected finding for ${c.id}: ${JSON.stringify(findings)}`);
          return;
        }
        assert.strictEqual(findings.length, 1, JSON.stringify(findings));
        assert.strictEqual(findings[0].label, c.label);
        assert.strictEqual(findings[0].lineNo, 1);
        assert.match(findings[0].snippet, /…\[REDACTED\]/);
        const secret = secretOf(c.text);
        assert.ok(secret, `test bug: no secret found in ${c.id}`);
        assert.ok(!JSON.stringify(findings).includes(secret), `${c.id} leaks the value: ${findings[0].snippet}`);
      });
    }
  });
}

describe('scan_secrets JS and Python agree on the whole table', () => {
  it('findSecrets == find_secrets for every case', () => {
    const multi = { id: 'multi', filename: '.env.local', text: TABLE.map((c) => c.text).join('\n') };
    const cases = [...TABLE, multi];
    assert.deepStrictEqual(FINDERS.js(cases), FINDERS.py(cases));
  });
});

describe('scan_secrets does not flag its own sources', () => {
  for (const file of ['scan_secrets.js', 'scan_secrets.py']) {
    it(`${file} yields no finding`, () => {
      const text = fs.readFileSync(path.join(toolsDir, file), 'utf-8');
      assert.deepStrictEqual(jsFind(`tools/${file}`, text), []);
      assert.deepStrictEqual(pyFindAll([{ text, filename: `tools/${file}` }])[0], []);
    });
  }
});

describe('scan_secrets end to end on a staged dotenv file', () => {
  const SCANNERS = {
    js: (dir) => spawnSync(process.execPath, [path.join(toolsDir, 'scan_secrets.js'), dir], { cwd: dir, encoding: 'utf-8' }),
    py: (dir) => spawnSync('python3', [path.join(toolsDir, 'scan_secrets.py'), dir], { cwd: dir, encoding: 'utf-8' }),
  };
  const value = body(24);

  for (const [lang, run] of Object.entries(SCANNERS)) {
    it(`${lang}: .env blocks, .env.example passes, value never printed`, () => {
      const dir = createTmpProject({ 'README.md': '# t\n' });
      const git = (...args) => spawnSync('git', args, { cwd: dir });
      try {
        git('init', '-q');
        git('config', 'user.email', 'test@test.com');
        git('config', 'user.name', 'Test');
        git('add', '.');
        git('commit', '-q', '-m', 'initial');
        fs.writeFileSync(path.join(dir, '.env'), j('API', '_KEY=', value, '\n'));
        fs.writeFileSync(path.join(dir, '.env.example'), j('API', '_KEY=', value, '\n'));
        git('add', '-A');
        const res = run(dir);
        assert.strictEqual(res.status, 1, res.stdout + res.stderr);
        const { findings } = JSON.parse(res.stdout).data;
        assert.deepStrictEqual(Object.keys(findings), ['.env']);
        assert.strictEqual(findings['.env'][0].label, 'Dotenv Secret');
        assert.ok(!(res.stdout + res.stderr).includes(value), 'value leaked');
      } finally {
        teardown(dir);
      }
    });
  }
});
