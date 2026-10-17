/**
 * CLC Kernel - extended .clckernel.yaml loader / validator / resolver.
 * Backbone = src/catalog.js. Invalid config -> actionable ConfigError;
 * never a silent fallback.
 */

const { parseYaml } = require('../tools/yaml.js');
const {
  SAFEGUARD_CATALOG,
  VALID_SEVERITIES,
  VALID_GATE_MODES,
  applyTo,
  severityFor,
} = require('./catalog.js');

/**
 * Canonical 10-phase workflow order (design §3.1). NOTE: catalog VALID_PHASES
 * is the per-entry `phase` field, NOT this workflow — the `phases` config key
 * validates against this list.
 */
const HARNESS_PHASES = [
  'research', 'plan', 'test-scenarios', 'hit', 'tdd-red',
  'green', 'audit', 'rdd-review', 'handover', 'close',
];

const ENV_SEVERITIES = 'CLCKERNEL_SEVERITIES';
// Older spellings, still read so existing setups keep working.
const LEGACY_ENV_NAMES = ['CLC_KERNEL_SEVERITIES', 'CLC_FORGE_SEVERITIES'];
const DEFAULT_SCOPE = '.';

class ConfigError extends Error {
  constructor(path, message, allowed) {
    const list = Array.isArray(allowed) ? allowed : allowed != null ? [allowed] : [];
    super(
      `Invalid .clckernel.yaml: key "${path}" — ${message}` +
        (list.length ? ` (allowed: ${list.join(', ')})` : '')
    );
    this.name = 'ConfigError';
    this.path = path;
    this.allowed = list;
    this.fix =
      list.length
        ? `Set "${path}" to one of: ${list.join(', ')}. ${message}`
        : `Correct the value of "${path}". ${message}`;
  }
}

function arrOrThrow(raw, path, what) {
  if (!Array.isArray(raw)) throw new ConfigError(path, `expected an array, got ${raw === null ? 'null' : typeof raw}`, what);
  if (!raw.length) throw new ConfigError(path, 'must not be empty', what);
}

function strItems(arr, base) {
  arr.forEach((v, i) => {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new ConfigError(`${base}[${i}]`, 'each item must be a non-empty string');
    }
  });
  return arr;
}

function listGuards() {
  return SAFEGUARD_CATALOG.map((e) => e.name);
}

function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('<root>', 'expected a YAML mapping (object)');
  }

  const { active_guards, gate_mode, severities, phases, scope, exclude_paths, layers, rules } = raw;

  if (active_guards !== undefined) {
    arrOrThrow(active_guards, 'active_guards', 'a list of catalog guard names');
    active_guards.forEach((name, i) => {
      if (typeof name !== 'string' || name.trim() === '') throw new ConfigError(`active_guards[${i}]`, 'each active guard must be a non-empty string');
      if (!applyTo(name)) throw new ConfigError(`active_guards[${i}]`, `unknown guard "${name}"`, listGuards());
    });
  }

  if (gate_mode !== undefined && (typeof gate_mode !== 'string' || !VALID_GATE_MODES.includes(gate_mode))) {
    throw new ConfigError('gate_mode', `invalid value "${gate_mode}"`, VALID_GATE_MODES);
  }

  if (severities !== undefined) {
    if (!severities || typeof severities !== 'object' || Array.isArray(severities)) {
      throw new ConfigError('severities', 'expected an object mapping guard -> severity');
    }
    for (const [name, severity] of Object.entries(severities)) {
      if (!applyTo(name)) throw new ConfigError(`severities.${name}`, `unknown guard "${name}"`, listGuards());
      if (!VALID_SEVERITIES.includes(severity)) throw new ConfigError(`severities.${name}`, `invalid severity "${severity}"`, VALID_SEVERITIES);
    }
  }

  if (phases !== undefined) {
    arrOrThrow(phases, 'phases', 'the canonical 10-phase workflow names');
    let last = -1;
    phases.forEach((phase, i) => {
      if (typeof phase !== 'string' || phase.trim() === '') throw new ConfigError(`phases[${i}]`, 'each phase must be a non-empty string');
      const idx = HARNESS_PHASES.indexOf(phase);
      if (idx === -1) throw new ConfigError(`phases[${i}]`, `unknown phase "${phase}"`, HARNESS_PHASES);
      if (idx <= last) throw new ConfigError(`phases[${i}]`, `phase "${phase}" is out of order — canonical order is ${HARNESS_PHASES.join(' → ')}`);
      last = idx;
    });
  }

  if (scope !== undefined) {
    const items = typeof scope === 'string' ? [scope] : scope;
    arrOrThrow(items, 'scope', 'a glob string or array of glob strings');
    strItems(items, 'scope');
  }

  if (exclude_paths !== undefined) { arrOrThrow(exclude_paths, 'exclude_paths', 'an array of glob strings'); strItems(exclude_paths, 'exclude_paths'); }
  if (layers !== undefined) { arrOrThrow(layers, 'layers', 'an array of layer name strings'); strItems(layers, 'layers'); }

  if (rules !== undefined) {
    arrOrThrow(rules, 'rules', 'an array of legacy rule objects');
    const seen = new Set();
    rules.forEach((rule, i) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new ConfigError(`rules[${i}]`, 'each rule must be an object');
      if (typeof rule.name !== 'string' || rule.name.trim() === '') throw new ConfigError(`rules[${i}]`, 'each rule requires a non-empty "name"');
      if (seen.has(rule.name)) throw new ConfigError(`rules[${i}].name`, `duplicate rule name "${rule.name}"`);
      seen.add(rule.name);
      if (rule.severity !== undefined && !['error', 'warning'].includes(rule.severity)) {
        throw new ConfigError(`rules[${i}].severity`, `invalid severity "${rule.severity}"`, ['error', 'warning']);
      }
    });
  }

  return raw;
}

