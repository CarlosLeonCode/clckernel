/**
 * AGENTS.md only promises guards that are
 * installed. Every safeguard line an adapter renders either names something
 * the adapter installs (a guard or an external tool of that part), or says it
 * is agent-enforced. The catalog's `manifest` flag matches the manifests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SAFEGUARD_CATALOG } = require('../src/catalog');
const { TechnologyDetector } = require('../src/technologies/detector');

const ADAPTERS_DIR = path.join(__dirname, '..', 'src', 'adapters');
const ADAPTERS = fs.readdirSync(ADAPTERS_DIR).filter((f) => f.endsWith('.js') && f !== 'base.js')
  .map((f) => new (require(path.join(ADAPTERS_DIR, f)))());

/** Phrase of a safeguard line -> the tool that keeps the promise ('audit': the orchestrator, always installed). */
const PROMISES = [
  [/\((check_\w+|scan_secrets)\)/, (m) => m[1]],
  [/UI Component Reuse First Guard|Semantic Design Token Guard/, 'check_ui_reuse'],
  [/Clean Architecture/, 'check_architecture'],
  [/Secret|Credential Leak/, 'scan_secrets'],
  [/Accessibility & ARIA Guard/, 'check_a11y'],
  [/Responsive Design/, 'check_responsive'],
  [/SEO, GEO/, 'check_seo'],
  [/Next\/Image Guard/, 'check_performance'],
  [/Red→Green TDD Verifier/, 'verify_tdd'],
  [/N\+1 Heuristic/, 'check_db_efficiency'],
  [/Alembic Migration Reversibility Guard/, 'check_migrations'],
  [/Educational Audit Gate/, 'audit'],
  [/Ruff/, 'ruff'],
  [/golangci-lint/, 'golangci-lint'],
  [/PHPStan/, 'phpstan'],
  [/RuboCop/, 'rubocop'],
  [/Brakeman/, 'brakeman'],
  [/cargo clippy/, 'cargo_clippy'],
  [/cargo audit/, 'cargo_audit'],
  [/TypeScript Typecheck/, 'tsc'],
  [/astro check/, 'astro_check'],
];

/** The tool a line promises, null when it promises none it can name. */
function promisedTool(line) {
  for (const [re, tool] of PROMISES) {
    const m = re.exec(line);
    if (m) return typeof tool === 'function' ? tool(m) : tool;
  }
  return null;
}

describe('REQ-1: every AGENTS.md safeguard line is kept by an installed tool or says agent-enforced', () => {
  for (const adapter of ADAPTERS) {
    it(adapter.name, () => {
      const tools = new Set([...adapter.getTools(process.cwd()).map((t) => t.name), 'audit']);
      for (const line of adapter.getSafeguards()) {
        if (/agent-enforced/.test(line)) continue;
        const tool = promisedTool(line);
        assert.ok(tool, `${adapter.name}: "${line}" names no installed tool and is not marked agent-enforced`);
        assert.ok(tools.has(tool), `${adapter.name}: "${line}" promises ${tool}, which the adapter does not install`);
      }
    });
  }

  it('check_seo describes what it checks (no metadata / OpenGraph claim)', () => {
    const header = fs.readFileSync(path.join(__dirname, '..', 'tools', 'check_seo.js'), 'utf-8').split('*/')[0];
    assert.doesNotMatch(header, /OpenGraph|og:title|Missing page metadata/);
    for (const adapter of ADAPTERS) {
      for (const line of adapter.getSafeguards()) assert.doesNotMatch(line, /OpenGraph/, `${adapter.name}: ${line}`);
      for (const tool of adapter.getTools(process.cwd())) assert.doesNotMatch(tool.description, /OpenGraph/, `${adapter.name}: ${tool.name}`);
    }
    assert.doesNotMatch(SAFEGUARD_CATALOG.find((e) => e.name === 'check_seo').checks, /OpenGraph/);
  });
});

describe('REQ-1: catalog manifest flags match the manifests', () => {
  it('manifest: true exactly for guards some adapter or technology installs (planned entries aside)', () => {
    const declared = new Set(ADAPTERS.flatMap((a) => a.getTools(process.cwd()).map((t) => t.name)));
    const techs = ['celery', 'redis', 'postgresql', 'docker', 'supabase', 'sql-migrations', 'data-client', 'mcp'];
    for (const tool of new TechnologyDetector().getToolsForTech(techs)) declared.add(tool.name);
    for (const entry of SAFEGUARD_CATALOG.filter((e) => !e.planned)) {
      assert.strictEqual(entry.manifest, declared.has(entry.name), `${entry.name}: manifest ${entry.manifest}`);
    }
  });
});
