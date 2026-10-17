#!/usr/bin/env node
/**
 * Skill Frontmatter Guard
 * Every SKILL.md changed in the snapshot must open with a YAML frontmatter
 * block holding a non-empty `name` (lowercase letters and digits joined by
 * hyphens or underscores) and a non-empty `description` of at most 1024
 * characters. The `name` must be unique among all the skills of the
 * repository (read from the same snapshot). A name that differs from the
 * skill's folder is reported as a warning only.
 * Skills the harness installs (clckernel_cli, files in the registry) are ignored.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Repository root (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const path = require('path');
const { changedFiles, readFile, listFiles } = require('./_changes');

const NAME = 'check_skills';
const SKILL_FILE = 'SKILL.md';
const MANAGED_REGISTRY = 'tools/.clckernel-managed.json';
const HARNESS_SKILLS = new Set(['clckernel_cli', 'clc_forge_cli']);
const NAME_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const MAX_DESCRIPTION = 1024;

/** True for a SKILL.md path that does not belong to a skill the harness installs. */
function isUserSkill(file) {
  if (path.posix.basename(file) !== SKILL_FILE) return false;
  return !file.split('/').some(segment => HARNESS_SKILLS.has(segment));
}

/** Removes matching surrounding quotes of a YAML scalar. */
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parses the top-level scalar keys of a frontmatter block: `key: value`,
 * quoted values, block scalars (`|`, `>`, with chomping indicators) and plain
 * values continued on indented lines.
 * @param {string} text - Content of the SKILL.md
 * @returns {Record<string, string>|null} null when there is no frontmatter block
 */
function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return null;

  const fields = {};
  const body = lines.slice(1, end);
  for (let i = 0; i < body.length; i++) {
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(body[i]);
    if (!match) continue;
    const [, key, rest] = match;
    const continuation = [];
    while (i + 1 < body.length && (/^\s+\S/.test(body[i + 1]) || body[i + 1].trim() === '')) {
      continuation.push(body[++i]);
    }
    const head = rest.trim();
    if (/^[|>][+-]?$/.test(head)) {
      const joiner = head[0] === '|' ? '\n' : ' ';
      fields[key] = continuation.map(l => l.trim()).filter(Boolean).join(joiner);
    } else {
      fields[key] = [unquote(head), ...continuation.map(l => l.trim())].filter(Boolean).join(' ');
    }
  }
  return fields;
}

const check = async function checkSkills(targetDir) {
  const dir = targetDir || process.cwd();
  const { mode, files } = changedFiles(dir);
  const changed = files.filter(isUserSkill);

  if (changed.length === 0) {
    return {
      exitCode: 0, skipped: true, name: NAME,
      data: { violations: [], warnings: [], message: 'No changed SKILL.md files' },
    };
  }

  // Every skill of the snapshot, for the uniqueness check (registry entries excluded).
  const registry = new Set();
  try {
    const listed = JSON.parse(readFile(dir, MANAGED_REGISTRY, mode) || '[]');
    if (Array.isArray(listed)) listed.forEach(f => registry.add(f));
  } catch {
    // Malformed registry: exclude nothing.
  }
  const names = new Map();
  for (const file of listFiles(dir, mode).filter(f => isUserSkill(f) && !registry.has(f))) {
    const fields = parseFrontmatter(readFile(dir, file, mode) || '');
    const name = fields && fields.name;
    if (!name) continue;
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(file);
  }

  const violations = [];
  const warnings = [];
  for (const file of changed) {
    const fail = message => violations.push({ file, message });
    const fields = parseFrontmatter(readFile(dir, file, mode) || '');
    if (!fields) {
      fail('Missing YAML frontmatter (a leading --- block with name and description)');
      continue;
    }

    const name = fields.name || '';
    const description = fields.description || '';
    if (!name) {
      fail('Frontmatter `name` is missing or empty');
    } else if (!NAME_RE.test(name)) {
      fail(`Frontmatter name "${name}" must be lowercase letters/digits joined by hyphens or underscores`);
    }
    if (!description) {
      fail('Frontmatter `description` is missing or empty');
    } else if (description.length > MAX_DESCRIPTION) {
      fail(`Frontmatter description is ${description.length} characters (max ${MAX_DESCRIPTION})`);
    }

    if (name) {
      const others = (names.get(name) || []).filter(f => f !== file);
      if (others.length > 0) fail(`Duplicate skill name "${name}": already used by ${others.join(', ')}`);
      const folder = path.posix.basename(path.posix.dirname(file));
      if (folder !== '.' && folder !== name) {
        warnings.push({ file, message: `Skill name "${name}" differs from its folder "${folder}"` });
      }
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    skipped: false,
    name: NAME,
    data: {
      violations,
      warnings,
      message: violations.length > 0
        ? `${violations.length} SKILL.md frontmatter problem(s) found`
        : `${changed.length} changed SKILL.md file(s) have valid frontmatter`,
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
