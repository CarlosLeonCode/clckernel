/**
 * CLC Kernel — Central Safeguard Catalog
 *
 * Single source of truth describing every safeguard/guard the clckernel
 * framework knows about. Drives config validation (src/config.js),
 * config-driven harness generation (src/generator.js), doctor checks, and
 * the future safeguard audit.
 *
 * Entry shape (design §1.2, additive fields noted):
 *   name        {string}        guard script basename WITHOUT extension
 *   labels      {string[]}      alias labels (yaml/js/python variants) for config matching
 *   checks      {string}        short description of what the safeguard verifies (design §1.2)
 *   verify      {string[]}      plausible verify_* audit-goal tokens this safeguard covers
 *   applies_when{string}        applicability predicate key (stack/project conditions)
 *   severity    {string}        'error' | 'warning' | 'advisory' (catalog default)
 *   gate_mode   {string}        'hard' | 'advisory' (catalog default)
 *   config_keys {string[]}      .clc-forge.yml keys this safeguard consumes
 *   phase       {string}        10-phase harness phase: 'audit' | 'test' | 'review' | 'handover'
 *   file        {string|null}   bundled tools/ file(s), '+' separated; null = external CLI
 *   manifest    {boolean}       true = declared by >=1 adapter manifest (design §1.2)
 *   planned     {boolean}       true = tool file not yet materialized (future slice)
 *
 * The catalog is a JOIN, not a rewrite: the no-config adapter path never
 * consults it; only the config-driven generation path does.
 */

