#!/usr/bin/env node
/**
 * Human-in-the-Loop (HITL) Checkpoint Guard
 * Ensures subagent playbooks and workflows in skills/ or .agents/skills/
 * define mandatory user review or approval checkpoints before final output.
 * Self-contained: uses only Node.js built-ins.
 *
 * @param {string} targetDir - Directory to scan (defaults to cwd)
 * @returns {{ exitCode: number, skipped: boolean, name: string, data: object }}
 */
const check = async function checkHitl(targetDir) {
  const fs = require('fs');
  const path = require('path');

  const dir = targetDir || process.cwd();
  const searchDirs = [
    path.join(dir, 'skills'),
    path.join(dir, '.agents', 'skills')
  ];

  const skillFiles = [];
  for (const sDir of searchDirs) {
    if (fs.existsSync(sDir)) {
      try {
        const files = fs.readdirSync(sDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            skillFiles.push(path.join(sDir, file));
          }
        }
      } catch {}
    }
  }

  if (skillFiles.length === 0) {
    return {
      exitCode: 0,
      skipped: true,
      name: 'check_hitl',
      data: { violations: [], message: 'No skills/ or subagent playbook files found' }
    };
  }

  const hitlKeywords = [
    /human[- ]in[- ]the[- ]loop/i,
    /hitl/i,
    /checkpoint/i,
    /approval/i,
    /confirm/i,
    /review/i,
    /pausa/i,
    /aprobaci[oó]n/i,
    /esperar/i,
    /validaci[oó]n/i
  ];

  const violations = [];
  for (const file of skillFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const hasHitl = hitlKeywords.some(kw => kw.test(content));

      if (!hasHitl) {
        violations.push({
          file: path.relative(dir, file),
          message: 'Skill/Playbook missing mandatory Human-in-the-Loop (HITL) review checkpoint'
        });
      }
    } catch {}
  }

  const exitCode = violations.length > 0 ? 1 : 0;
  return {
    exitCode,
    skipped: false,
    name: 'check_hitl',
    data: {
      violations,
      message: violations.length > 0
        ? `${violations.length} skill(s) missing mandatory Human-in-the-Loop checkpoints`
        : 'All subagent skills include mandatory Human-in-the-Loop (HITL) checkpoints'
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
