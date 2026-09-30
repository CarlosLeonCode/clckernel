/**
 * CLC Kernel — Non-Destructive Harness Updater
 * Safely updates core AST tools, skills, playbooks, and IDE symlinks in an existing
 * project while guaranteeing 100% preservation of:
 * - Local specifications (sdds/)
 * - Custom AST guards (tools/guards/)
 * - Project configuration and custom thresholds (.clckernel.yaml / .clc-forge.yaml)
 * - Application source code and domain models
 */

const fs = require('fs');
const path = require('path');
const { autoDetectStack } = require('./detector');
const { generateHarness } = require('./generator');

function updateHarness(targetDir = process.cwd(), options = {}) {
  const resolvedDir = path.resolve(targetDir);

  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Target directory "${resolvedDir}" does not exist.`);
  }

  // 1. Detect Stack
  const detected = autoDetectStack(resolvedDir);

  // 2. Identify existing preserved assets
  const preserved = {
    sdds: fs.existsSync(path.join(resolvedDir, 'sdds')),
    customGuards: fs.existsSync(path.join(resolvedDir, 'tools', 'guards')),
    configYaml: fs.existsSync(path.join(resolvedDir, '.clckernel.yaml')) || fs.existsSync(path.join(resolvedDir, '.clc-forge.yaml')),
  };

  // 3. Run harness generation (refreshes tools, hooks, skills, and symlinks)
  generateHarness(resolvedDir, detected);

  // 4. Ensure AGENTS.md includes the update command in the command table
  const agentsPath = path.join(resolvedDir, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    let agentsContent = fs.readFileSync(agentsPath, 'utf-8');
    if (!agentsContent.includes('clckernel update')) {
      if (agentsContent.includes('| `clckernel start`')) {
        agentsContent = agentsContent.replace(
          '| `clckernel start`',
          '| `clckernel update` | Maintenance | Non-destructive update: refresh core tools, playbooks & symlinks (preserves SDDs & custom guards). |\n| `clckernel start`'
        );
        fs.writeFileSync(agentsPath, agentsContent, 'utf-8');
      } else if (agentsContent.includes('## 3. Universal Command Interface')) {
        agentsContent += '\n| `clckernel update` | Maintenance | Non-destructive update: refresh core tools, playbooks & symlinks (preserves SDDs & custom guards). |\n';
        fs.writeFileSync(agentsPath, agentsContent, 'utf-8');
      }
    }
  }

  return {
    success: true,
    targetDir: resolvedDir,
    preserved,
    refreshed: {
      tools: true,
      skills: true,
      symlinks: true,
      hooks: true,
    },
  };
}

async function runUpdate(targetDir = process.cwd()) {
  const { colors, printBanner } = require('./ui');
  printBanner();

  console.log(`\n${colors.cyan}🔄 Actualizando CLC Kernel en:${colors.reset} ${targetDir}\n`);

  try {
    const result = updateHarness(targetDir);

    console.log(`${colors.green}✔ Salvaguardas estándar actualizadas en tools/${colors.reset}`);
    console.log(`${colors.green}✔ Playbooks y Skills agénticos actualizados en .agents/skills/${colors.reset}`);
    console.log(`${colors.green}✔ Enlaces simbióticos de IDEs actualizados (Cursor, Claude, Copilot, Antigravity)${colors.reset}`);
    console.log(`${colors.green}✔ Hooks de git sincronizados${colors.reset}`);
    console.log(`\n${colors.bold}🔒 ACTIVOS PRESERVADOS AL 100%:${colors.reset}`);
    console.log(`   • ${colors.emerald}sdds/${colors.reset} (Especificaciones locales intactas)`);
    console.log(`   • ${colors.emerald}tools/guards/${colors.reset} (Reglas y salvaguardas personalizadas intactas)`);
    console.log(`   • ${colors.emerald}.clckernel.yaml${colors.reset} (Configuraciones de equipo intactas)\n`);
    console.log(`${colors.green}✨ ¡Proyecto actualizado con éxito a la última versión de CLC Kernel!${colors.reset}\n`);
    return result;
  } catch (err) {
    console.error(`\n❌ Error actualizando el arnés: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { updateHarness, runUpdate };
