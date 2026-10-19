/**
 * Project configuration shared by install/update and the guards (twin of
 * _config.py): finds .clckernel.yaml in the project root, parses it with
 * tools/yaml.js, validates it and fills in the defaults. The defaults
 * reproduce the behaviour of a project without the key.
 *
 * Schema (every key optional):
 *   rules             custom regex rules, run by check_custom
 *   exclude_paths     globs no diff-based guard evaluates (_changes)
 *   mirrors.list      AI IDE mirrors install creates and check_symlinks verifies
 *                     (null = each one's built-in list)
 *   mirrors.required  true: a listed mirror that is missing fails check_symlinks
 *   hitl.markers      regexes (case-insensitive) that count as a HITL marker
 *                     (null = the built-in markers)
 *   hitl.paths        globs of the files check_hitl evaluates (null = built-in)
 *   hitl.optOut       { key, value }: a file whose frontmatter has key: value is exempt
 *   update.exclude    globs install/update never write
 *   tdd.code          extra globs verify_tdd counts as production code
 *   tdd.ignore        globs verify_tdd never counts as production code
 *
 * Removed keys (no effect) produce a deprecation warning; unknown top-level
 * keys a warning; an invalid value throws ConfigError naming file and key.
 * Self-contained: Node.js built-ins plus the sibling yaml.js.
 */
const fs = require('fs');
const path = require('path');
const { parseYaml, globToRegex } = require('./yaml.js');

// Lookup order: the canonical name first, then older names kept for compatibility.
const CONFIG_NAMES = ['.clckernel.yaml', '.clckernel.yml', '.clc-forge.yaml', '.clc-forge.yml'];

const KEYS = ['rules', 'exclude_paths', 'mirrors', 'hitl', 'update', 'tdd'];

/** Keys earlier releases documented that never had an effect, with the reason. */
const DEPRECATED_KEYS = {
  active_guards: 'guards are chosen by the stack, the registry and `clckernel update --add-guards`',
  phases: 'the workflow phases are agent instructions in AGENTS.md',
  gate_mode: 'every installed guard blocks the commit when it fails',
  severities: 'per-guard warning levels are not supported yet',
  layers: 'layer rules live in the architecture guards',
  scope: 'use exclude_paths to keep paths out of the guards',
};

class ConfigError extends Error {
  /**
   * @param {string} key - Dotted key path, e.g. "mirrors.list[0]" ("<root>" for the document)
   * @param {string} message - What is wrong
   * @param {string} [file] - Config file name
   * @param {string[]} [allowed] - Accepted values, when a closed set
   */
  constructor(key, message, file = CONFIG_NAMES[0], allowed = []) {
    super(`Invalid ${file}: key "${key}" — ${message}` + (allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''));
    this.name = 'ConfigError';
    this.key = key;
    this.path = key;
    this.file = file;
    this.allowed = allowed;
    this.fix = allowed.length
      ? `Set "${key}" in ${file} to one of: ${allowed.join(', ')}.`
      : `Correct "${key}" in ${file}: ${message}.`;
  }
}

function defaultConfig() {
  return {
    rules: [],
    exclude_paths: [],
    mirrors: { list: null, required: false },
    hitl: { markers: null, paths: null, optOut: null },
    update: { exclude: [] },
    tdd: { code: [], ignore: [] },
  };
}

const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v);

function stringList(value, key, file, check) {
  if (!Array.isArray(value)) throw new ConfigError(key, `expected a list of strings, got ${typeName(value)}`, file);
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ConfigError(`${key}[${i}]`, 'each item must be a non-empty string', file);
    }
    if (check) check(item, `${key}[${i}]`);
  });
  return [...value];
}

/** Reads a nested mapping key, rejecting sub-keys the schema does not know. */
function section(raw, key, known, file, label = key) {
  const value = raw[key];
  if (value === undefined || value === null) return {};
  if (!isMapping(value)) throw new ConfigError(label, `expected a mapping, got ${typeName(value)}`, file);
  for (const sub of Object.keys(value)) {
    if (!known.includes(sub)) throw new ConfigError(`${label}.${sub}`, 'unknown key', file, known.map((k) => `${label}.${k}`));
  }
  return value;
}

