#!/usr/bin/env node
/**
 * Domain Data Integrity & Clean State Guard
 * Validates domain deliverables (content.json, calendar.json, voc.json)
 * to ensure valid JSON structure and clean creation state (no fake hallucinated metrics on pending posts).
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkDomainData(targetDir) {
  const fs = require('fs');
  const path = require('path');

  const dir = targetDir || process.cwd();
  const searchDirs = [
    dir,
    path.join(dir, 'output'),
    path.join(dir, 'content-calendar'),
    path.join(dir, 'data')
  ];

  const jsonFiles = [];
  for (const sDir of searchDirs) {
    if (fs.existsSync(sDir)) {
      try {
        const files = fs.readdirSync(sDir);
        for (const file of files) {
          if (file.endsWith('.json') && !file.includes('package') && !file.includes('tsconfig')) {
            jsonFiles.push(path.join(sDir, file));
          }
        }
      } catch {}
    }
  }

  if (jsonFiles.length === 0) {
    return {
      exitCode: 0,
      skipped: true,
      name: 'check_domain_data',
      data: { violations: [], message: 'No domain data JSON files to validate' }
    };
  }

  const violations = [];
  for (const file of jsonFiles) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(raw);

      // Clean Creation State Check: If array of posts/calendar entries
      const entries = Array.isArray(data) ? data : (data.posts || data.items || data.calendar || []);
      if (Array.isArray(entries)) {
        for (let i = 0; i < entries.length; i++) {
          const item = entries[i];
          if (item && (item.status === 'pending' || item.status === 'draft')) {
            // Check if metrics are falsely pre-filled with non-null numbers
            if (item.metrics && typeof item.metrics === 'object') {
              const fakeMetrics = Object.entries(item.metrics).filter(([_, val]) => typeof val === 'number' && val > 0);
              if (fakeMetrics.length > 0) {
                violations.push({
                  file: path.relative(dir, file),
                  message: `Entry #${i + 1} (${item.title || item.id || 'draft'}) has pre-filled fake metrics on pending/draft post`
                });
              }
            }
          }
        }
      }
    } catch (err) {
      violations.push({
        file: path.relative(dir, file),
        message: `JSON syntax or structural error: ${err.message}`
      });
    }
  }

  const exitCode = violations.length > 0 ? 1 : 0;
  return {
    exitCode,
    skipped: false,
    name: 'check_domain_data',
    data: {
      violations,
      message: violations.length > 0
        ? `${violations.length} domain data integrity violation(s) found`
        : 'All domain deliverables & state data verified'
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
