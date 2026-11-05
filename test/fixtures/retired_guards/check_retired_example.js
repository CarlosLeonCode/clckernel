#!/usr/bin/env node
/**
 * Synthetic fixture: a guard an older kernel release shipped in tools/ and
 * the current one no longer does. Tests install it as if it were published
 * (registry entry or an injected known hash) to exercise how `clckernel
 * update` retires kernel guards. It follows the guard JSON contract and
 * always passes. Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {Promise<{ exitCode: number, skipped: boolean, name: string, data: object }>}
 */
const check = async function checkRetiredExample(targetDir) {
  const fs = require('fs');
  const dir = targetDir || process.cwd();
  return {
    exitCode: 0,
    skipped: false,
    name: 'check_retired_example',
    data: { violations: [], message: `Retired example guard ran in ${fs.existsSync(dir) ? 'the project' : 'a missing directory'}` },
  };
};

module.exports = check;

if (require.main === module) {
  check(process.argv[2]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
