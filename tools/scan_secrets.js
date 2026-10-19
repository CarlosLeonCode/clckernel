#!/usr/bin/env node
/**
 * Secrets & API Key Scanner
 * Detects hardcoded secrets, API keys, tokens, and private keys in staged/changed files.
 * Self-contained: uses only Node.js built-ins.
 *
 * Rules (sdds/secret-patterns) are tried in order; the first match labels the
 * line (one finding per line). They mirror RULES in scan_secrets.py exactly.
 * The two generic rules skip placeholder values (see isPlaceholder):
 *   - Quoted Key Secret: a quoted JSON/YAML key ending in a secret word, with a
 *     quoted value of 8+ non-space characters holding a letter and a digit;
 *   - Dotenv Secret: in `.env`, `.env.*` and `*.env` files (not `.env.example`,
 *     `.env.sample`, `.env.template`), `NAME=value` where a `_` segment of NAME
 *     is a secret word and the value is not numeric-only or a boolean/null word.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const path = require('path');
const { changedFiles, readFile } = require('./_changes');

const SECRET_KEY_WORDS = 'api[_-]?key|apikey|secret[_-]?key|api[_-]?secret|client[_-]?secret|secret|'
  + 'access[_-]?token|auth[_-]?token|refresh[_-]?token|token|password|passwd|private[_-]?key';
const DOTENV_SECRET_NAME = /(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PASS|CREDENTIALS?|DSN|PRIVATE)(?:_|$)/i;
const PLACEHOLDER_WORDS = ['xxx', 'your', 'changeme', 'change_me', 'change-me', 'placeholder', 'example',
  'dummy', 'replace', 'insert', 'redacted', 'fake', 'sample', 'todo', '...', '***'];
const NON_SECRET_WORDS = ['true', 'false', 'yes', 'no', 'on', 'off', 'null', 'none'];
const TEMPLATE_SEGMENTS = ['example', 'sample', 'template'];

/** True for values that are obviously not a real secret. */
function isPlaceholder(value) {
  const v = value.toLowerCase();
  if (v.startsWith('$') || v.includes('${') || v.includes('$(') || v.includes('{{')) return true;
  if (v.includes('<') && v.includes('>')) return true;
  if (/^(.)\1*$/.test(v)) return true;
  return PLACEHOLDER_WORDS.some((w) => v.includes(w));
}

