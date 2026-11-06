/**
 * CLC Kernel — Kernel version comparison.
 *
 * Numeric on major.minor.patch: 2.10.0 is newer than 2.9.9. A prerelease
 * (-beta.1) or build (+sha) suffix is ignored, so 2.2.0-rc.1 equals 2.2.0.
 * Used by update to tell which catalog guards (their `since`) are newer than
 * the version recorded in the project's registry (`kernelVersion`).
 */

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * @param {string} value - A version such as '2.2.0'
 * @returns {number[]} [major, minor, patch]
 * @throws {Error} When value is not major.minor.patch
 */
function parseVersion(value) {
  const match = typeof value === 'string' ? VERSION_RE.exec(value) : null;
  if (!match) {
    throw new Error(`Invalid version ${JSON.stringify(value) || String(value)}: expected major.minor.patch (e.g. 2.2.0)`);
  }
  return match.slice(1, 4).map(Number);
}

/** True when value is a version compareVersions accepts. */
function isVersion(value) {
  try {
    parseVersion(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1} 1 when a is newer than b, -1 when older, 0 when equal
 * @throws {Error} When either is not major.minor.patch
 */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

/**
 * True when `since` (the version that brought something) is newer than
 * `installed` (the version the project last ran).
 * @param {string} since
 * @param {string} installed
 * @returns {boolean}
 */
function isNewer(since, installed) {
  return compareVersions(since, installed) > 0;
}

module.exports = { compareVersions, isNewer, isVersion };
