#!/usr/bin/env node
/**
 * Secrets & API Key Scanner
 * Detects hardcoded secrets, API keys, tokens, and private keys in staged/changed files.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

const check = async function scanSecrets(targetDir) {
  const path = require('path');

  const dir = targetDir || process.cwd();

  // Collect changed files via git, fall back to package.json check
  // The snapshot being verified: the index, or HEAD when nothing is staged.
  const { mode, files } = changedFiles(dir);
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: 'scan_secrets', data: { findings: {}, message: 'No git diff available' } };
  }

  if (files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'scan_secrets', data: { findings: {}, message: 'No changed files to scan' } };
  }

  const patterns = [
    { regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: 'Private Key' },
    { regex: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key' },
    { regex: /(?:api[_-]?key|apikey|secret[_-]?key|api[_-]?secret)\s*[=:]\s*['"][A-Za-z0-9_\-]{16,}['"]/i, label: 'API Key' },
    { regex: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{6,}['"]/i, label: 'Hardcoded Password' },
    { regex: /(?:secret|token|auth[_-]?token|bearer)\s*[=:]\s*['"][A-Za-z0-9_\-\.]{16,}['"]/i, label: 'Secret/Token' },
    { regex: /ghp_[A-Za-z0-9]{36}/, label: 'GitHub Personal Access Token' },
    { regex: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI API Key' },
    { regex: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/, label: 'Stripe API Key' },
    { regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, label: 'JWT Token' },
    { regex: /(?:SUPABASE|NEXT_PUBLIC|VITE)_\w*_KEY\s*=\s*['"][^'"]{8,}['"]/i, label: 'Framework Secret Key' },
  ];

  // Skip binary/generated files
  const skipExtensions = ['.png', '.jpg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.lock', '.min.js', '.min.css'];

  const findings = {};
  for (const file of files) {
    const ext = path.extname(file);
    if (skipExtensions.includes(ext)) continue;

    // Binary or missing in the snapshot reads as null.
    const content = readFile(dir, file, mode);
    if (content === null) continue;

    const lines = content.split('\n');
    const fileFindings = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { regex, label } of patterns) {
        const match = regex.exec(line);
        if (match) {
          fileFindings.push({ lineNo: i + 1, col: match.index, label, snippet: redact(line, patterns) });
          break; // One finding per line
        }
      }
    }

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

const REDACTED = '…[REDACTED]';

/**
 * The line with every secret match (of any pattern) cut to its first 4
 * characters plus a marker, trimmed and capped at 120 characters. The full
 * matched value never leaves the guard.
 * @param {string} line
 * @param {{ regex: RegExp }[]} patterns
 * @returns {string}
 */
function redact(line, patterns) {
  let out = line;
  for (const { regex } of patterns) {
    const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    out = out.replace(global, (m) => m.slice(0, 4) + REDACTED);
  }
  return out.trim().substring(0, 120);
}

if (require.main === module) {
  check(process.argv[2]).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
