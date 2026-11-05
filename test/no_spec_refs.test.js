/**
 * Shipped files name no local spec. Specs under sdds/ are local and
 * gitignored, so a `sdds/<change-name>` reference in a file the CLI ships (or
 * copies into a consumer project) points nowhere for its readers, and can
 * leak the name of a project a change was written for. Runtime paths such as
 * `sdds/{change-name}/`, `sdds/<name>/` or `sdds/.gitkeep` are not spec names
 * and are allowed.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHIPPED = ['src', 'tools', path.join('.agents', 'skills', 'clckernel_cli')];
const SPEC_REF = /\bsdds\/[a-z0-9][a-z0-9-]*/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name !== 'known-hashes.json') out.push(full);
  }
  return out;
}

describe('shipped files reference no local spec', () => {
  for (const base of SHIPPED) {
    it(`${base}/ names no sdds/<change-name>`, () => {
      const hits = [];
      for (const file of walk(path.join(ROOT, base))) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          for (const match of line.matchAll(SPEC_REF)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${match[0]}`);
        });
      }
      assert.deepStrictEqual(hits, [], `spec references belong in the local sdds/ only:\n${hits.join('\n')}`);
    });
  }
});
