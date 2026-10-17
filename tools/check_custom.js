#!/usr/bin/env node
/**
 * Custom Rules Guard
 * Reads .clckernel.yaml and executes user-defined regex rules against changed files.
 * Self-contained: uses only Node.js built-ins (inline YAML parser, no npm deps).
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { parseYaml, globToRegex } = require('./yaml.js');
const { changedFiles, readFile } = require('./_changes');

// Lookup order: the canonical name first, then older names kept for compatibility.
const CONFIG_NAMES = ['.clckernel.yaml', '.clckernel.yml', '.clc-forge.yaml', '.clc-forge.yml'];
const CANONICAL_CONFIG = CONFIG_NAMES[0];
const DEPRECATED_PREFIX = '.clc-forge.';

const check = async function checkCustom(targetDir) {
  const fs = require('fs');
  const path = require('path');

  const dir = targetDir || process.cwd();

  // ── 1. Load config ──────────────────────────────────────────────────
  const configPath = CONFIG_NAMES.map(c => path.join(dir, c)).find(p => fs.existsSync(p));
  if (!configPath) {
    return {
      exitCode: 0, skipped: true, name: 'check_custom',
      data: { violations: {}, message: `No ${CANONICAL_CONFIG} found` },
    };
  }

  const configName = path.basename(configPath);
  const result = runRules(dir, configPath, configName);
  if (configName.startsWith(DEPRECATED_PREFIX)) {
    result.data.warnings = [`${configName}: deprecated config name, rename to ${CANONICAL_CONFIG}`];
  }
  return result;
};
module.exports = check;

/**
 * Validate the rules in one config file and run them against changed files.
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
function runRules(dir, configPath, configName) {
  const fs = require('fs');

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

  // ── 3. Changed files of the snapshot being verified ──────────────
  // The index, or HEAD when nothing is staged; never the working copy.
  const { mode, files } = changedFiles(dir);
  if (mode === null) {
    return {
      exitCode: 0, skipped: true, name: 'check_custom',
      data: { violations: {}, message: 'No git diff available' },
    };
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
    const content = readFile(dir, file, mode);
    if (content === null) continue; // missing or binary in the snapshot — skip

    for (const rule of validated) {
      if (!rule.scopeRe.test(file)) continue;
      if (rule.excludeRe.some(re => re.test(file))) continue;

      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(content)) !== null) {
        // An empty match does not move lastIndex: step over one code point
        // (never between surrogates) so the loop ends, like Python's finditer.
        if (match[0] === '') rule.regex.lastIndex = nextCodePointIndex(content, rule.regex.lastIndex);
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
}

/**
 * Index just past the code point at `i` (two UTF-16 units for a surrogate pair).
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function nextCodePointIndex(s, i) {
  const code = s.codePointAt(i);
  return i + (code !== undefined && code > 0xffff ? 2 : 1);
}

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
    for (const warning of result.data.warnings || []) console.error(`[check_custom] warning: ${warning}`);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}

