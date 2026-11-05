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
 *   tdd.ignore        globs verify_tdd never counts as production code (default:
 *                     GENERATED_FILES, generated code; setting the key replaces them)
 *   severities        { <guard name>: warning | error }: the level of a failing
 *                     guard in the audit orchestrators (warning = reported,
 *                     not blocking; a crash is always an error)
 *   guard_exclude     { <guard name>: [globs] }: paths that one guard never
 *                     evaluates (_changes); other guards still see them
 *   sql_migrations    check_sql_migrations: paths (globs of the migration files),
 *                     schemas (where a table needs row level security),
 *                     anon_roles (roles that must get no write grant) and
 *                     severities { <rule>: error | warning | off }
 *   query_efficiency  check_query_efficiency: call_patterns (extra regexes
 *                     of query calls) and severities { <rule>: ... }
 *   mcp_contracts     check_mcp_contracts: contracts_modules (modules tool
 *                     input schemas come from), forbid_data_clients and
 *                     severities { <rule>: ... }
 *   ui_reuse          check_ui_reuse: primitives (globs of the UI primitives,
 *                     exempt from the raw-element rules)
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

const KEYS = ['rules', 'exclude_paths', 'mirrors', 'hitl', 'update', 'tdd', 'severities', 'guard_exclude', 'sql_migrations', 'query_efficiency', 'mcp_contracts', 'ui_reuse'];
const LEVELS = ['error', 'warning'];
/** Levels of one rule of a guard (its section's `severities`): 'off' disables the rule. */
const RULE_LEVELS = ['error', 'warning', 'off'];

/**
 * Generated code verify_tdd never counts as production code unless the
 * project sets tdd.ignore (sdds/laila-platform-fit, REQ-13): Supabase CLI
 * types, codegen outputs (*.generated.*, *.gen.*) and generated directories.
 */
const GENERATED_FILES = [
  '**/database.types.ts', '**/*.generated.*', '**/*.gen.*', '**/__generated__/**', '**/generated/**',
];

/**
 * Settings of the generic guards (sdds/laila-platform-fit): each section's
 * defaults, and the rules its `severities` sub-key accepts with their level.
 */
const GUARD_SECTIONS = {
  sql_migrations: {
    defaults: { paths: ['**/supabase/migrations/**/*.sql'], schemas: ['public'], anon_roles: ['anon'] },
    rules: { immutable: 'error', rls: 'error', search_path: 'error', anon_write: 'error', destructive: 'warning' },
  },
  query_efficiency: {
    defaults: { call_patterns: [] },
    rules: { n_plus_one: 'error', unbounded_select: 'warning' },
  },
  mcp_contracts: {
    defaults: { contracts_modules: [], forbid_data_clients: true },
    rules: { inline_schema: 'error', schema_source: 'error', data_client: 'error' },
  },
  ui_reuse: {
    defaults: { primitives: ['**/components/ui/**'] },
    rules: {},
  },
};

/** Keys earlier releases documented that never had an effect, with the reason. */
const DEPRECATED_KEYS = {
  active_guards: 'guards are chosen by the stack, the registry and `clckernel update --add-guards`',
  phases: 'the workflow phases are agent instructions in AGENTS.md',
  gate_mode: 'every installed guard blocks the commit when it fails',
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
    tdd: { code: [], ignore: [...GENERATED_FILES] },
    severities: {},
    guard_exclude: {},
    ...Object.fromEntries(Object.entries(GUARD_SECTIONS).map(([key, { defaults, rules }]) => [
      key,
      { ...JSON.parse(JSON.stringify(defaults)), severities: { ...rules } },
    ])),
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

/** severities: a mapping of guard name -> 'error' | 'warning'. */
function validateSeverities(value, file) {
  if (value === undefined || value === null) return {};
  if (!isMapping(value)) throw new ConfigError('severities', `expected a mapping of guard name to level, got ${typeName(value)}`, file);
  const out = {};
  for (const [name, level] of Object.entries(value)) {
    if (name.trim() === '') throw new ConfigError('severities', 'guard names must be non-empty', file);
    if (!LEVELS.includes(level)) throw new ConfigError(`severities.${name}`, `invalid level ${JSON.stringify(level)}`, file, LEVELS);
    out[name] = level;
  }
  return out;
}

/** guard_exclude: a mapping of guard name -> globs that guard never evaluates. */
function validateGuardExclude(value, file) {
  if (value === undefined || value === null) return {};
  if (!isMapping(value)) {
    throw new ConfigError('guard_exclude', `expected a mapping of guard name to a list of globs, got ${typeName(value)}`, file);
  }
  const out = {};
  for (const [name, globs] of Object.entries(value)) {
    if (name.trim() === '') throw new ConfigError('guard_exclude', 'guard names must be non-empty', file);
    out[name] = stringList(globs, `guard_exclude.${name}`, file);
  }
  return out;
}

/**
 * A generic guard's section (sql_migrations, query_efficiency, mcp_contracts):
 * lists of non-empty strings, booleans, and `severities` mapping each rule of
 * the guard to error | warning | off. Unknown sub-keys and rules throw.
 */
function validateGuardSection(raw, key, file, config) {
  const { defaults, rules } = GUARD_SECTIONS[key];
  const value = section(raw, key, [...Object.keys(defaults), 'severities'], file);
  for (const [sub, def] of Object.entries(defaults)) {
    const item = value[sub];
    if (item === undefined || item === null) continue;
    if (typeof def === 'boolean') {
      if (typeof item !== 'boolean') throw new ConfigError(`${key}.${sub}`, `expected true or false, got ${typeName(item)}`, file);
      config[key][sub] = item;
    } else {
      config[key][sub] = stringList(item, `${key}.${sub}`, file, sub === 'call_patterns' ? (p, k) => checkRegex(p, k, file) : undefined);
    }
  }
  const severities = section(value, 'severities', Object.keys(rules), file, `${key}.severities`);
  for (const [rule, level] of Object.entries(severities)) {
    if (level === undefined || level === null) continue;
    if (!RULE_LEVELS.includes(level)) {
      throw new ConfigError(`${key}.severities.${rule}`, `invalid level ${JSON.stringify(level)}`, file, RULE_LEVELS);
    }
    config[key].severities[rule] = level;
  }
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

  config.severities = validateSeverities(raw.severities, file);
  config.guard_exclude = validateGuardExclude(raw.guard_exclude, file);
  for (const key of Object.keys(GUARD_SECTIONS)) validateGuardSection(raw, key, file, config);

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
  GUARD_SECTIONS,
  GENERATED_FILES,
  ConfigError,
  defaultConfig,
  validateConfig,
  parseConfigText,
  findConfigFile,
  loadConfig,
  globMatcher,
  reportWarnings,
};