function validateRules(rules, file) {
  if (rules === undefined || rules === null) return [];
  if (!Array.isArray(rules)) throw new ConfigError('rules', `expected a list, got ${typeName(rules)}`, file);
  const seen = new Set();
  rules.forEach((rule, i) => {
    if (!isMapping(rule)) throw new ConfigError(`rules[${i}]`, 'each rule must be a mapping', file);
    if (typeof rule.name !== 'string' || rule.name.trim() === '') {
      throw new ConfigError(`rules[${i}].name`, 'each rule requires a non-empty name', file);
    }
    if (seen.has(rule.name)) throw new ConfigError(`rules[${i}].name`, `duplicate rule name "${rule.name}"`, file);
    seen.add(rule.name);
    if (rule.severity !== undefined && rule.severity !== null && !['error', 'warning'].includes(rule.severity)) {
      throw new ConfigError(`rules[${i}].severity`, `invalid severity "${rule.severity}"`, file, ['error', 'warning']);
    }
  });
  return rules;
}

function checkMirrorPath(item, key, file) {
  const segments = item.split(/[\\/]/);
  if (path.isAbsolute(item) || item.startsWith('/') || segments.includes('..')) {
    throw new ConfigError(key, `"${item}" must be a path inside the project`, file);
  }
  if (path.posix.normalize(item) === 'AGENTS.md') throw new ConfigError(key, 'AGENTS.md is the source, not a mirror', file);
}

function checkRegex(item, key, file) {
  try {
    new RegExp(item, 'i');
  } catch (err) {
    throw new ConfigError(key, `invalid regular expression: ${err.message}`, file);
  }
}

/**
 * Validates a parsed config and fills in the defaults.
 * @param {object} raw - Parsed YAML (top-level mapping)
 * @param {string} [file] - Config file name, for messages
 * @returns {{ config: object, warnings: string[] }}
 * @throws {ConfigError}
 */
function validateConfig(raw, file = CONFIG_NAMES[0]) {
  if (!isMapping(raw)) throw new ConfigError('<root>', 'expected a mapping at the top level', file);
  const config = defaultConfig();
  const warnings = [];
  for (const key of Object.keys(raw)) {
    if (Object.prototype.hasOwnProperty.call(DEPRECATED_KEYS, key)) {
      warnings.push(`${file}: key "${key}" is deprecated and has no effect (${DEPRECATED_KEYS[key]}); remove it`);
    } else if (!KEYS.includes(key)) {
      warnings.push(`${file}: unknown key "${key}" is ignored (known keys: ${KEYS.join(', ')})`);
    }
  }

  config.rules = validateRules(raw.rules, file);
  if (raw.exclude_paths !== undefined && raw.exclude_paths !== null) {
    config.exclude_paths = stringList(raw.exclude_paths, 'exclude_paths', file);
  }

  const mirrors = section(raw, 'mirrors', ['list', 'required'], file);
  if (mirrors.list !== undefined && mirrors.list !== null) {
    config.mirrors.list = stringList(mirrors.list, 'mirrors.list', file, (item, key) => checkMirrorPath(item, key, file));
  }
  if (mirrors.required !== undefined && mirrors.required !== null) {
    if (typeof mirrors.required !== 'boolean') throw new ConfigError('mirrors.required', `expected true or false, got ${typeName(mirrors.required)}`, file);
    config.mirrors.required = mirrors.required;
  }

  const hitl = section(raw, 'hitl', ['markers', 'paths', 'optOut'], file);
  if (hitl.markers !== undefined && hitl.markers !== null) {
    config.hitl.markers = stringList(hitl.markers, 'hitl.markers', file, (item, key) => checkRegex(item, key, file));
  }
  if (hitl.paths !== undefined && hitl.paths !== null) config.hitl.paths = stringList(hitl.paths, 'hitl.paths', file);
  if (hitl.optOut !== undefined && hitl.optOut !== null) {
    const optOut = section(hitl, 'optOut', ['key', 'value'], file, 'hitl.optOut');
    if (typeof optOut.key !== 'string' || optOut.key.trim() === '') {
      throw new ConfigError('hitl.optOut.key', 'expected a non-empty frontmatter key', file);
    }
    if (!['string', 'number', 'boolean'].includes(typeof optOut.value)) {
      throw new ConfigError('hitl.optOut.value', 'expected the frontmatter value that exempts a file', file);
    }
    config.hitl.optOut = { key: optOut.key, value: String(optOut.value) };
  }

  const update = section(raw, 'update', ['exclude'], file);
  if (update.exclude !== undefined && update.exclude !== null) config.update.exclude = stringList(update.exclude, 'update.exclude', file);

  const tdd = section(raw, 'tdd', ['code', 'ignore'], file);
  if (tdd.code !== undefined && tdd.code !== null) config.tdd.code = stringList(tdd.code, 'tdd.code', file);
  if (tdd.ignore !== undefined && tdd.ignore !== null) config.tdd.ignore = stringList(tdd.ignore, 'tdd.ignore', file);

  return { config, warnings };
}

