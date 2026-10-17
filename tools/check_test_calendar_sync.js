#!/usr/bin/env node
/**
 * Test Calendar Parity Guard (read-only)
 * Checks that the test calendar harness (tests/) matches the calendar engine
 * (templates/content-calendar/). Drift fails the check and lists the
 * out-of-sync files; it never writes to the repository.
 *
 * To sync, run it standalone with the explicit opt-in flag:
 *   node tools/check_test_calendar_sync.js --fix
 * The pre-commit hook and the audit never pass `fix`.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @param {{ fix?: boolean }} [options] - `fix: true` copies templates into tests/
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const FIX_COMMAND = 'node tools/check_test_calendar_sync.js --fix';

const check = async function checkTestCalendarSync(targetDir, { fix = false } = {}) {
  const fs = require('fs');
  const path = require('path');

  const dir = targetDir || process.cwd();
  const templateDir = path.join(dir, 'templates', 'content-calendar');
  const testDir = path.join(dir, 'tests');

  if (!fs.existsSync(templateDir) || !fs.existsSync(testDir)) {
    return {
      exitCode: 0,
      skipped: true,
      name: 'check_test_calendar_sync',
      data: { violations: [], message: 'No templates/content-calendar or tests/ directory found' }
    };
  }

  const syncPairs = [
    { src: path.join(templateDir, 'index.html'), dest: path.join(testDir, 'index.html'), label: 'index.html' },
    { src: path.join(templateDir, 'data.js'), dest: path.join(testDir, 'data.js'), label: 'data.js' },
    { src: path.join(templateDir, 'data.js'), dest: path.join(testDir, 'mock-data.js'), label: 'mock-data.js' }
  ];

  const syncedFiles = [];
  const violations = [];

  for (const pair of syncPairs) {
    if (!fs.existsSync(pair.src)) continue;

    const inSync = fs.existsSync(pair.dest) && fs.readFileSync(pair.src).equals(fs.readFileSync(pair.dest));
    if (inSync) continue;

    if (!fix) {
      violations.push({ file: pair.label, message: `tests/${pair.label} is out of sync with templates/content-calendar` });
      continue;
    }
    try {
      fs.copyFileSync(pair.src, pair.dest);
      syncedFiles.push(pair.label);
    } catch (err) {
      violations.push({ file: pair.label, message: `Failed to synchronize ${pair.label}: ${err.message}` });
    }
  }

  // mock-content.json must carry channelProfiles when data.js does
  const dataJsPath = path.join(templateDir, 'data.js');
  const mockContentPath = path.join(testDir, 'mock-content.json');
  if (fs.existsSync(dataJsPath) && fs.existsSync(mockContentPath)) {
    try {
      const dataJsContent = fs.readFileSync(dataJsPath, 'utf-8');
      const mockJson = fs.readFileSync(mockContentPath, 'utf-8');
      if (dataJsContent.includes('"channelProfiles"') && !mockJson.includes('"channelProfiles"')) {
        if (!fix) {
          violations.push({ file: 'mock-content.json', message: 'tests/mock-content.json is missing channelProfiles present in data.js' });
        } else {
          // Hydrate channelProfiles from data.js
          const match = dataJsContent.match(/"channelProfiles":\s*\{[\s\S]*?\n\s{4}\}/);
          if (match) {
            const hydrated = mockJson.replace(/"pillarMix":\s*\{[\s\S]*?\n\s{4}\}/, (m) => `${m},\n    ${match[0]}`);
            fs.writeFileSync(mockContentPath, hydrated, 'utf-8');
            syncedFiles.push('mock-content.json');
          }
        }
      }
    } catch (e) {
      // non-fatal
    }
  }

  const exitCode = violations.length > 0 ? 1 : 0;
  let message;
  if (violations.length > 0) {
    message = fix
      ? `Failed to sync ${violations.length} test calendar file(s)`
      : `${violations.length} test calendar file(s) out of sync: ${violations.map(v => v.file).join(', ')}. Run \`${FIX_COMMAND}\` to sync.`;
  } else if (syncedFiles.length > 0) {
    message = `Synchronized ${syncedFiles.length} test calendar file(s): ${syncedFiles.join(', ')}`;
  } else {
    message = 'Test calendar is 100% in sync with templates/content-calendar';
  }

  return {
    exitCode,
    skipped: false,
    name: 'check_test_calendar_sync',
    data: {
      violations,
      syncedFiles,
      message
    }
  };
};

module.exports = check;

if (require.main === module) {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const targetDir = args.find(a => !a.startsWith('--'));
  check(targetDir, { fix }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
