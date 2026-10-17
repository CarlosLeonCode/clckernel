#!/usr/bin/env node
/**
 * Forgotten Placeholder Guard
 * In every .md/.yml/.yaml/.json file changed in the snapshot, flags the
 * markers a draft leaves behind: the uppercase draft words listed in
 * DRAFT_WORDS (whole words), "lorem ipsum" (any case) and unresolved
 * `{{...}}` slots.
 * Inside templates/ the `{{...}}` slots are legitimate and not flagged.
 * GitHub Actions expressions (`${{ ... }}`) are never flagged; in Markdown,
 * code spans and fenced code blocks are ignored.
 * Skills the harness installs (clckernel_cli) and registry files are ignored.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Repository root (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

const NAME = 'check_placeholders';
const EXTENSIONS = ['.md', '.yml', '.yaml', '.json'];
const HARNESS_SKILLS = new Set(['clckernel_cli', 'clc_forge_cli']);
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
// Spelled in parts so this source never carries the markers it looks for.
const DRAFT_WORDS = [['TO', 'DO'], ['T', 'BD'], ['FIX', 'ME']].map(parts => parts.join(''));
const MARKERS = [
  ...DRAFT_WORDS.map(word => ({ label: word, re: new RegExp(`\\b${word}\\b`) })),
  { label: 'lorem ipsum', re: /\blorem\s+ipsum\b/i },
];
const SLOT = { label: 'unresolved {{...}}', re: /(?<!\$)\{\{[^{}\n]*\}\}/ };

function isHarnessFile(file) {
  return file.split('/').some(segment => HARNESS_SKILLS.has(segment));
}

/** True for a file under a templates/ folder (at any depth). */
function inTemplates(file) {
  return file.split('/').slice(0, -1).includes('templates');
}

/** Markdown lines with fenced code blocks blanked and code spans removed. */
function proseLines(text) {
  let fence = null;
  return text.split(/\r?\n/).map(line => {
    const open = FENCE_RE.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      return '';
    }
    if (open) {
      fence = open[1];
      return '';
    }
    return line.replace(/(`+)[^`]*?\1/g, '');
  });
}

const check = async function checkPlaceholders(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: EXTENSIONS });
  const candidates = files.filter(f => !isHarnessFile(f));

  if (candidates.length === 0) {
    return {
      exitCode: 0, skipped: true, name: NAME,
      data: { violations: [], message: 'No changed .md/.yml/.yaml/.json files' },
    };
  }

  const violations = [];
  for (const file of candidates) {
    const text = readFile(dir, file, mode);
    if (text === null) continue;
    const markers = inTemplates(file) ? MARKERS : [...MARKERS, SLOT];
    const lines = file.endsWith('.md') ? proseLines(text) : text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { label, re } of markers) {
        if (re.test(line)) {
          violations.push({ file, line: index + 1, message: `Forgotten placeholder (${label}): ${line.trim().slice(0, 120)}` });
        }
      }
    });
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    skipped: false,
    name: NAME,
    data: {
      violations,
      message: violations.length > 0
        ? `${violations.length} forgotten placeholder(s) found`
        : `No forgotten placeholders in ${candidates.length} changed file(s)`,
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
