/**
 * CLC Harness — Main Orchestrator Controller
 * Coordinates auto-discovery, UI rendering, generator engine, and doctor checks.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { autoDetectStack } = require('./detector');
const { printBanner, printBox, promptOptions, printSuccess, partLines, colors } = require('./ui');
const { generateHarness } = require('./generator');
const { runDoctor } = require('./doctor');

/** Commands that only read state. Safe to run against any project. */
const READ_ONLY_COMMANDS = new Set(['help', '--help', '-h', 'version', '--version', '-v']);

/**
 * Flags that explicitly opt into the installation path. Everything else is
 * rejected: a destructive default is fixed by making the default non-destructive.
 */
const INSTALL_FLAGS = new Set(['--yes', '-y']);

/** Prints the plan instead of writing (sdds/safe-update, decision 5). Not an opt-in by itself. */
const DRY_RUN_FLAG = '--dry-run';

/**
 * Words AGENTS.md documents as agent commands (`clckernel test`, ...). They are
 * executed by the AI agent, not by this CLI; without this list they would be
 * taken as an install target directory.
 */
const AGENT_COMMANDS = new Set(['test', 'start', 'feature', 'fix', 'commit', 'guard']);

const HELP_TEXT = `
${'clckernel'} — CLC Kernel: The AI Agent Governance Engine

USAGE
  clckernel <command> [targetDir]

READ-ONLY COMMANDS (do not modify your project's code or config)
  help, --help, -h        Show this help
  version, --version, -v  Print the installed version
  doctor [targetDir]      Run diagnostics on a project
  audit [targetDir]       Run the installed audit orchestrators (tools/audit.js
                          and/or tools/audit.py); they only write reports to sdds/
                          Checks staged changes, or the last commit if none

WRITES TO THE TARGET PROJECT
  update [targetDir]            Refresh tools, hooks, playbooks, IDE symlinks,
                                .gitignore and AGENTS.md. A kernel file you
                                edited is kept; the new version is written
                                next to it as <file>.clckernel-new
  clckernel [targetDir] --yes   Provision the governance harness
  --dry-run                     With update or --yes: print the plan, write nothing

  Installation requires an explicit opt-in and an existing target directory.
  Bare \`clckernel\` runs the interactive confirmation flow; with no TTY it
  refuses to install.

AGENT COMMANDS
  test, start, feature, fix, commit, guard are defined in AGENTS.md and are
  run by your AI agent, not by this CLI.

EXAMPLES
  clckernel --help
  clckernel doctor .
  clckernel audit .
  clckernel update .
  clckernel update . --dry-run
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

/**
 * Explains that an AGENTS.md agent command is not a CLI command.
 * @param {string} word - The reserved word the user typed
 * @returns {number} Process exit code
 */
function rejectAgentCommand(word) {
  process.stderr.write(
    `\n❌ \`${word}\` is an agent command defined in AGENTS.md, not a CLI command.\n` +
      '   Ask your AI agent to run it, or run `clckernel --help` to see CLI commands.\n\n'
  );
  return 1;
}

/**
 * Resolves a user-supplied directory and checks it exists and is a directory.
 * Prints the error itself so callers only decide the exit code.
 * @param {string|undefined} input - Raw path argument (cwd when absent)
 * @returns {string|null} Absolute path, or null when unusable
 */
function resolveExistingDir(input) {
  const dir = input ? path.resolve(input) : process.cwd();
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (e) {
    process.stderr.write(`\n❌ Target directory does not exist: ${dir}\n   Nothing was written.\n\n`);
    return null;
  }
  if (!stat.isDirectory()) {
    process.stderr.write(`\n❌ Target is not a directory: ${dir}\n   Nothing was written.\n\n`);
    return null;
  }
  return dir;
}

/**
 * `clckernel audit [dir]`: runs every orchestrator installed in dir/tools
 * (audit.js, then audit.py) with cwd = dir. A mixed stack has both, and each
 * only discovers guards of its own language, so all of them must run.
 * @param {string|undefined} input - Target directory argument
 * @returns {number} Exit code: the first non-zero orchestrator status, else 0
 */
