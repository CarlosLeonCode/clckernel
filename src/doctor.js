/**
 * CLC Kernel — Health Doctor & Functional Validator
 * Scans a target repository to verify safeguards, AGENTS.md, docs structure,
 * git hooks, tool functionality, and audit orchestrator alignment.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** Parses the file given as argv[1]; the path never touches a shell. */
const PY_PARSE_SCRIPT = 'import ast, sys\nast.parse(open(sys.argv[1]).read())';
const { colors } = require('./ui');

/**
 * How Node loads tools/*.js: the nearest
 * package.json from tools/ upwards decides, and the JS guards are CommonJS.
 * "type": "module" there makes every guard crash on require, so the check
 * fails with the fix that applies.
 * @param {string} targetDir - Project root
 * @param {string} toolsDir - targetDir/tools
 * @returns {{ name: string, status: boolean, detail?: string }|null} null when tools/ holds no JS file
 */
function moduleTypeCheck(targetDir, toolsDir) {
  if (!fs.existsSync(toolsDir) || !fs.readdirSync(toolsDir).some(f => f.endsWith('.js'))) return null;
  const name = 'tools/ JS runs as CommonJS';
  for (let dir = toolsDir; ; dir = path.dirname(dir)) {
    const pkgFile = path.join(dir, 'package.json');
    if (fs.existsSync(pkgFile)) {
      let type;
      try {
        type = JSON.parse(fs.readFileSync(pkgFile, 'utf-8')).type;
      } catch {
        type = undefined; // Malformed: the load checks below report it.
      }
      if (type !== 'module') return { name, status: true };
      const detail = dir === toolsDir
        ? 'tools/package.json sets "type": "module": set it to "type": "commonjs"'
        : `${path.relative(targetDir, pkgFile).split(path.sep).join('/')} sets "type": "module" and tools/ has no ` +
          'package.json of its own: run `npx clckernel update .` to add tools/package.json ({ "type": "commonjs" })';
      return { name, status: false, detail };
    }
    if (path.dirname(dir) === dir) return { name, status: true };
  }
}

/**
 * Runs every health check against targetDir and prints the results.
 * @param {string} targetDir - Project to inspect
 * @returns {number} Number of failed checks (0 means healthy)
 */
function runDoctor(targetDir) {
  console.log(`\n${colors.bold}${colors.cyan}CLC KERNEL DOCTOR — HEALTH CHECK${colors.reset}\n`);
  console.log(`  Target Repository: ${colors.cyan}${targetDir}${colors.reset}\n`);

  const checks = [];

  // === Structural checks ===
  const hasAgentsMd = fs.existsSync(path.join(targetDir, 'AGENTS.md'));
  checks.push({ name: 'AGENTS.md law document', status: hasAgentsMd });

  const hasSdds = fs.existsSync(path.join(targetDir, 'sdds'));
  checks.push({ name: 'sdds/ local spec directory', status: hasSdds });

  const hasJournal = fs.existsSync(path.join(targetDir, 'docs', 'Journal'));
  checks.push({ name: 'docs/Journal/ ADR directory', status: hasJournal });

  const toolsDir = path.join(targetDir, 'tools');
  const hasTools = fs.existsSync(toolsDir) && fs.readdirSync(toolsDir).length > 0;
  checks.push({ name: 'tools/ safeguard suite', status: hasTools });

  const hasHusky = fs.existsSync(path.join(targetDir, '.husky', 'pre-commit'));
  const hasGithooks = fs.existsSync(path.join(targetDir, '.githooks', 'pre-commit'));
  checks.push({ name: 'pre-commit git hooks', status: hasHusky || hasGithooks });

  const moduleType = moduleTypeCheck(targetDir, toolsDir);
  if (moduleType) checks.push(moduleType);

  // === Tool functionality validation ===
  if (fs.existsSync(toolsDir)) {
    const toolFiles = fs.readdirSync(toolsDir);

    toolFiles.forEach(file => {
      const toolPath = path.join(toolsDir, file);

      // Load-test JS guard scripts via require()
      if (file.endsWith('.js') && file.startsWith('check_')) {
        try {
          require(toolPath);
          checks.push({ name: `tool/${file} loads`, status: true });
        } catch (e) {
          checks.push({ name: `tool/${file} loads`, status: false, detail: e.message });
        }
      }

      // Parse-test Python guard scripts via ast.parse()
      if (file.endsWith('.py') && file.startsWith('check_')) {
        const res = spawnSync('python3', ['-c', PY_PARSE_SCRIPT, toolPath], { encoding: 'utf-8' });
        if (!res.error && res.status === 0) {
          checks.push({ name: `tool/${file} parses`, status: true });
        } else {
          const detail = res.error
            ? res.error.message
            : (res.stderr || '').trim().split('\n').pop() || `python3 exited ${res.status}`;
          checks.push({ name: `tool/${file} parses`, status: false, detail });
        }
      }
    });
  }

  // === Audit orchestrator import alignment ===
  if (fs.existsSync(toolsDir)) {
    // Check JS audit orchestrator imports
    const auditJs = path.join(toolsDir, 'audit.js');
    if (fs.existsSync(auditJs)) {
      const content = fs.readFileSync(auditJs, 'utf-8');
      const imports = content.match(/require\(['"]\.\/(\w+)['"]\)/g) || [];
      imports.forEach(imp => {
        const moduleName = imp.match(/\.\/(\w+)/)[1];
        const candidates = [`${moduleName}.js`, `${moduleName}.py`];
        const exists = candidates.some(c => fs.existsSync(path.join(toolsDir, c)));
        checks.push({
          name: `audit.js import ./${moduleName}`,
          status: exists,
          detail: exists ? undefined : 'Module not found in tools/',
        });
      });
    }

    // Check Python audit orchestrator imports
    const auditPy = path.join(toolsDir, 'audit.py');
    if (fs.existsSync(auditPy)) {
      const content = fs.readFileSync(auditPy, 'utf-8');
      const imports = content.match(/from tools\.(\w+)/g) || [];
      imports.forEach(imp => {
        const moduleName = imp.match(/from tools\.(\w+)/)[1];
        const candidates = [`${moduleName}.py`, `${moduleName}.js`];
        const exists = candidates.some(c => fs.existsSync(path.join(toolsDir, c)));
        checks.push({
          name: `audit.py import tools.${moduleName}`,
          status: exists,
          detail: exists ? undefined : 'Module not found in tools/',
        });
      });
    }
  }

  // === Results ===
  let passedCount = 0;
  checks.forEach(({ name, status, detail }) => {
    if (status) {
      passedCount++;
      console.log(`  ${colors.emerald}✔ [PASS]${colors.reset} ${name}`);
    } else {
      const detailMsg = detail ? ` — ${detail}` : '';
      console.log(`  ${colors.red}✖ [FAIL]${colors.reset} ${name}${colors.gray}${detailMsg}${colors.reset}`);
    }
  });

  console.log('\n---------------------------------------------------------------');
  if (passedCount === checks.length) {
    console.log(` ${colors.bgEmerald} HEALTHY ${colors.reset} ${colors.emerald}${colors.bold}All ${checks.length} doctor checks passed.${colors.reset}\n`);
  } else {
    console.log(` ${colors.amber}  ${checks.length - passedCount} issue(s) detected. Run \`npx clckernel\` to repair.${colors.reset}\n`);
  }
  return checks.length - passedCount;
}

module.exports = { runDoctor };
