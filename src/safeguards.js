/**
 * CLC Kernel — The safeguard lines of AGENTS.md section 2, from the guards a
 * project has installed.
 *
 * An adapter's getSafeguards() describes its full manifest. On install every
 * guard of that manifest is installed, so the lines are used as they are. On
 * update the project may have fewer guards (one it removed) or more (one added
 * with --add-guards), so the lines follow what is installed:
 *   - a line promising a manifest guard that is not installed says so, and
 *     says how to add it back (agent-enforced until then);
 *   - an agent-enforced line whose `--add-guards <name>` guard is installed
 *     names that guard instead;
 *   - a technology guard is listed only when installed;
 *   - a guard installed outside the stack's manifest is listed from the catalog.
 */

const { SAFEGUARD_CATALOG } = require('./catalog');
const { technologySafeguards } = require('./technologies/detector');

/** Phrase of a safeguard line -> the guard (a file in tools/) that keeps the promise. */
const GUARD_PROMISES = [
  [/\((check_\w+|scan_secrets|verify_tdd)\)/, (m) => m[1]],
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
];

/** The `--add-guards` hint of an agent-enforced line. */
const ADD_HINT = /`clckernel update --add-guards (\w+)` adds the guard/;

/** The guard a safeguard line promises, or null. */
function promisedGuard(line) {
  for (const [re, guard] of GUARD_PROMISES) {
    const m = re.exec(line);
    if (m) return typeof guard === 'function' ? guard(m) : guard;
  }
  return null;
}

/** Line of a catalog guard: what it checks and its name. */
function catalogLine(name) {
  const entry = SAFEGUARD_CATALOG.find((e) => e.name === name);
  return entry ? `${entry.checks} (${name})` : name;
}

/**
 * The lines of a stack's safeguards (without the leading "- "), following
 * the installed guards. The guards the lines name are added to `covered`.
 * @param {string[]} lines - adapter.getSafeguards()
 * @param {{ installed: Set<string>, manifest: Set<string> }|null} state - Guard
 *   names installed now and offered by the stack's manifest; null on install
 *   (every manifest guard is installed)
 * @param {Set<string>} [covered]
 * @returns {string[]}
 */
function stackLines(lines, state, covered = new Set()) {
  if (!state) return [...lines];
  const { installed, manifest } = state;
  return lines.map((line) => {
    if (/agent-enforced/.test(line)) {
      const hint = ADD_HINT.exec(line);
      if (hint && installed.has(hint[1])) {
        covered.add(hint[1]);
        return catalogLine(hint[1]);
      }
      return line;
    }
    const guard = promisedGuard(line);
    if (guard && manifest.has(guard) && !installed.has(guard)) {
      return `${line} — not installed (agent-enforced; \`clckernel update --add-guards ${guard}\` adds the guard)`;
    }
    if (guard) covered.add(guard);
    return line;
  });
}

/**
 * The lines of the technology guards that are installed, then of the guards
 * installed outside the stack's manifest that no line names yet.
 * @param {Array} techTools - config.techTools
 * @param {{ installed: Set<string>, manifest: Set<string> }|null} state - See stackLines
 * @param {Set<string>} [covered] - Guards the stack lines already name
 * @returns {string[]}
 */
function extraLines(techTools, state, covered = new Set()) {
  if (!state) return technologySafeguards(techTools);
  const { installed, manifest } = state;
  const tech = (techTools || []).filter((tool) => installed.has(tool.name));
  for (const tool of tech) covered.add(tool.name);
  const extras = [...installed].filter((name) => !manifest.has(name) && !covered.has(name)).sort().map(catalogLine);
  return [...technologySafeguards(tech), ...extras];
}

/**
 * The safeguard lines of a single stack's section 2.
 * @param {string[]} lines - adapter.getSafeguards()
 * @param {Array} techTools - config.techTools
 * @param {{ installed: Set<string>, manifest: Set<string> }|null} state - See stackLines
 * @returns {string[]}
 */
function renderSafeguards(lines, techTools, state) {
  const covered = new Set();
  return [...stackLines(lines, state, covered), ...extraLines(techTools, state, covered)];
}

module.exports = { renderSafeguards, stackLines, extraLines, promisedGuard };
