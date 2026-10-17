#!/usr/bin/env node
/**
 * Relative Link Guard
 * In every Markdown file changed in the snapshot, relative links
 * (`[text](path)` and `![alt](path)`) must point to a file or folder present
 * in the same snapshot (the index on a pre-commit, HEAD on a manual run).
 * URLs and other schemes (https:, mailto:, ...), pure anchors (#section) and
 * links inside code spans or fenced code blocks are ignored; the #anchor and
 * ?query parts of a path are not checked.
 * Skills the harness installs (clckernel_cli) and registry files are ignored.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Repository root (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const path = require('path');
const { changedFiles, readFile, listFiles } = require('./_changes');

const NAME = 'check_links';
const HARNESS_SKILLS = new Set(['clckernel_cli', 'clc_forge_cli']);
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
// [text](target "title") / ![alt](<target with spaces>)
const LINK_RE = /!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function isHarnessFile(file) {
  return file.split('/').some(segment => HARNESS_SKILLS.has(segment));
}

/**
 * Markdown lines with fenced code blocks blanked and code spans removed, so
 * line numbers stay aligned with the file.
 * @param {string} text
 * @returns {string[]}
 */
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

/**
 * Repository path a relative link resolves to, or null when it is not checked.
 * @returns {string|null} '' for a target outside the repository
 */
function resolveTarget(file, raw) {
  let target = raw.startsWith('<') ? raw.slice(1, -1) : raw;
  if (!target || target.startsWith('#') || target.startsWith('//') || SCHEME_RE.test(target)) return null;
  target = target.split('#')[0].split('?')[0];
  if (!target) return null;
  try {
    target = decodeURI(target);
  } catch {
    // Keep the raw spelling when it is not valid percent-encoding.
  }
  const joined = target.startsWith('/')
    ? path.posix.normalize(target.slice(1))
    : path.posix.join(path.posix.dirname(file), target);
  const normalized = path.posix.normalize(joined).replace(/\/+$/, '');
  if (normalized === '..' || normalized.startsWith('../')) return '';
  return normalized === '.' ? '.' : normalized;
}

const check = async function checkLinks(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: ['.md'] });
  const markdown = files.filter(f => !isHarnessFile(f));

  if (markdown.length === 0) {
    return {
      exitCode: 0, skipped: true, name: NAME,
      data: { violations: [], message: 'No changed Markdown files' },
    };
  }

  const snapshot = new Set(listFiles(dir, mode));
  const folders = new Set(['.']);
  for (const file of snapshot) {
    let parent = path.posix.dirname(file);
    while (parent !== '.' && !folders.has(parent)) {
      folders.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const present = target => snapshot.has(target) || folders.has(target);

  const violations = [];
  for (const file of markdown) {
    const text = readFile(dir, file, mode);
    if (text === null) continue;
    proseLines(text).forEach((line, index) => {
      for (const match of line.matchAll(LINK_RE)) {
        const target = resolveTarget(file, match[1]);
        if (target === null) continue;
        if (target === '' || !present(target)) {
          violations.push({
            file,
            line: index + 1,
            message: target === ''
              ? `Link "${match[1]}" points outside the repository`
              : `Broken link "${match[1]}": ${target} is not in the commit`,
          });
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
        ? `${violations.length} broken relative link(s) found`
        : `All relative links in ${markdown.length} changed Markdown file(s) resolve`,
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
