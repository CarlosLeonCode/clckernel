/**
 * CLC Forge — Zero-Dependency YAML Parser
 * Self-contained inline YAML parser extracted from tools/check_custom.js.
 * Uses only Node.js built-ins (no npm deps).
 *
 * Supports: scalars, block sequences, block mappings, inline flow
 * sequences/mappings, comments. No anchors/aliases, no multiple documents.
 *
 * Stack entries: { obj, indent, _parentObj, _parentKey }
 *   obj: the object we are building key-value pairs into
 *   indent: indent level (children at same indent stay)
 *   _parentObj/_parentKey: where to find/create the array for sequences
 *
 * @module yaml
 */

/**
 * Detect YAML anchors (`&name`) or aliases (`*name`) on a line.
 * @param {string} line - Trimmed content of a YAML line.
 * @param {number} lineNo - 1-based line number for error reporting.
 * @throws {Error} If anchor or alias syntax is found (unsupported).
 */
function assertNoAnchorAlias(line, lineNo) {
  // YAML anchors/aliases are token-boundary markers: `&name` / `*name`
  // preceded by whitespace or start of line. Requiring the boundary avoids
  // false positives on regex/glob content such as `pattern: 'a*b'`.
  if (/(?:^|\s)[&*][A-Za-z0-9_-]/.test(line)) {
    throw new Error(
      `Unsupported YAML syntax at line ${lineNo}: anchors/aliases are not supported`
    );
  }
}

/**
 * Parse a YAML string into a JavaScript object.
 * Throws on anchors/aliases (unsupported).
 * @param {string} text - Raw YAML source.
 * @returns {object} Parsed object tree.
 */
function parseYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1, _parentObj: null, _parentKey: null }];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\s*#.*$/, '').trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // New behavior: anchors/aliases are unsupported
    assertNoAnchorAlias(trimmed, i + 1);

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const entry = stack[stack.length - 1];

    // ── Sequence item: "- rest" ──
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2).trim();

      if (rest.includes(': ')) {
        // "- key: value" — mapping inside a sequence
        let arr = null;
        // Check if parent key already points to an array
        if (entry._parentObj && entry._parentKey) {
          const pk = entry._parentObj[entry._parentKey];
          if (Array.isArray(pk)) {
            arr = pk;
          } else if (pk && typeof pk === 'object' && Object.keys(pk).length === 0) {
            // Convert empty object to array
            entry._parentObj[entry._parentKey] = [];
            arr = entry._parentObj[entry._parentKey];
          }
        }
        if (arr) {
          const obj = {};
          const colonIdx = rest.indexOf(': ');
          obj[rest.slice(0, colonIdx).trim()] = parseScalar(rest.slice(colonIdx + 2).trim());
          arr.push(obj);
          stack.push({ obj, indent, _parentObj: arr, _parentKey: null });
        }
      } else if (entry._parentObj && entry._parentKey) {
        // "- scalar" inside a sequence
        const pk = entry._parentObj[entry._parentKey];
        if (Array.isArray(pk)) {
          pk.push(parseScalar(rest));
        } else if (pk && typeof pk === 'object' && Object.keys(pk).length === 0) {
          // Convert empty object to array (same rule as the mapping-in-sequence
          // branch above) so plain block sequences like
          //   active_guards:
          //     - check_custom
          // parse into arrays, not empty objects. Additive: previously valid
          // YAML parses identically.
          entry._parentObj[entry._parentKey] = [parseScalar(rest)];
        }
      }
      continue;
    }

    // ── key: value pair ──
    const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim();

      if (val === '' || val === '|' || val === '>') {
        // Empty value → children follow
        if (!entry.obj[key]) entry.obj[key] = {};
        stack.push({ obj: entry.obj[key], indent, _parentObj: entry.obj, _parentKey: key });
      } else if (val.startsWith('[') && val.endsWith(']')) {
        entry.obj[key] = val.slice(1, -1).split(',').map(s => parseScalar(s.trim()));
      } else if (val.startsWith('{') && val.endsWith('}')) {
        entry.obj[key] = parseFlowMapping(val);
      } else {
        entry.obj[key] = parseScalar(val);
      }
      continue;
    }
  }

  return root;
}

function parseScalar(val) {
  if (val === '' || val === '~' || val === 'null') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  // Strip quotes and unescape common escape sequences
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return val;
}

function parseFlowMapping(str) {
  const inner = str.slice(1, -1).trim();
  if (!inner) return {};
  const obj = {};
  const pairs = inner.split(',');
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;
    const k = pair.slice(0, colonIdx).trim();
    const v = pair.slice(colonIdx + 1).trim();
    obj[k] = parseScalar(v);
  }
  return obj;
}

// ═══════════════════════════════════════════════════════════════════════
// Glob-to-Regex Converter (~15 lines)
// Handles: **, *, {a,b} alternation
// ═══════════════════════════════════════════════════════════════════════

function globToRegex(glob) {
  let re = glob
    .replace(/\./g, '\\.')           // escape dots
    .replace(/\*\*\//g, '{{GLOBSTAR_SLASH}}') // protect **/ (zero or more segments + separator)
    .replace(/\*\*/g, '{{GLOBSTAR}}') // protect trailing **
    .replace(/\*/g, '[^/]*')          // single * = no slashes
    .replace(/\{\{GLOBSTAR_SLASH\}\}/g, '(?:.+/)?') // **/ = optional path segments
    .replace(/\{\{GLOBSTAR\}\}/g, '.*') // ** = anything
    .replace(/\{([^}]+)\}/g, (_, alt) =>
      `(${alt.split(',').join('|')})`);  // {a,b} alternation
  return new RegExp('^' + re + '$');
}

module.exports = { parseYaml, globToRegex };
