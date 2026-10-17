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
 * Skills the harness or tool plugins install (clckernel_cli, clc_forge_cli,
 * impeccable) and registry files are ignored.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Repository root (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

const NAME = 'check_hitl';
const SKILL_ROOTS = ['skills/', '.agents/skills/', '.claude/skills/'];
const EXCLUDED_SKILLS = new Set(['clckernel_cli', 'clc_forge_cli', 'impeccable']);
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

/** True when the Markdown text holds an explicit HITL marker outside code fences. */
function hasMarker(text) {
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
    if (INLINE_MARKER_RE.test(line) || HEADING_MARKER_RE.test(line)) return true;
  }
  return false;
}

const check = async function checkHitl(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: ['.md'] });
  const targets = files.filter(needsMarker);

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
    if (text === null || hasMarker(text)) continue;
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
