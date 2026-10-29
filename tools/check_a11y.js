#!/usr/bin/env node
/**
 * Accessibility & ARIA Guard
 * Scans changed .tsx/.jsx files for missing alt tags, aria-labels,
 * and semantic HTML violations.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

/**
 * Opening tags of a JSX/HTML source, read whole: attributes may span several
 * lines, and a '>' inside {...} expressions or quotes (e.g. an arrow function
 * in onChange) does not end the tag. Each tag reports the line it starts on.
 * @returns {Array<{name: string, attrs: string, start: number, end: number, line: number}>}
 */
function openingTags(content) {
  const tags = [];
  const open = /<([A-Za-z][\w.:-]*)/g;
  let match;
  while ((match = open.exec(content)) !== null) {
    let i = open.lastIndex;
    let depth = 0;
    let quote = null;
    for (; i < content.length; i++) {
      const c = content[i];
      if (quote) {
        if (c === quote && content[i - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
      } else if (c === '>' && depth <= 0) {
        break;
      }
    }
    if (i >= content.length) continue; // unterminated: not a tag
    tags.push({
      name: match[1],
      attrs: content.slice(open.lastIndex, i),
      start: match.index,
      end: i + 1,
      line: content.slice(0, match.index).split('\n').length,
    });
  }
  return tags;
}

/** Value of a static attribute: name="v", name='v' or name={"v"}; null otherwise. */
function attrValue(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["']([^"']*)["']\\s*\\})`));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function hasAttr(attrs, name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=`).test(attrs);
}

/** ids named by <label htmlFor="..."> (or for="...") anywhere in the file. */
function labelledIds(tags) {
  const ids = new Set();
  for (const tag of tags) {
    if (tag.name !== 'label') continue;
    const target = attrValue(tag.attrs, 'htmlFor') ?? attrValue(tag.attrs, 'for');
    if (target) ids.add(target);
  }
  return ids;
}

/** [start, end) offsets of every <label>...</label> element. */
function wrappingLabelRanges(content, tags) {
  const ranges = [];
  for (const tag of tags) {
    if (tag.name !== 'label' || /\/\s*$/.test(tag.attrs)) continue;
    const close = content.indexOf('</label>', tag.end);
    if (close !== -1) ranges.push([tag.end, close]);
  }
  return ranges;
}

/**
 * True when the element is not exposed to assistive technology, so it needs
 * no accessible name: the `hidden` attribute, aria-hidden="true", a class
 * token that is exactly "hidden" (display: none; a responsive variant like
 * "md:hidden" or a visually-hidden class like "sr-only" does not count), or
 * an inline display: none.
 */
function removedFromAccessibilityTree(attrs) {
  if (/(?:^|\s)hidden(?=\s|\/|$|=\s*\{\s*true\s*\})/.test(attrs)) return true;
  if (/(?:^|\s)aria-hidden\s*=\s*(?:"true"|'true'|\{\s*true\s*\})/.test(attrs)) return true;
  const classes = attrs.match(/(?:^|\s)class(?:Name)?\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\})/);
  if (classes && /(?:^|[\s"'`])hidden(?=[\s"'`]|$)/.test(classes[1])) return true;
  return /display\s*:\s*["']?none\b/.test(attrs);
}

/**
 * An <input> has an accessible name when it is hidden or removed from the
 * accessibility tree, has aria-label /
 * aria-labelledby (aria-describedby kept for compatibility), is the target of
 * a label's htmlFor, or sits inside a <label>. Spread props ({...props}) may
 * carry the label, so they are not reported.
 */
function inputIsLabelled(tag, labelled, labelRanges) {
  const { attrs } = tag;
  if ((attrValue(attrs, 'type') || '').toLowerCase() === 'hidden') return true;
  if (removedFromAccessibilityTree(attrs)) return true;
  if (/(?:^|\s)aria-(?:label|labelledby|describedby)\s*=/.test(attrs)) return true;
  if (/\{\s*\.\.\./.test(attrs)) return true;
  const id = attrValue(attrs, 'id');
  if (id && labelled.has(id)) return true;
  return labelRanges.some(([from, to]) => tag.start >= from && tag.start < to);
}

const check = async function checkA11y(targetDir) {
  const dir = targetDir || process.cwd();

  // The snapshot being verified: the index, or HEAD when nothing is staged.
  const { mode, files } = changedFiles(dir, { extensions: ['.tsx', '.jsx'] });
  if (mode === null) {
    return { exitCode: 0, skipped: true, name: 'check_a11y', data: { violations: {}, message: 'No git diff available' } };
  }

  if (!files || files.length === 0) {
    return { exitCode: 0, skipped: false, name: 'check_a11y', data: { violations: {}, message: 'No frontend files changed' } };
  }

  const violations = {};

  for (const file of files) {
    const content = readFile(dir, file, mode);
    if (content === null) continue;

    const fileViolations = [];
    const tags = openingTags(content);
    const labelled = labelledIds(tags);
    const labelRanges = wrappingLabelRanges(content, tags);

    for (const tag of tags) {
      const { name, attrs, line } = tag;
      const after = content.slice(tag.end);

      // <img> without alt
      if (name === 'img' && !hasAttr(attrs, 'alt')) {
        fileViolations.push({ lineNo: line, rule: 'img-alt', message: 'Image missing alt attribute' });
      }

      // <input> without an accessible name
      if (name === 'input' && !inputIsLabelled(tag, labelled, labelRanges)) {
        fileViolations.push({ lineNo: line, rule: 'input-label', message: 'Input missing aria-label or aria-labelledby' });
      }

      // Icon-only <button> without aria-label
      if (name === 'button' && !hasAttr(attrs, 'aria-label') &&
          /^\s*(?:<[A-Z]|<span\b[^>]*className\s*=\s*['"][^'"]*(?:icon|Icon))/.test(after)) {
        fileViolations.push({ lineNo: line, rule: 'icon-button', message: 'Icon-only button missing aria-label' });
      }

      // role="button" without a keyboard handler
      if (/\brole\s*=\s*(?:"button"|'button'|\{\s*["']button["']\s*\})/i.test(attrs) &&
          !/\bon(?:KeyDown|KeyUp|KeyPress)\s*=/i.test(attrs)) {
        fileViolations.push({ lineNo: line, rule: 'role-button-keyboard', message: 'role="button" without keyboard handler' });
      }

      // <a> whose first child is a component, without aria-label
      if (name === 'a' && !hasAttr(attrs, 'aria-label') && /^\s*<[A-Z]/.test(after)) {
        fileViolations.push({ lineNo: line, rule: 'link-accessible', message: 'Link with component child may need aria-label' });
      }
    }

    if (fileViolations.length > 0) {
      violations[file] = fileViolations;
    }
  }

  const totalCount = Object.values(violations).flat().length;
  return {
    exitCode: totalCount > 0 ? 1 : 0,
    skipped: false,
    name: 'check_a11y',
    data: {
      violations,
      message: totalCount > 0
        ? `${totalCount} a11y issue(s) found in ${Object.keys(violations).length} file(s)`
        : 'All a11y checks passed',
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
