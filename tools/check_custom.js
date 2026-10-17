#!/usr/bin/env node
/**
 * Custom Rules Guard
 * Reads .clc-forge.yml and executes user-defined regex rules against changed files.
 * Self-contained: uses only Node.js built-ins (inline YAML parser, no npm deps).
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { parseYaml, globToRegex } = require('./yaml.js');
const check = async function checkCustom(targetDir) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const dir = targetDir || process.cwd();

  // ── 1. Load config ──────────────────────────────────────────────────
  const candidates = ['.clckernel.yml', '.clckernel.yaml', '.clc-forge.yml', '.clc-forge.yaml'];
  const configPath = candidates.map(c => path.join(dir, c)).find(p => fs.existsSync(p));
  if (!configPath) {
    return {
      exitCode: 0, skipped: true, name: 'check_custom',
      data: { violations: {}, message: 'No .clckernel.yml or .clc-forge.yml found' },
    };
  }

  const configName = path.basename(configPath);
  const configError = (message) => ({
    exitCode: 1, skipped: false, name: 'check_custom',
    data: { violations: {}, message: `Config error in ${configName}: ${message}` },
  });

  let config;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    config = parseYaml(raw);
  } catch (e) {
    // Fail closed: rules we cannot read must not turn into a silent PASS.
    return {
      exitCode: 1, skipped: false, name: 'check_custom',
      data: { violations: {}, message: `Config parse error in ${configName}: ${e.message}` },
    };
  }

  const rules = config && config.rules;
  if (rules !== undefined && rules !== null && !Array.isArray(rules)) {
    return configError('"rules" must be a list');
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    return {
      exitCode: 0, skipped: false, name: 'check_custom',
      data: { violations: {}, message: 'No custom rules defined' },
    };
  }

  // ── 2. Validate rules: shape and regex; any invalid rule fails the guard ──
  const validated = [];
  const errors = [];
  rules.forEach((rule, i) => {
    const problems = validateRule(rule);
    const label = rule && typeof rule.name === 'string' ? `"${rule.name}"` : `#${i + 1}`;
    if (problems.length > 0) {
      errors.push(`rule ${label}: ${problems.join(', ')}`);
      return;
    }
    let regex;
    try {
      regex = new RegExp(rule.pattern, 'gm');
    } catch (e) {
      errors.push(`rule ${label}: invalid pattern: ${e.message}`);
      return;
    }
    validated.push({
      name: rule.name,
      pattern: rule.pattern,
      message: rule.message,
      severity: rule.severity || 'error',
      exclude: rule.exclude || [],
      regex,
      scopeRe: globToRegex(rule.scope || '**/*'),
      excludeRe: (rule.exclude || []).map(globToRegex),
    });
  });

  if (errors.length > 0) return configError(errors.join('; '));

  // ── 3. Get changed files via git diff ───────────────────────────────
  let files;
  try {
    // Staged changes first (what is being committed); HEAD~1 only when nothing is staged.
    let out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!out.trim()) {
      out = execSync('git diff --name-only --diff-filter=ACMR HEAD~1', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    files = out.split('\n').filter(f => f.trim());
  } catch {
    try {
      const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
        cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      files = out.split('\n').filter(f => f.trim());
    } catch {
      return {
        exitCode: 0, skipped: true, name: 'check_custom',
        data: { violations: {}, message: 'No git diff available' },
      };
    }
  }

  if (!files || files.length === 0) {
    return {
      exitCode: 0, skipped: false, name: 'check_custom',
      data: { violations: {}, message: 'No files to check' },
    };
  }

  // ── 4. Run rules against files ──────────────────────────────────────
  const violations = {};
  let hasError = false;

  for (const file of files) {
    const filePath = path.join(dir, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue; // permission denied or unreadable — skip
    }

    for (const rule of validated) {
      if (!rule.scopeRe.test(file)) continue;
      if (rule.excludeRe.some(re => re.test(file))) continue;

      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(content)) !== null) {
        const lineNo = content.slice(0, match.index).split('\n').length;
        if (!violations[file]) violations[file] = [];
        violations[file].push({
          lineNo,
          rule: rule.name,
          message: rule.message,
          severity: rule.severity,
        });
        if (rule.severity === 'error') hasError = true;
      }
    }
  }

  // ── 5. Build result ─────────────────────────────────────────────────
  const totalCount = Object.values(violations).flat().length;
  return {
    exitCode: hasError ? 1 : 0,
    skipped: false,
    name: 'check_custom',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} custom rule violation(s) in ${Object.keys(violations).length} file(s)`
        : 'No custom rule violations',
    },
  };
};
module.exports = check;

/**
 * Shape problems of one rule (empty list when valid).
 * @param {*} rule
 * @returns {string[]}
 */
function validateRule(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return ['must be a mapping'];
  const problems = [];
  for (const field of ['name', 'pattern', 'message']) {
    if (typeof rule[field] !== 'string' || rule[field] === '') problems.push(`"${field}" must be a non-empty string`);
  }
  if (rule.severity != null && !['error', 'warning'].includes(rule.severity)) {
    problems.push('"severity" must be "error" or "warning"');
  }
  if (rule.scope != null && typeof rule.scope !== 'string') problems.push('"scope" must be a string');
  if (rule.exclude != null && !(Array.isArray(rule.exclude) && rule.exclude.every(e => typeof e === 'string'))) {
    problems.push('"exclude" must be a list of strings');
  }
  return problems;
}

if (require.main === module) {
  check(process.argv[2]).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}

