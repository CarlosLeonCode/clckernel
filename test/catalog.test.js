/**
 * CLC Forge — Catalog tests for the central safeguard registry (src/catalog.js).
 * Covers: 24-entry completeness (cross-checked against design §1.2 and the
 * actual tools/ directory), full shape validation, guard-file correlation,
 * uniqueness, and the applyTo/severityFor/gateFor lookup helpers.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  SAFEGUARD_CATALOG,
  VALID_SEVERITIES,
  VALID_GATE_MODES,
  VALID_PHASES,
  VALID_APPLIES_WHEN,
  applyTo,
  severityFor,
  gateFor,
} = require('../src/catalog.js');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

function guardFileExists(file) {
  if (!file) return false;
  return file.split('+').every(variant => fs.existsSync(path.join(TOOLS_DIR, variant)));
}

describe('SAFEGUARD_CATALOG', () => {
  it('exposes exactly 29 entries, one per safeguard the framework knows about', () => {
    assert.strictEqual(SAFEGUARD_CATALOG.length, 29, `expected 29, got ${SAFEGUARD_CATALOG.length}`);
    const names = SAFEGUARD_CATALOG.map(e => e.name);
    assert.deepStrictEqual(names, [
      'scan_secrets', 'check_architecture', 'check_custom', 'check_a11y',
      'check_ui_reuse', 'check_performance', 'check_responsive', 'check_seo', 'check_storybook', 'check_api_contracts',
      'check_migrations', 'verify_tdd', 'check_scope', 'celery_guard', 'redis_guard',
      'postgres_guard', 'docker_guard', 'check_symlinks', 'check_hitl', 'check_domain_data',
      'ruff', 'pytest', 'tsc', 'lint', 'graphify',
      'gentle_ai_review', 'check_openapi_drift', 'check_db_efficiency', 'check_observability',
    ]);
  });

  it('has unique names and no duplicate alias labels', () => {
    const names = SAFEGUARD_CATALOG.map(e => e.name);
    assert.strictEqual(new Set(names).size, names.length, 'names must be unique');
    const allLabels = SAFEGUARD_CATALOG.flatMap(e => e.labels);
    assert.strictEqual(new Set(allLabels).size, allLabels.length, 'labels must be globally unique');
  });

  it('validates every required field on every entry (shape loop)', () => {
    const required = ['name', 'labels', 'checks', 'verify', 'applies_when', 'severity', 'gate_mode', 'config_keys', 'phase', 'file', 'manifest', 'planned'];
    for (const entry of SAFEGUARD_CATALOG) {
      for (const key of required) {
        assert.ok(key in entry, `${entry.name} is missing required field "${key}"`);
      }
      assert.ok(typeof entry.name === 'string' && entry.name.length > 0, `${entry.name}: name`);
      assert.ok(Array.isArray(entry.labels) && entry.labels.length > 0, `${entry.name}: labels`);
      assert.ok(entry.labels.includes(entry.name), `${entry.name}: labels must include the name`);
      assert.ok(typeof entry.checks === 'string' && entry.checks.length > 0, `${entry.name}: checks`);
      assert.ok(Array.isArray(entry.verify) && entry.verify.length > 0, `${entry.name}: verify`);
      assert.ok(VALID_APPLIES_WHEN.includes(entry.applies_when), `${entry.name}: applies_when "${entry.applies_when}"`);
      assert.ok(VALID_SEVERITIES.includes(entry.severity), `${entry.name}: severity "${entry.severity}"`);
      assert.ok(VALID_GATE_MODES.includes(entry.gate_mode), `${entry.name}: gate_mode "${entry.gate_mode}"`);
      assert.ok(Array.isArray(entry.config_keys) && entry.config_keys.every(k => typeof k === 'string'), `${entry.name}: config_keys`);
      assert.ok(VALID_PHASES.includes(entry.phase), `${entry.name}: phase "${entry.phase}"`);
      assert.ok(entry.file === null || typeof entry.file === 'string', `${entry.name}: file`);
      assert.strictEqual(typeof entry.manifest, 'boolean', `${entry.name}: manifest`);
      assert.strictEqual(typeof entry.planned, 'boolean', `${entry.name}: planned`);
    }
  });

  it('every verify token references a plausible verify_* audit goal', () => {
    for (const entry of SAFEGUARD_CATALOG) {
      for (const token of entry.verify) {
        assert.match(token, /^verify_[a-z0-9_]+$/, `${entry.name}: verify token "${token}"`);
      }
    }
  });

  it('every non-null file exists in bundled tools/ unless the entry is planned', () => {
    for (const entry of SAFEGUARD_CATALOG) {
      if (entry.file === null) continue;
      const exists = guardFileExists(entry.file);
      if (entry.planned) {
        assert.ok(!exists, `${entry.name}: planned file "${entry.file}" should NOT exist yet`);
      } else {
        assert.ok(exists, `${entry.name}: file "${entry.file}" missing from tools/`);
      }
    }
  });

  it('flags exactly the 2 Slice C guards as planned', () => {
    const planned = SAFEGUARD_CATALOG.filter(e => e.planned).map(e => e.name);
    assert.deepStrictEqual(planned, ['check_openapi_drift', 'check_observability']);
  });

  it('keeps design defaults for the new observability guard (warning/advisory)', () => {
    const observability = applyTo('check_observability');
    assert.strictEqual(observability.severity, 'warning');
    assert.strictEqual(observability.gate_mode, 'advisory');
  });

  it('maps stack-specific guards to their applicability predicates', () => {
    assert.strictEqual(applyTo('redis_guard').applies_when, 'redis');
    assert.strictEqual(applyTo('postgres_guard').applies_when, 'postgresql');
    assert.strictEqual(applyTo('docker_guard').applies_when, 'docker');
    assert.strictEqual(applyTo('celery_guard').applies_when, 'celery');
    assert.strictEqual(applyTo('check_openapi_drift').applies_when, 'fastapi');
    assert.strictEqual(applyTo('check_db_efficiency').applies_when, 'django|sqlalchemy');
    assert.strictEqual(applyTo('check_migrations').applies_when, 'backend,fastapi,django');
  });

  it('external CLI entries have file null and contribute no tool files', () => {
    for (const name of ['ruff', 'pytest', 'tsc', 'lint', 'graphify', 'gentle_ai_review']) {
      const entry = applyTo(name);
      assert.strictEqual(entry.file, null, `${name}: external row must have file null`);
    }
  });
});

describe('applyTo', () => {
  it('resolves the entry by exact name', () => {
    assert.strictEqual(applyTo('check_custom').name, 'check_custom');
    assert.strictEqual(applyTo('redis_guard').name, 'redis_guard');
    assert.strictEqual(applyTo('check_observability').name, 'check_observability');
  });

  it('resolves alias labels (js/py variants and CLI aliases)', () => {
    assert.strictEqual(applyTo('check_custom.js').name, 'check_custom');
    assert.strictEqual(applyTo('check_custom.py').name, 'check_custom');
    assert.strictEqual(applyTo('scan_secrets.py').name, 'scan_secrets');
    assert.strictEqual(applyTo('lint-staged').name, 'lint');
    assert.strictEqual(applyTo('gentle-ai').name, 'gentle_ai_review');
  });

  it('normalizes case and whitespace', () => {
    assert.strictEqual(applyTo('  Check_Custom ').name, 'check_custom');
  });

  it('returns null for unknown names (no throw)', () => {
    assert.strictEqual(applyTo('check_white'), null);
    assert.strictEqual(applyTo('check_black'), null);
    assert.strictEqual(applyTo('check_memory'), null);
    assert.strictEqual(applyTo('check_audit'), null);
    assert.strictEqual(applyTo('nonexistent_guard'), null);
    assert.strictEqual(applyTo(''), null);
    assert.strictEqual(applyTo(undefined), null);
    assert.strictEqual(applyTo(null), null);
  });
});

describe('severityFor / gateFor', () => {
  it('resolves catalog defaults for representative entries', () => {
    assert.strictEqual(severityFor('check_custom'), 'error');
    assert.strictEqual(severityFor('check_observability'), 'warning');
    assert.strictEqual(severityFor('redis_guard'), 'error');
    assert.strictEqual(severityFor('check_ui_reuse'), 'warning');
    assert.strictEqual(gateFor('check_custom'), 'hard');
    assert.strictEqual(gateFor('check_observability'), 'advisory');
    assert.strictEqual(gateFor('redis_guard'), 'hard');
  });

  it('returns null for unknown names (no throw)', () => {
    assert.strictEqual(severityFor('check_black'), null);
    assert.strictEqual(gateFor('check_black'), null);
    assert.strictEqual(severityFor(undefined), null);
    assert.strictEqual(gateFor(''), null);
  });
});