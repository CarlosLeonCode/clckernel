/**
 * CLC Harness — Main Orchestrator Controller
 * Coordinates auto-discovery, UI rendering, generator engine, and doctor checks.
 */

const path = require('path');
const { autoDetectStack } = require('./detector');
const { printBanner, printBox, promptOptions, printSuccess, colors } = require('./ui');
const { generateHarness } = require('./generator');
const { runDoctor } = require('./doctor');

async function runCli() {
  const args = process.argv.slice(2);
  const command = args[0];

  let targetDir = process.cwd();
  if (command && !command.startsWith('-') && command !== 'doctor' && command !== 'update') {
    targetDir = path.resolve(command);
  }

  if (command === 'doctor' || args.includes('--doctor')) {
    if (args[1] && args[1] !== '--doctor') targetDir = path.resolve(args[1]);
    runDoctor(targetDir);
    return;
  }

  if (command === 'update' || args.includes('--update')) {
    if (args[1] && args[1] !== '--update') targetDir = path.resolve(args[1]);
    const { runUpdate } = require('./updater');
    await runUpdate(targetDir);
    return;
  }

  // 1. Print Pro ASCII Banner
  printBanner();

  // 2. Auto-Detect Stack
  const detected = autoDetectStack(targetDir);

  // 3. Render Formatted Configuration Box
  printBox('🔍 CONFIGURACIÓN DETECTADA AUTOMÁTICAMENTE', [
    { label: '📦 Tipo de Proyecto', value: detected.projectType.toUpperCase(), badgeColor: colors.amber },
    { label: '🚀 Framework', value: detected.framework, badgeColor: colors.emerald },
    { label: '🎨 Estilos & UI', value: `${detected.styling} (${detected.uiLibrary})`, badgeColor: colors.violet },
    { label: '🧪 Test Runner', value: detected.testRunner, badgeColor: colors.cyan },
    { label: '🔒 Git Hooks', value: detected.gitHooks, badgeColor: colors.blue }
  ]);

  // 4. Prompt User for Confirmation or Override
  const finalConfig = await promptOptions(detected);

  // 5. Generate Harness & Safeguards
  let s;
  if (Boolean(process.stdin.isTTY) && !process.env.CI) {
    const p = require('@clack/prompts');
    s = p.spinner();
    s.start('Configurando salvaguardas y motor de gobernanza...');
  }

  generateHarness(targetDir, finalConfig);

  if (s) {
    s.stop('Salvaguardas y motor de gobernanza configurados.');
  }

  // 6. Render Pro Success Card
  printSuccess(targetDir, finalConfig.projectType === 'frontend', finalConfig);
}

module.exports = { runCli };
