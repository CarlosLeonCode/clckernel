/**
 * CLC Harness — Main Orchestrator Controller
 * Coordinates auto-discovery, UI rendering, generator engine, and doctor checks.
 */

const path = require('path');
const { autoDetectStack } = require('./detector');
const { printBanner, printBox, promptOptions, printSuccess, colors } = require('./ui');
const { generateHarness } = require('./generator');
const { runDoctor } = require('./doctor');

/** Commands that only read state. Safe to run against any project. */
const READ_ONLY_COMMANDS = new Set(['help', '--help', '-h', 'version', '--version', '-v']);

/**
 * Flags that explicitly opt into the installation path. Everything else is
 * rejected: a destructive default is fixed by making the default non-destructive.
 */
const INSTALL_FLAGS = new Set(['--yes', '-y']);

const HELP_TEXT = `
${'clckernel'} — CLC Kernel: The AI Agent Governance Engine

USAGE
  clckernel <command> [targetDir]

READ-ONLY COMMANDS (never modify your project)
  help, --help, -h        Show this help
  version, --version, -v  Print the installed version
  doctor [targetDir]      Run diagnostics on a project
  update [targetDir]      Refresh tools, playbooks and IDE symlinks

INSTALLATION (writes to the target project)
  clckernel [targetDir] --yes   Provision the governance harness

  Requires an explicit opt-in. Bare \`clckernel\` runs the interactive
  confirmation flow; with no TTY it refuses to install.

EXAMPLES
  clckernel --help
  clckernel doctor .
  clckernel update .
  clckernel . --yes
`;

/**
 * Reject any input that is not a recognized command or install flag.
 * The rejected tokens are echoed so the user can see what was not understood.
 * @param {string[]} args - Raw argv (without node/script)
 * @returns {number} Process exit code
 */
function rejectUnknownInput(args) {
  const rejected = args.join(' ');
  process.stderr.write(
    `\n❌ Unknown input: ${rejected}\n` +
      '   clckernel will not modify your project on unrecognized input.\n' +
      '   Run `clckernel --help` to see available commands.\n\n'
  );
  return 1;
}

async function runCli() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command && READ_ONLY_COMMANDS.has(command)) {
    if (command === 'version' || command === '--version' || command === '-v') {
      const { version } = require('../package.json');
      process.stdout.write(`clckernel v${version}\n`);
    } else {
      process.stdout.write(HELP_TEXT);
    }
    return;
  }

  if (args.some((a) => READ_ONLY_COMMANDS.has(a))) {
    process.exitCode = rejectUnknownInput(args);
    return;
  }

  if (command === 'doctor' || args.includes('--doctor')) {
    const target = args[1] && args[1] !== '--doctor' ? args[1] : (args[0] === 'doctor' ? null : args[0]);
    runDoctor(target ? path.resolve(target) : process.cwd());
    return;
  }

  if (command === 'update' || args.includes('--update')) {
    const target = args[1] && args[1] !== '--update' ? args[1] : (args[0] === 'update' ? null : args[0]);
    const { runUpdate } = require('./updater');
    await runUpdate(target ? path.resolve(target) : process.cwd());
    return;
  }

  // Everything below is destructive. Only reachable through an explicit command
  // or an explicit install flag.
  const flags = args.filter((a) => a.startsWith('-'));
  const positionals = args.filter((a) => !a.startsWith('-'));
  const unknownFlags = flags.filter((f) => !INSTALL_FLAGS.has(f));

  if (unknownFlags.length > 0 || positionals.length > 1) {
    process.exitCode = rejectUnknownInput(args);
    return;
  }

  const targetDir = positionals.length === 1 ? path.resolve(positionals[0]) : process.cwd();
  const explicitInstall = INSTALL_FLAGS.has(command) || flags.length > 0;
  const isInteractive = Boolean(process.stdin.isTTY) && !process.env.CI;

  if (!explicitInstall && !isInteractive) {
    process.stderr.write(
      '\n❌ Refusing to install without an explicit opt-in.\n' +
        '   No TTY detected, so there is no confirmation prompt.\n' +
        '   Re-run with `clckernel --yes` to provision, or `clckernel --help`.\n\n'
    );
    process.exitCode = 1;
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