const SAFEGUARD_CATALOG = [
  { name: 'scan_secrets', labels: ['scan_secrets', 'scan_secrets.js', 'scan_secrets.py'],
    checks: 'Secret & private-key leak scan', verify: ['verify_secret_leaks', 'verify_no_hardcoded_secrets'],
    applies_when: 'always', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'scan_secrets.js+scan_secrets.py', manifest: true, planned: false },

  { name: 'check_architecture', labels: ['check_architecture', 'check_architecture.js', 'check_architecture.py'],
    checks: 'Clean Architecture layer / server-component boundaries', verify: ['verify_architecture_layers', 'verify_server_component_boundaries'],
    applies_when: 'frontend,backend', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_architecture.js+check_architecture.py', manifest: true, planned: false },

  { name: 'check_custom', labels: ['check_custom', 'check_custom.js', 'check_custom.py'],
    checks: 'User-defined regex rules from `.clc-forge.yml`', verify: ['verify_custom_rules', 'verify_user_defined_regex_rules'],
    applies_when: 'always', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_custom.js+check_custom.py', manifest: true, planned: false },

  { name: 'check_a11y', labels: ['check_a11y', 'check_a11y.js'],
    checks: 'ARIA + alt accessibility', verify: ['verify_a11y', 'verify_accessibility'],
    applies_when: 'frontend', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_a11y.js', manifest: true, planned: false },

  { name: 'check_ui_reuse', labels: ['check_ui_reuse', 'check_ui_reuse.js'],
    checks: 'UI primitive reuse from components/ui/', verify: ['verify_ui_reuse', 'verify_component_reuse'],
    applies_when: 'frontend', severity: 'warning', gate_mode: 'advisory', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_ui_reuse.js', manifest: true, planned: false },

  { name: 'check_performance', labels: ['check_performance', 'check_performance.js'],
    checks: 'next/image + tree-shaking', verify: ['verify_performance', 'verify_image_optimization'],
    applies_when: 'frontend', severity: 'warning', gate_mode: 'advisory', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_performance.js', manifest: true, planned: false },

  { name: 'check_responsive', labels: ['check_responsive', 'check_responsive.js'],
    checks: 'Mobile-first responsiveness, fixed-width overflow & touch target size', verify: ['verify_responsive', 'verify_mobile_adaptability'],
    applies_when: 'frontend', severity: 'warning', gate_mode: 'advisory', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_responsive.js', manifest: true, planned: false },

  { name: 'check_seo', labels: ['check_seo', 'check_seo.js'],
    checks: 'SEO metadata, OpenGraph, GEO tags, semantic HTML & LCP priority', verify: ['verify_seo', 'verify_geo_metadata', 'verify_core_web_vitals'],
    applies_when: 'frontend', severity: 'warning', gate_mode: 'advisory', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_seo.js', manifest: true, planned: false },

  { name: 'check_storybook', labels: ['check_storybook', 'check_storybook.js'],
    checks: 'Storybook coverage (`.stories.tsx`)', verify: ['verify_storybook_coverage'],
    applies_when: 'frontend', severity: 'warning', gate_mode: 'advisory', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_storybook.js', manifest: true, planned: false },

  { name: 'check_api_contracts', labels: ['check_api_contracts', 'check_api_contracts.js'],
    checks: 'Zod response-schema parsing', verify: ['verify_api_contracts', 'verify_response_schemas'],
    applies_when: 'frontend', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_api_contracts.js', manifest: true, planned: false },

  { name: 'check_migrations', labels: ['check_migrations', 'check_migrations.py'],
    checks: 'Alembic/Django migration idempotency', verify: ['verify_migration_idempotency'],
    applies_when: 'backend,fastapi,django', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_migrations.py', manifest: true, planned: false },

  { name: 'verify_tdd', labels: ['verify_tdd', 'verify_tdd.py'],
    checks: 'Real red→green TDD validation', verify: ['verify_tdd_red_green', 'verify_tdd_evidence'],
    applies_when: 'backend', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'verify_tdd.py', manifest: false, planned: false },

  { name: 'check_scope', labels: ['check_scope', 'check_scope.py'],
    checks: 'git-diff vs SDD-authorization scope guardrail', verify: ['verify_scope_authorization', 'verify_sdd_scope'],
    applies_when: 'always', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_scope.py', manifest: false, planned: false },

  { name: 'celery_guard', labels: ['celery_guard', 'celery_guard.py'],
    checks: 'Broker URL exposure, ignore_result, result backend', verify: ['verify_celery_broker_config'],
    applies_when: 'celery', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'celery_guard.py', manifest: true, planned: false },

  { name: 'redis_guard', labels: ['redis_guard', 'redis_guard.py'],
    checks: 'decode_responses, connect timeout, hardcoded URLs', verify: ['verify_redis_config'],
    applies_when: 'redis', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'redis_guard.py', manifest: true, planned: false },

  { name: 'postgres_guard', labels: ['postgres_guard', 'postgres_guard.py'],
    checks: 'Raw SQL string formatting, hstore misuse', verify: ['verify_postgres_sql_usage'],
    applies_when: 'postgresql', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'postgres_guard.py', manifest: true, planned: false },

  { name: 'docker_guard', labels: ['docker_guard', 'docker_guard.py'],
    checks: 'Non-root USER, ENV secrets, missing HEALTHCHECK', verify: ['verify_dockerfile_security'],
    applies_when: 'docker', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'docker_guard.py', manifest: true, planned: false },

  { name: 'check_symlinks', labels: ['check_symlinks', 'check_symlinks.js'],
    checks: 'AI IDE symlinks and rule mirror verification', verify: ['verify_symlinks', 'verify_rule_mirrors'],
    applies_when: 'agent-os', severity: 'error', gate_mode: 'hard', config_keys: ['scope'],
    phase: 'audit', file: 'check_symlinks.js', manifest: true, planned: false },

  { name: 'check_hitl', labels: ['check_hitl', 'check_hitl.js'],
    checks: 'Human-in-the-Loop review checkpoint validator in subagent skills', verify: ['verify_hitl', 'verify_human_review_checkpoints'],
    applies_when: 'agent-os', severity: 'error', gate_mode: 'hard', config_keys: ['scope'],
    phase: 'audit', file: 'check_hitl.js', manifest: true, planned: false },

  { name: 'check_domain_data', labels: ['check_domain_data', 'check_domain_data.js'],
    checks: 'Domain deliverables schema and clean state integrity', verify: ['verify_domain_data', 'verify_clean_state_metrics'],
    applies_when: 'agent-os', severity: 'error', gate_mode: 'hard', config_keys: ['scope'],
    phase: 'audit', file: 'check_domain_data.js', manifest: true, planned: false },

  { name: 'ruff', labels: ['ruff'],
    checks: 'Python AST linter (external CLI)', verify: ['verify_python_lint'],
    applies_when: 'backend', severity: 'warning', gate_mode: 'advisory', config_keys: [],
    phase: 'test', file: null, manifest: true, planned: false },

  { name: 'pytest', labels: ['pytest'],
    checks: 'Test runner (external CLI)', verify: ['verify_test_coverage'],
    applies_when: 'backend', severity: 'warning', gate_mode: 'advisory', config_keys: [],
    phase: 'test', file: null, manifest: true, planned: false },

  { name: 'tsc', labels: ['tsc'],
    checks: 'TypeScript typecheck (external)', verify: ['verify_typescript_types'],
    applies_when: 'frontend', severity: 'error', gate_mode: 'hard', config_keys: [],
    phase: 'test', file: null, manifest: true, planned: false },

  { name: 'lint', labels: ['lint', 'lint-staged'],
    checks: 'lint-staged (external)', verify: ['verify_lint_staged'],
    applies_when: 'frontend', severity: 'warning', gate_mode: 'advisory', config_keys: [],
    phase: 'test', file: null, manifest: true, planned: false },

  { name: 'graphify', labels: ['graphify'],
    checks: 'Memory graph (external, graceful-skip)', verify: ['verify_memory_graph'],
    applies_when: 'always', severity: 'warning', gate_mode: 'advisory', config_keys: [],
    phase: 'review', file: null, manifest: false, planned: false },

  { name: 'gentle_ai_review', labels: ['gentle_ai_review', 'gentle-ai'],
    checks: 'Native bounded review gate (external, graceful-skip)', verify: ['verify_rdd_review_gate'],
    applies_when: 'always', severity: 'error', gate_mode: 'hard', config_keys: [],
    phase: 'review', file: null, manifest: false, planned: false },

  { name: 'check_openapi_drift', labels: ['check_openapi_drift', 'check_openapi_drift.py'],
    checks: 'FastAPI OpenAPI schema drift vs app routes', verify: ['verify_openapi_drift'],
    applies_when: 'fastapi', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_openapi_drift.py', manifest: true, planned: true },

  { name: 'check_db_efficiency', labels: ['check_db_efficiency', 'check_db_efficiency.py'],
    checks: 'ORM N+1 / select_related / prefetch_related', verify: ['verify_db_efficiency', 'verify_no_n_plus_1'],
    applies_when: 'django|sqlalchemy', severity: 'error', gate_mode: 'hard', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_db_efficiency.py', manifest: true, planned: false },

  { name: 'check_observability', labels: ['check_observability', 'check_observability.py'],
    checks: 'structlog structured logging; bare print/logger ban', verify: ['verify_structured_logging'],
    applies_when: 'backend', severity: 'warning', gate_mode: 'advisory', config_keys: ['scope', 'exclude_paths'],
    phase: 'audit', file: 'check_observability.py', manifest: true, planned: true },
];

// Freeze the registry so config validation and generation can rely on it.
Object.freeze(SAFEGUARD_CATALOG);
for (const entry of SAFEGUARD_CATALOG) {
  Object.freeze(entry.labels);
  Object.freeze(entry.verify);
  Object.freeze(entry.config_keys);
  Object.freeze(entry);
}

/** Valid value sets exported for validators (src/config.js, tests). */
const VALID_SEVERITIES = ['error', 'warning', 'advisory'];
const VALID_GATE_MODES = ['hard', 'advisory'];
const VALID_PHASES = ['audit', 'test', 'review', 'handover'];
const VALID_APPLIES_WHEN = [
  'always', 'frontend', 'backend', 'fastapi', 'django', 'django|sqlalchemy',
  'celery', 'redis', 'postgresql', 'docker', 'frontend,backend', 'backend,fastapi,django',
  'agent-os',
];

/** Normalize an input label for catalog lookup. */
function normalizeLabel(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/**
 * Resolve a guard name (or any alias label) to its catalog entry.
 * @param {string} name - entry name or alias label (e.g. 'check_custom.js', 'lint-staged')
 * @returns {object|null} the catalog entry, or null when unknown
 */
function applyTo(name) {
  const key = normalizeLabel(name);
  if (!key) return null;
  for (const entry of SAFEGUARD_CATALOG) {
    if (entry.labels.includes(key)) return entry;
  }
  return null;
}

/** Catalog default severity for a guard name/label; null when unknown. */
function severityFor(name) {
  const entry = applyTo(name);
  return entry ? entry.severity : null;
}

/** Catalog default gate mode for a guard name/label; null when unknown. */
function gateFor(name) {
  const entry = applyTo(name);
  return entry ? entry.gate_mode : null;
}

module.exports = {
  SAFEGUARD_CATALOG,
  VALID_SEVERITIES,
  VALID_GATE_MODES,
  VALID_PHASES,
  VALID_APPLIES_WHEN,
  applyTo,
  severityFor,
  gateFor,
};