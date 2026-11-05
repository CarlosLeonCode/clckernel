/**
 * CLC Kernel — File-level lint pragmas for kernel-owned files.
 *
 * The JS and Python files the kernel installs into a project (tools/*.js,
 * tools/*.py) are kernel-owned: `clckernel update` replaces them, and a local
 * edit makes update protect them (src/io.js). The project's linters must
 * therefore skip them instead of failing the project's hooks on code the
 * project cannot change. The kernel never edits the project's linter config
 * (it is arbitrary code, e.g. eslint.config.mjs); each file declares itself
 * instead, with the file-level pragmas the common linters honour:
 *
 *   JS      ESLint and oxlint (eslint-disable), Biome 2 (biome-ignore-all),
 *           TypeScript checkJs (@ts-nocheck)
 *   Python  ruff and flake8 (noqa), pylint (skip-file), mypy (ignore-errors),
 *           isort (skip_file), black and ruff format (fmt: off)
 *
 * `writeManaged` applies the header to every kernel-owned file it writes, so
 * install and update write the same bytes and the registry hash is the sha256
 * of what is on disk. Project files (tools/guards/, other files in tools/,
 * .clckernel.yaml, AGENTS.md) are never written through it.
 */

const path = require('path');

const NOTICE = 'CLC Kernel managed file: `clckernel update` replaces it, so do not edit or lint it in this project.';

const HEADERS = {
  js: [
    `/* eslint-disable -- ${NOTICE} */`,
    '// biome-ignore-all lint: CLC Kernel managed file, replaced by `clckernel update`',
    '// @ts-nocheck',
  ],
  py: [
    `# ${NOTICE}`,
    '# ruff: noqa',
    '# flake8: noqa',
    '# pylint: skip-file',
    '# mypy: ignore-errors',
    '# isort: skip_file',
    '# fmt: off',
  ],
};

const LANGUAGE_BY_EXTENSION = { '.js': 'js', '.cjs': 'js', '.mjs': 'js', '.py': 'py' };

/**
 * The header lines for a kernel-owned file, or null when its language has none.
 * @param {string} relPath - Path of the file in the project
 * @returns {string[]|null}
 */
function managedHeader(relPath) {
  const language = LANGUAGE_BY_EXTENSION[path.extname(relPath).toLowerCase()];
  return language ? [...HEADERS[language]] : null;
}

/**
 * The bytes with the header inserted at the top (after a shebang line, which
 * must stay first). Unchanged when the file's language has no header or the
 * file already starts with it.
 * @param {string} relPath - Path of the file in the project
 * @param {Buffer} bytes - The file content
 * @returns {Buffer}
 */
function withManagedHeader(relPath, bytes) {
  const header = managedHeader(relPath);
  if (!header) return bytes;
  const text = bytes.toString('utf-8');
  const shebangEnd = text.startsWith('#!') ? text.indexOf('\n') + 1 : 0;
  if (text.startsWith('#!') && shebangEnd === 0) return Buffer.from(`${text}\n${header.join('\n')}\n`, 'utf-8');
  const block = `${header.join('\n')}\n`;
  if (text.startsWith(block, shebangEnd)) return bytes;
  return Buffer.from(text.slice(0, shebangEnd) + block + text.slice(shebangEnd), 'utf-8');
}

module.exports = { managedHeader, withManagedHeader };
