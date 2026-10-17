#!/usr/bin/env node
/**
 * Data File Guard
 * Every .json file changed in the snapshot must parse as JSON, whatever folder
 * it lives in. A failure names the file and the parse error (reason and
 * line/column); the file content is never printed.
 * Only JSON: YAML data files may use full YAML, which the strict subset parser
 * of the harness (tools/yaml.js) cannot validate without false positives.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Repository root (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const { changedFiles, readFile } = require('./_changes');

const NAME = 'check_data_files';
const MAX_REASON = 120;

/** Line and column (1-based) of a character offset. */
function lineColumn(text, offset) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

/**
 * Parse error without the file content: newer V8 messages quote the input
 * (`..., "<content>" is not valid JSON`), so that part is dropped and the
 * position, when reported, becomes a line and column.
 */
function describeError(err, text) {
  let reason = String(err && err.message ? err.message : err)
    .replace(/,\s*"[\s\S]*" is not valid JSON$/, '')
    .replace(/\s*\(line \d+ column \d+\)$/, '');
  const position = /\s*(?:in JSON\s*)?at position (\d+)/.exec(reason);
  let where = '';
  if (position) {
    reason = reason.slice(0, position.index);
    const { line, column } = lineColumn(text, Number(position[1]));
    where = ` at line ${line}, column ${column}`;
  }
  reason = reason.trim().slice(0, MAX_REASON) || 'Invalid JSON';
  return `Invalid JSON${where}: ${reason}`;
}

const check = async function checkDataFiles(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir, { extensions: ['.json'] });

  if (files.length === 0) {
    return {
      exitCode: 0, skipped: true, name: NAME,
      data: { violations: [], message: 'No changed .json files' },
    };
  }

  const violations = [];
  for (const file of files) {
    const text = readFile(dir, file, mode);
    if (text === null) continue;
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    try {
      JSON.parse(body);
    } catch (err) {
      violations.push({ file, message: describeError(err, body) });
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    skipped: false,
    name: NAME,
    data: {
      violations,
      message: violations.length > 0
        ? `${violations.length} JSON file(s) do not parse: ${violations.map(v => v.file).join(', ')}`
        : `${files.length} changed JSON file(s) parse`,
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