const loadConfig = (yamlString) => {
  if (yamlString === undefined || yamlString === null || yamlString.trim() === '') return {};
  let raw;
  try { raw = parseYaml(yamlString); } catch (err) { throw new ConfigError('<root>', `YAML parse error: ${err.message}`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('<root>', 'expected a YAML mapping (object) at the top level');
  return raw;
};

/** Env override map (tolerant: malformed JSON/non-object ignored). */
function envSeverities() {
  const raw = [ENV_SEVERITIES, ...LEGACY_ENV_NAMES]
    .map((name) => process.env[name])
    .find(Boolean);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* ignore malformed env override */ }
  return {};
}

/** Catalog names among detected.techTools (design §1.3 JOIN rule). */
function detectedToolNames(detected) {
  const names = new Set();
  if (!detected || !Array.isArray(detected.techTools)) return names;
  for (const tool of detected.techTools) {
    const name = tool && typeof tool === 'object' ? tool.name : tool;
    const entry = applyTo(name);
    if (entry) names.add(entry.name);
  }
  return names;
}

/** True when a catalog row applies to the detected stack. */
function rowApplies(row, detected, detectedTools) {
  if (row.applies_when === 'always') return true;
  if (!detected || typeof detected !== 'object') return false;
  if (detectedTools && detectedTools.has(row.name)) return true;
  const deps = new Set(
    [detected.projectType, detected.framework, detected.orm]
      .filter((x) => typeof x === 'string')
      .map((x) => x.toLowerCase())
  );
  for (const alt of row.applies_when.split('|')) {
    for (const tok of alt.split(',')) {
      const t = tok.trim();
      if (t && deps.has(t)) return true;
    }
  }
  return false;
}

/**
 * Generation-time severity precedence: env CLCKERNEL_SEVERITIES > config
 * severities > catalog default > 'error'. (Guard-result still wins at runtime
 * audit — slice C.)
 */
function resolveSeverity(name, configSeverities, envMap) {
  if (envMap[name] && VALID_SEVERITIES.includes(envMap[name])) return envMap[name];
  if (configSeverities[name] && VALID_SEVERITIES.includes(configSeverities[name])) return configSeverities[name];
  const cat = severityFor(name);
  if (cat && VALID_SEVERITIES.includes(cat)) return cat;
  return 'error';
}

/**
 * Effective resolved config (catalog defaults merged with overrides).
 * @param {object} raw - validated raw config.
 * @param {object} [detected] - autoDetectStack output (optional; {} when unknown).
 */
function resolveConfig(raw, detected) {
  const validated = validateConfig(raw);
  const gateMode = validated.gate_mode === undefined ? 'hard' : validated.gate_mode;
  const phases = validated.phases === undefined ? HARNESS_PHASES.slice() : validated.phases;
  const detectedTools = detectedToolNames(detected);
  const base = SAFEGUARD_CATALOG.filter((row) => rowApplies(row, detected, detectedTools));
  const active =
    Array.isArray(validated.active_guards) && validated.active_guards.length
      ? validated.active_guards
      : base.map((row) => row.name);
  const configSeverities = validated.severities || {};
  const envMap = envSeverities();

  const effectiveSeverities = {};
  const __catalog = active.map((name) => {
    const entry = applyTo(name);
    const severity = resolveSeverity(name, configSeverities, envMap);
    effectiveSeverities[name] = severity;
    return {
      name,
      checks: entry ? entry.checks : undefined,
      applies_when: entry ? entry.applies_when : undefined,
      severity,
      gate_mode: gateMode === 'advisory' ? 'advisory' : entry ? entry.gate_mode : 'hard',
      file: entry ? entry.file : null,
      manifest: entry ? entry.manifest : false,
      planned: entry ? entry.planned : false,
      config_keys: entry ? entry.config_keys : [],
    };
  });

  return {
    activeGuards: active,
    phases,
    gateMode,
    effectiveSeverities,
    layers: validated.layers || [],
    scope: validated.scope === undefined ? DEFAULT_SCOPE : validated.scope,
    excludePaths: validated.exclude_paths || [],
    framework: detected && detected.framework ? detected.framework : 'unknown',
    projectType: detected && detected.projectType ? detected.projectType : 'unknown',
    testRunner: detected && detected.testRunner ? detected.testRunner : 'unknown',
    rules: validated.rules || [],
    __catalog,
  };
}

module.exports = { loadConfig, validateConfig, resolveConfig, ConfigError, HARNESS_PHASES, ENV_SEVERITIES, DEFAULT_SCOPE };