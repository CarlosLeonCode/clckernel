/**
 * CLC Kernel — Shared Guard Utilities
 * Common file-reading and result-formatting helpers for technology guards.
 */

const fs = require('fs');
const path = require('path');

/**
 * Read file content if it exists, otherwise return null.
 * @param {string} filePath
 * @returns {string | null}
 */
function readFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`[_shared] Could not read ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Check if a pattern matches in file content (case-insensitive).
 * @param {string} pattern - Substring to search for
 * @param {string | null} content - File content or null
 * @returns {boolean}
 */
function matchInFile(pattern, content) {
  if (content === null) {
    return false;
  }
  return content.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Format a standard guard result.
 * @param {string} name - Guard name
 * @param {Array<object>} violations - List of violation findings
 * @param {boolean} skipped - Whether guard was skipped
 * @param {string} [message] - Optional human-readable summary
 * @returns {object} Standard guard result
 */
function formatResult(name, violations, skipped, message) {
  const hasViolations = violations.length > 0;
  const exitCode = hasViolations ? 1 : 0;

  return {
    exit_code: exitCode,
    skipped: skipped,
    name: name,
    data: {
      findings: violations,
      message: message || (skipped
        ? 'Guard skipped'
        : hasViolations
          ? `${violations.length} violation(s) found`
          : 'No violations found'),
    },
  };
}

module.exports = { readFileIfExists, matchInFile, formatResult };
