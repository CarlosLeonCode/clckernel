#!/usr/bin/env node
/**
 * Human-in-the-Loop (HITL) Checkpoint Guard
 * Every skill and playbook changed in the snapshot must declare its human
 * checkpoint with an explicit marker:
 *   - a line starting with `HITL:` (list, quote and bold markup allowed), or
 *   - a heading `## Human checkpoint` or `## HITL` (any level from 2 to 6).
 * A word such as "review" or "confirm" is not a marker. Markers inside fenced
 * code blocks do not count.
 * Checked files: SKILL.md under skills/, .agents/skills/ or .claude/skills/,
 * flat skills/*.md files, and Markdown under playbooks/ (README.md excluded).
 * The kernel's own skill (clckernel_cli) is checked like any other skill, even
 * though the harness registry lists it (other guards skip registry files).
 * Ignored: the retired kernel skill (clc_forge_cli, removed by `update`) and
 * skills vendored by third-party tool plugins (impeccable).
 *
 * The project config (.clckernel.yaml) can change all three choices:
 *   hitl.markers  regexes (case-insensitive, one line, outside code fences)
 *                 that replace the two markers above
 *   hitl.paths    globs of the changed files to check, replacing the selection above
 *   hitl.optOut   { key, value }: a file whose frontmatter has `key: value` is exempt
 * Self-contained: uses only Node.js built-ins (and the sibling _config.js
 * when the project has a config file).
 *
 * @param {string} targetDir - Repository root (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile, projectConfig, globMatcher } = require('./_changes');

const NAME = 'check_hitl';
const SKILL_ROOTS = ['skills/', '.agents/skills/', '.claude/skills/'];
const EXCLUDED_SKILLS = new Set(['clc_forge_cli', 'impeccable']);
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_MARKER_RE = /^\s*(?:(?:[-*+]|\d+[.)]|>)\s+)*[*_]{0,2}HITL[*_]{0,2}\s*:/i;
const HEADING_MARKER_RE = /^\s{0,3}#{2,6}\s+(?:Human[- ]checkpoints?|HITL)\b/i;

/** True for a changed file that must carry a HITL marker. */
function needsMarker(file) {
  if (!file.endsWith('.md')) return false;
  const parts = file.split('/');
  const base = parts[parts.length - 1];
  if (base.toLowerCase() === 'readme.md') return false;
  if (parts.some(segment => EXCLUDED_SKILLS.has(segment))) return false;
  if (file.startsWith('playbooks/')) return true;
  const root = SKILL_ROOTS.find(r => file.startsWith(r));
  if (!root) return false;
  const rest = file.slice(root.length).split('/');
  // skills/<name>/SKILL.md, or a flat skills/<name>.md file.
  return base === 'SKILL.md' || rest.length === 1;
}

const DEFAULT_MARKERS = [INLINE_MARKER_RE, HEADING_MARKER_RE];

/** True when the Markdown text holds an explicit HITL marker outside code fences. */
function hasMarker(text, markers = DEFAULT_MARKERS) {
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const open = FENCE_RE.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    if (markers.some(re => re.test(line))) return true;
  }
  return false;
}

/**
 * Value of a top-level `key:` line of the file's YAML frontmatter, unquoted;
 * null without frontmatter or key.
 */
function frontmatterValue(text, key) {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') return null;
    const sep = lines[i].indexOf(':');
    if (sep <= 0 || lines[i].slice(0, sep) !== key) continue;
    const value = lines[i].slice(sep + 1).replace(/\s+#.*$/, '').trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    return quoted ? quoted[2] : value;
  }
  return null;
}

/** The selection, markers and opt-out of this project: config or defaults. */
function settings(dir) {
  const config = projectConfig(dir);
  const hitl = config ? config.hitl : { markers: null, paths: null, optOut: null };
  return {
    select: hitl.paths ? globMatcher(hitl.paths) : needsMarker,
    extensions: hitl.paths ? undefined : ['.md'],
    markers: hitl.markers ? hitl.markers.map(source => new RegExp(source, 'i')) : DEFAULT_MARKERS,
    optOut: hitl.optOut,
  };
}

const check = async function checkHitl(targetDir) {
  const dir = targetDir || process.cwd();
  const { select, extensions, markers, optOut } = settings(dir);
  const { mode, files } = changedFiles(dir, { extensions, includeManaged: true });
  const targets = files.filter(select);

  if (targets.length === 0) {
    return {
      exitCode: 0,
      skipped: true,
      name: NAME,
      data: { violations: [], message: 'No changed skills or playbooks' },
    };
  }

  const violations = [];
  for (const file of targets) {
    const text = readFile(dir, file, mode);
    if (text === null || hasMarker(text, markers)) continue;
    if (optOut && frontmatterValue(text, optOut.key) === optOut.value) continue;
    violations.push({
      file,
      message: 'Missing explicit Human-in-the-Loop checkpoint: add a `HITL:` line or a `## Human checkpoint` section',
    });
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    skipped: false,
    name: NAME,
    data: {
      violations,
      message: violations.length > 0
        ? `${violations.length} skill(s)/playbook(s) missing an explicit HITL checkpoint marker`
        : `All ${targets.length} changed skill(s)/playbook(s) declare a HITL checkpoint`,
    },
  };
};

module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
