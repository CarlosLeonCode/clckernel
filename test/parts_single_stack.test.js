/**
 * sdds/fullstack-monorepo, decision 2 (TDD plan items 1 and 7): a repo with a
 * single code part installs byte for byte what it installed before
 * multi-part support. The golden file was captured with that earlier code,
 * then regenerated deliberately for sdds/domain-agnostic: every hook gained
 * the project guards block (tools/guards/), and Agent-OS gained
 * check_data_files and the domain-neutral Clean Creation State rule.
 * Regenerated for sdds/config-foundation: tools/ gained the config readers
 * (_config.js + yaml.js, _config.py + _yaml.py) next to _changes.*, and the
 * Python hooks' ruff --extend-exclude lists them; nothing else changed.
 * Regenerated for sdds/unified-discovery: only the hook bodies changed — the
 * per-guard lines and the tools/guards/ loop became the audit orchestrator
 * block (`node tools/audit.js --hook` / `python3 tools/audit.py --hook`);
 * config, AGENTS.md and tools/ are byte-identical.
 * Regenerated for sdds/audit-cli: only AGENTS.md changed — Loop step 5 (and
 * the Agent-OS `feature` row) run the audit with `--change <sdd name>`, since
 * a plain audit no longer writes a report.
 * Regenerated for sdds/tdd-other-stacks: Go, Rust, Rails and Laravel install
 * tools/verify_tdd.js and their AGENTS.md safeguard line names the Red→Green
 * TDD Verifier; hooks and every other stack are byte-identical.
 * Regenerated for sdds/final-sweep: only the AGENTS.md command tables of
 * agent-os and generic changed — the feature row runs the audit with
 * `--change`, the audit/doctor/update rows name the CLI (`--change`,
 * `--dry-run`, `--add-guards`) and `start` no longer materializes
 * .clckernel.yaml; hooks, config and tools/ are byte-identical.
 * Regenerated for sdds/onboarding: only AGENTS.md changed — every template
 * ends with the "First session after install" section (src/onboarding.js);
 * hooks, config and tools/ are byte-identical.
 * Regenerated for sdds/kernel-bug-protocol: only AGENTS.md changed — every
 * template gains the "If the bug is in CLC Kernel" section (src/onboarding.js,
 * before the first-session section) and the command tables of agent-os and
 * generic gain the `clckernel report-bug <summary>` row; hooks, config and
 * tools/ are byte-identical.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SINGLE_STACK_FIXTURES, captureSingleStack } = require('./helpers/single_stack');
const GOLDEN = require('./fixtures/single_stack_snapshot.json');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');

describe('single-stack repos are installed exactly as before', () => {
  it('the golden file covers every fixture', () => {
    assert.deepStrictEqual(Object.keys(GOLDEN).sort(), Object.keys(SINGLE_STACK_FIXTURES).sort());
  });

  for (const [stack, files] of Object.entries(SINGLE_STACK_FIXTURES)) {
    it(`${stack}: same config shape, hook bytes, AGENTS.md and tools/`, () => {
      const actual = captureSingleStack(files, { autoDetectStack, generateHarness });
      const expected = GOLDEN[stack];
      assert.deepStrictEqual(actual.config, expected.config);
      assert.strictEqual(actual.hookFile, expected.hookFile);
      assert.strictEqual(actual.hook, expected.hook);
      assert.strictEqual(actual.agents, expected.agents);
      assert.deepStrictEqual(actual.tools, expected.tools);
    });
  }
});
