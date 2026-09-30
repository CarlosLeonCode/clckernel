#!/usr/bin/env node
/**
 * Test Calendar Parity & Auto-Sync Guard
 * Ensures that any modification made to the calendar engine (templates/content-calendar/)
 * is immediately synchronized to the test calendar harness (tests/).
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkTestCalendarSync(targetDir) {
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

    let needsSync = false;
    if (!fs.existsSync(pair.dest)) {
      needsSync = true;
    } else {
      const srcBuf = fs.readFileSync(pair.src);
      const destBuf = fs.readFileSync(pair.dest);
      if (!srcBuf.equals(destBuf)) {
        needsSync = true;
      }
    }

    if (needsSync) {
      try {
        fs.copyFileSync(pair.src, pair.dest);
        syncedFiles.push(pair.label);
      } catch (err) {
        violations.push({
          file: pair.label,
          message: `Failed to synchronize ${pair.label}: ${err.message}`
        });
      }
    }
  }

  // Also verify mock-content.json has channelProfiles if data.js has it
  const dataJsPath = path.join(templateDir, 'data.js');
  const mockContentPath = path.join(testDir, 'mock-content.json');
  if (fs.existsSync(dataJsPath) && fs.existsSync(mockContentPath)) {
    try {
      const dataJsContent = fs.readFileSync(dataJsPath, 'utf-8');
      if (dataJsContent.includes('"channelProfiles"') && !fs.readFileSync(mockContentPath, 'utf-8').includes('"channelProfiles"')) {
        // Hydrate channelProfiles from data.js
        const match = dataJsContent.match(/"channelProfiles":\s*\{[\s\S]*?\n\s{4}\}/);
        if (match) {
          let mockJson = fs.readFileSync(mockContentPath, 'utf-8');
          mockJson = mockJson.replace(/"pillarMix":\s*\{[\s\S]*?\n\s{4}\}/, (m) => `${m},\n    ${match[0]}`);
          fs.writeFileSync(mockContentPath, mockJson, 'utf-8');
          syncedFiles.push('mock-content.json');
        }
      }
    } catch (e) {
      // non-fatal
    }
  }

  const exitCode = violations.length > 0 ? 1 : 0;
  const message = violations.length > 0
    ? `Failed to sync ${violations.length} test calendar files`
    : (syncedFiles.length > 0
        ? `Auto-synchronized ${syncedFiles.length} test calendar file(s): ${syncedFiles.join(', ')}`
        : 'Test calendar is 100% in sync with templates/content-calendar');

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
  check(process.argv[2]).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  });
}