/** The value of a dotenv assignment: quotes removed, or an unquoted value without its ` #` comment. */
function dotenvValue(raw) {
  const quoted = /^(["'])([^\n]*?)\1/.exec(raw);
  if (quoted) return quoted[2];
  const comment = raw.search(/\s#/);
  return (comment === -1 ? raw : raw.slice(0, comment)).trim();
}

/** `.env`, `.env.<suffix>` or `<name>.env`, unless a dot segment marks it as a template. */
function isDotenvFile(filename) {
  const base = path.basename(filename || '');
  if (!(base === '.env' || base.startsWith('.env.') || (base.endsWith('.env') && base.length > 4))) return false;
  return !base.toLowerCase().split('.').some((seg) => TEMPLATE_SEGMENTS.includes(seg));
}

const RULES = [
  { source: '-----BEGIN (?:RSA |EC )?PRIVATE KEY-----', flags: '', label: 'Private Key' },
  { source: 'AKIA[0-9A-Z]{16}', flags: '', label: 'AWS Access Key' },
  { source: '(?:api[_-]?key|apikey|secret[_-]?key|api[_-]?secret)\\s*[=:]\\s*[\'"][A-Za-z0-9_\\-]{16,}[\'"]', flags: 'i', label: 'API Key' },
  { source: '(?:password|passwd|pwd)\\s*[=:]\\s*[\'"][^\'"]{6,}[\'"]', flags: 'i', label: 'Hardcoded Password' },
  { source: '(?:secret|token|auth[_-]?token|bearer)\\s*[=:]\\s*[\'"][A-Za-z0-9_\\-\\.]{16,}[\'"]', flags: 'i', label: 'Secret/Token' },
  { source: 'ghp_[A-Za-z0-9]{36}', flags: '', label: 'GitHub Personal Access Token' },
  { source: 'sk-[A-Za-z0-9]{20,}', flags: '', label: 'OpenAI API Key' },
  { source: '(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}', flags: '', label: 'Stripe API Key' },
  { source: 'eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+', flags: '', label: 'JWT Token' },
  { source: '(?:SUPABASE|NEXT_PUBLIC|VITE)_\\w*_KEY\\s*=\\s*[\'"][^\'"]{8,}[\'"]', flags: 'i', label: 'Framework Secret Key' },
  { source: 'sk-ant-[A-Za-z0-9_-]{20,}', flags: '', label: 'Anthropic API Key' },
  { source: 'sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}', flags: '', label: 'OpenAI Project Key' },
  { source: 'AIza[0-9A-Za-z_-]{35}', flags: '', label: 'Google API Key' },
  { source: 'xox[abprs]-[0-9]+-[0-9A-Za-z-]{8,}', flags: '', label: 'Slack Token' },
  { source: 'gh[ousr]_[A-Za-z0-9]{36}', flags: '', label: 'GitHub Token' },
  { source: 'github_pat_[A-Za-z0-9_]{40,}', flags: '', label: 'GitHub Fine-Grained PAT' },
  {
    source: `(["'])[A-Za-z0-9_.-]*(?:${SECRET_KEY_WORDS})\\1\\s*:\\s*(["'])([^"'\\s]{8,})\\2`,
    flags: 'i',
    label: 'Quoted Key Secret',
    accept: (m) => /[A-Za-z]/.test(m[3]) && /[0-9]/.test(m[3]) && !isPlaceholder(m[3]),
  },
  {
    source: '^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*([^\\n]*)$',
    flags: '',
    label: 'Dotenv Secret',
    dotenvOnly: true,
    accept: (m) => {
      if (!DOTENV_SECRET_NAME.test(m[1])) return false;
      const value = dotenvValue(m[2].trim());
      if (!value || /^[0-9]+$/.test(value) || NON_SECRET_WORDS.includes(value.toLowerCase())) return false;
      return !isPlaceholder(value);
    },
  },
].map((r) => ({ ...r, regex: new RegExp(r.source, r.flags) }));

const REDACTED = '…[REDACTED]';

/**
 * The line with every match of every applicable rule cut to its first 4
 * characters plus a marker, trimmed and capped at 120 characters. Filters are
 * ignored here: over-redaction is safe. The full matched value never leaves the guard.
 * @param {string} line
 * @param {{ regex: RegExp }[]} rules
 * @returns {string}
 */
function redact(line, rules) {
  let out = line;
  for (const { regex } of rules) {
    const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    out = out.replace(global, (m) => m.slice(0, 4) + REDACTED);
  }
  return out.trim().substring(0, 120);
}

/**
 * Pure matcher: the findings for `text` as the content of `filename`.
 * @param {string} text
 * @param {string} filename - repo-relative path; decides whether dotenv rules apply
 * @returns {{ lineNo: number, col: number, label: string, snippet: string }[]}
 */
function findSecrets(text, filename) {
  const dotenv = isDotenvFile(filename);
  const rules = RULES.filter((r) => dotenv || !r.dotenvOnly);
  const findings = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of rules) {
      const match = rule.regex.exec(line);
      if (match && (!rule.accept || rule.accept(match))) {
        findings.push({ lineNo: i + 1, col: match.index, label: rule.label, snippet: redact(line, rules) });
        break; // One finding per line
      }
    }
  }
  return findings;
}

const check = async function scanSecrets(targetDir) {
  const dir = targetDir || process.cwd();

  // The snapshot being verified: the index, or HEAD when nothing is staged.
  const { mode, files } = changedFiles(dir);
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: 'scan_secrets', data: { findings: {}, message: 'No git diff available' } };
  }

  if (files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'scan_secrets', data: { findings: {}, message: 'No changed files to scan' } };
  }

  // Skip binary/generated files
  const skipExtensions = ['.png', '.jpg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.lock', '.min.js', '.min.css'];

  const findings = {};
  for (const file of files) {
    const ext = path.extname(file);
    if (skipExtensions.includes(ext)) continue;

    // Binary or missing in the snapshot reads as null.
    const content = readFile(dir, file, mode);
    if (content === null) continue;

    const fileFindings = findSecrets(content, file);
    if (fileFindings.length > 0) {
      findings[file] = fileFindings;
    }
  }

  const totalCount = Object.values(findings).flat().length;
  return {
    exitCode: totalCount > 0 ? 1 : 0,
    skipped: false,
    name: 'scan_secrets',
    data: {
      findings,
      message: totalCount > 0
        ? `${totalCount} potential secret(s) found in ${Object.keys(findings).length} file(s)`
        : 'No secrets detected',
    },
  };
};
module.exports = check;
module.exports.findSecrets = findSecrets;
module.exports.RULES = RULES;

if (require.main === module) {
  check(process.argv[2]).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