/**
 * Parses config text.
 * @returns {object} The top-level mapping ({} for an empty document)
 * @throws {ConfigError}
 */
function parseConfigText(text, file = CONFIG_NAMES[0]) {
  if (text === undefined || text === null || String(text).trim() === '') return {};
  let raw;
  try {
    raw = parseYaml(String(text));
  } catch (err) {
    throw new ConfigError('<root>', `YAML parse error: ${err.message}`, file);
  }
  if (raw === null || raw === undefined) return {};
  if (!isMapping(raw)) throw new ConfigError('<root>', 'expected a mapping at the top level', file);
  return raw;
}

/** Absolute path of the project's config file, or null. */
function findConfigFile(dir) {
  const root = dir || process.cwd();
  const found = CONFIG_NAMES.map((name) => path.join(root, name)).find((p) => fs.existsSync(p));
  return found || null;
}

const cache = new Map();

/**
 * Loads the config of the project at dir (read from the working tree).
 * @param {string} [dir] - Project root (default: cwd)
 * @param {{ cache?: boolean }} [options] - Reuse the result for dir within this process
 * @returns {{ file: string|null, path: string|null, config: object, warnings: string[] }}
 * @throws {ConfigError}
 */
function loadConfig(dir, { cache: useCache = true } = {}) {
  const root = path.resolve(dir || process.cwd());
  if (useCache && cache.has(root)) return cache.get(root);
  const configPath = findConfigFile(root);
  let loaded;
  if (!configPath) {
    loaded = { file: null, path: null, config: defaultConfig(), warnings: [] };
  } else {
    const file = path.basename(configPath);
    const { config, warnings } = validateConfig(parseConfigText(fs.readFileSync(configPath, 'utf-8'), file), file);
    loaded = { file, path: configPath, config, warnings };
  }
  if (useCache) cache.set(root, loaded);
  return loaded;
}

/**
 * A predicate telling whether a root-relative POSIX path matches one of the globs.
 * @param {string[]} globs
 * @returns {(rel: string) => boolean}
 */
function globMatcher(globs) {
  const regexes = (globs || []).map(globToRegex);
  return (rel) => regexes.some((re) => re.test(rel));
}

const reported = new Set();

/** Prints each warning once per process, on stderr (guards keep stdout for JSON). */
function reportWarnings(loaded) {
  for (const warning of loaded.warnings) {
    if (reported.has(warning)) continue;
    reported.add(warning);
    process.stderr.write(`clckernel: warning: ${warning}\n`);
  }
}

module.exports = {
  CONFIG_NAMES,
  DEPRECATED_KEYS,
  ConfigError,
  defaultConfig,
  validateConfig,
  parseConfigText,
  findConfigFile,
  loadConfig,
  globMatcher,
  reportWarnings,
};
