/**
 * scan_secrets (JS and Python):
 *   - findings never carry the full matched secret: the snippet keeps the
 *     first 4 characters of each match followed by `…[REDACTED]`;
 *   - the audit report, receipt and stdout never contain the secret;
 *   - Stripe secret/restricted keys (sk_live_, rk_live_, sk_test_) are detected.
 *
 * Secret-shaped values are built at runtime so this file never contains one.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const toolsDir = path.resolve(__dirname, '..', 'tools');

const API_SECRET = ['abcdefghijklmnop', 'qrstuvwxyz123456'].join('');
const API_LINE = ['const api', '_key = "', API_SECRET, '";'].join('');
const stripeKey = (prefix, body) => [prefix, '_', body].join('');
const STRIPE_BODY = 'A1b2C3d4'.repeat(3);

const SCANNERS = {
  js: (dir) => spawnSync(process.execPath, [path.join(toolsDir, 'scan_secrets.js'), dir], { cwd: dir, encoding: 'utf-8' }),
  py: (dir) => spawnSync('python3', [path.join(toolsDir, 'scan_secrets.py'), dir], { cwd: dir, encoding: 'utf-8' }),
};

/** Temp git repo with one commit and `files` staged on top of it. */
function makeRepo(files, base = {}) {
  const dir = createTmpProject({ 'README.md': '# t\n', ...base });
  const git = (...args) => spawnSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  git('add', '-A');
  return dir;
}

function scan(lang, dir) {
  const res = SCANNERS[lang](dir);
  const parsed = JSON.parse(res.stdout);
  return { stdout: res.stdout + res.stderr, status: res.status, findings: parsed.data.findings };
}

for (const lang of Object.keys(SCANNERS)) {
  describe(`scan_secrets.${lang} redacts findings`, () => {
    it('reports the finding without printing the secret', () => {
      const dir = makeRepo({ 'config.js': `// header\n${API_LINE}\n` });
      try {
        const r = scan(lang, dir);
        assert.strictEqual(r.status, 1);
        assert.ok(!r.stdout.includes(API_SECRET), `stdout leaks the secret:\n${r.stdout}`);
        const [finding] = r.findings['config.js'];
        assert.strictEqual(finding.lineNo, 2);
        assert.strictEqual(finding.label, 'API Key');
        assert.strictEqual(finding.col, API_LINE.indexOf('api'));
        assert.strictEqual(finding.line, undefined, 'no raw line field');
        assert.strictEqual(finding.snippet, 'const api_…[REDACTED];');
      } finally {
        teardown(dir);
      }
    });

    it('redacts every secret on the reported line', () => {
      const stripe = stripeKey('sk_live', STRIPE_BODY);
      const dir = makeRepo({ 'config.js': `${API_LINE} const k = '${stripe}';\n` });
      try {
        const r = scan(lang, dir);
        assert.ok(!r.stdout.includes(API_SECRET), 'api secret leaked');
        assert.ok(!r.stdout.includes(stripe), 'stripe secret leaked');
        assert.strictEqual(r.findings['config.js'].length, 1);
      } finally {
        teardown(dir);
      }
    });
  });

  describe(`scan_secrets.${lang} detects Stripe keys`, () => {
    for (const prefix of ['sk_live', 'rk_live', 'sk_test']) {
      it(`detects ${prefix}_ keys`, () => {
        const key = stripeKey(prefix, STRIPE_BODY);
        const dir = makeRepo({ 'pay.js': `const k = '${key}';\n` });
        try {
          const r = scan(lang, dir);
          assert.strictEqual(r.status, 1, r.stdout);
          assert.strictEqual(r.findings['pay.js'][0].label, 'Stripe API Key');
          assert.ok(!r.stdout.includes(key), 'stripe key leaked');
        } finally {
          teardown(dir);
        }
      });
    }

    it('ignores a too-short Stripe-like token', () => {
      const dir = makeRepo({ 'pay.js': `const k = '${stripeKey('sk_live', 'x')}';\n` });
      try {
        const r = scan(lang, dir);
        assert.strictEqual(r.status, 0, r.stdout);
      } finally {
        teardown(dir);
      }
    });

    it('labels OpenAI sk- keys as OpenAI API Key', () => {
      const dir = makeRepo({ 'ai.js': `const k = '${['sk', '-', STRIPE_BODY].join('')}';\n` });
      try {
        const r = scan(lang, dir);
        assert.strictEqual(r.findings['ai.js'][0].label, 'OpenAI API Key');
      } finally {
        teardown(dir);
      }
    });
  });
}

describe('scan_secrets JS and Python findings are identical', () => {
  it('same lineNo, col, label and snippet', () => {
    const dir = makeRepo({ 'config.js': `x\n  ${API_LINE}\nconst k = '${stripeKey('rk_test', STRIPE_BODY)}';\n` });
    try {
      assert.deepStrictEqual(scan('js', dir).findings, scan('py', dir).findings);
    } finally {
      teardown(dir);
    }
  });
});

describe('audit reports never contain the secret', () => {
  function auditArtifacts(dir) {
    const sddsDir = path.join(dir, 'sdds');
    const sub = fs.readdirSync(sddsDir).filter(f => fs.statSync(path.join(sddsDir, f)).isDirectory())[0];
    return ['05-audit-report.md', 'audit-receipt.json'].map(f => fs.readFileSync(path.join(sddsDir, sub, f), 'utf-8'));
  }

  const AUDITS = {
    js: { files: ['audit.js', 'scan_secrets.js', '_changes.js'], cmd: (dir) => [process.execPath, [path.join(dir, 'tools', 'audit.js'), dir, '--change', 'audit-run']] },
    py: { files: ['audit.py', 'scan_secrets.py', '_changes.py'], cmd: (dir) => ['python3', [path.join(dir, 'tools', 'audit.py'), dir, '--change', 'audit-run']] },
  };

  for (const [lang, { files, cmd }] of Object.entries(AUDITS)) {
    it(`audit.${lang}: report, receipt and stdout omit the secret`, () => {
      const stripe = stripeKey('sk_live', STRIPE_BODY);
      const tools = Object.fromEntries(files.map(f => [`tools/${f}`, fs.readFileSync(path.join(toolsDir, f), 'utf-8')]));
      const dir = makeRepo({ 'config.js': `${API_LINE}\nconst k = '${stripe}';\n` }, tools);
      try {
        const [bin, args] = cmd(dir);
        const res = spawnSync(bin, args, { cwd: dir, encoding: 'utf-8' });
        assert.notStrictEqual(res.status, 0, `audit must fail on secrets: ${res.stdout}${res.stderr}`);
        const [report, receipt] = auditArtifacts(dir);
        assert.match(report, /Stripe API Key/);
        for (const text of [report, receipt, res.stdout + res.stderr]) {
          assert.ok(!text.includes(API_SECRET), 'api secret leaked');
          assert.ok(!text.includes(stripe), 'stripe secret leaked');
        }
      } finally {
        teardown(dir);
      }
    });
  }
});