function runAudit(input) {
  const dir = resolveExistingDir(input);
  if (!dir) return 1;

  const candidates = [
    { file: 'audit.js', cmd: process.execPath },
    { file: 'audit.py', cmd: 'python3' },
  ];
  const orchestrators = candidates.filter((c) => fs.existsSync(path.join(dir, 'tools', c.file)));
  if (orchestrators.length === 0) {
    process.stderr.write(
      `\n❌ No audit orchestrator found in ${path.join(dir, 'tools')} (audit.js or audit.py).\n` +
        `   Install the harness first: clckernel ${input || '.'} --yes\n\n`
    );
    return 1;
  }

  let exitCode = 0;
  for (const orchestrator of orchestrators) {
    const res = spawnSync(orchestrator.cmd, [path.join('tools', orchestrator.file)], {
      cwd: dir,
      stdio: 'inherit',
    });
    let status;
    if (res.error) {
      process.stderr.write(`\n❌ Could not run tools/${orchestrator.file}: ${res.error.message}\n\n`);
      status = 1;
    } else {
      status = res.status === null ? 1 : res.status;
    }
    if (status !== 0 && exitCode === 0) exitCode = status;
  }
  return exitCode;
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

  if (AGENT_COMMANDS.has(command)) {
    process.exitCode = rejectAgentCommand(command);
    return;
  }

  if (command === 'audit') {
    if (args.length > 2 || args.slice(1).some((a) => a.startsWith('-'))) {
      process.exitCode = rejectUnknownInput(args);
      return;
    }
    process.exitCode = runAudit(args[1]);
    return;
  }

  if (command === 'doctor' || args.includes('--doctor')) {
    const target = args[1] && args[1] !== '--doctor' ? args[1] : (args[0] === 'doctor' ? null : args[0]);
    const failures = runDoctor(target ? path.resolve(target) : process.cwd());
    if (failures > 0) process.exitCode = 1;
    return;
  }

  if (command === 'update' || args.includes('--update')) {
    const rest = [...args];
    rest.splice(rest.indexOf(command === 'update' ? 'update' : '--update'), 1);
    const updateFlags = rest.filter((a) => a.startsWith('-'));
    const updatePositionals = rest.filter((a) => !a.startsWith('-'));
    if (updateFlags.some((f) => f !== DRY_RUN_FLAG) || updatePositionals.length > 1) {
      process.exitCode = rejectUnknownInput(args);
      return;
    }
    const { runUpdate } = require('./updater');
    const target = updatePositionals[0];
    await runUpdate(target ? path.resolve(target) : process.cwd(), { dryRun: updateFlags.includes(DRY_RUN_FLAG) });
    return;
  }

  // Everything below is destructive. Only reachable through an explicit command
  // or an explicit install flag.
  const flags = args.filter((a) => a.startsWith('-'));
  const positionals = args.filter((a) => !a.startsWith('-'));
  const unknownFlags = flags.filter((f) => !INSTALL_FLAGS.has(f) && f !== DRY_RUN_FLAG);
  const dryRun = flags.includes(DRY_RUN_FLAG);

  if (unknownFlags.length > 0 || positionals.length > 1) {
    process.exitCode = rejectUnknownInput(args);
    return;
  }

  if (positionals.length === 1 && AGENT_COMMANDS.has(positionals[0])) {
    process.exitCode = rejectAgentCommand(positionals[0]);
    return;
  }

  // A mistyped path must never become a freshly created directory.
  const targetDir = resolveExistingDir(positionals[0]);
  if (!targetDir) {
    process.exitCode = 1;
    return;
  }
  const explicitInstall = flags.some((f) => INSTALL_FLAGS.has(f));
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
    { label: '📁 Target', value: targetDir, badgeColor: colors.cyan },
    { label: '📦 Tipo de Proyecto', value: detected.projectType.toUpperCase(), badgeColor: colors.amber },
    { label: '🚀 Framework', value: detected.framework, badgeColor: colors.emerald },
    { label: '🎨 Estilos & UI', value: `${detected.styling} (${detected.uiLibrary})`, badgeColor: colors.violet },
    { label: '🧪 Test Runner', value: detected.testRunner, badgeColor: colors.cyan },
    { label: '🔒 Git Hooks', value: detected.gitHooks, badgeColor: colors.blue },
    // Multi-part repos (sdds/fullstack-monorepo): one row per part.
    ...partLines(detected).map((line) => ({ label: '🧩 Parte', value: line, badgeColor: colors.emerald }))
  ]);

  // 4. Prompt User for Confirmation or Override
  const finalConfig = await promptOptions(detected, { targetDir });

  // 5. Generate Harness & Safeguards
  let s;
  if (Boolean(process.stdin.isTTY) && !process.env.CI) {
    const p = require('@clack/prompts');
    s = p.spinner();
    s.start('Configurando salvaguardas y motor de gobernanza...');
  }

  const { installedGuards, hook, plan } = generateHarness(targetDir, finalConfig, { dryRun }) || {};

  if (s) {
    s.stop(dryRun ? 'Plan listo (dry run).' : 'Salvaguardas y motor de gobernanza configurados.');
  }

  // 6. Render Pro Success Card (or, for a dry run, only the plan)
  const { printPlan } = require('./ui');
  if (dryRun) {
    if (plan) printPlan(plan, { dryRun: true });
    return;
  }
  printSuccess(targetDir, hook, finalConfig, installedGuards);
  if (plan) printPlan(plan);
}

module.exports = { runCli };
