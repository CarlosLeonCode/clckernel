/**
 * CLC Kernel — Pro Terminal UI & ANSI Renderer
 * Brand Identity: The AI Agent Governance & Quality Engineering Engine
 */

const p = require('@clack/prompts');
const { adapters, buildStackConfig } = require('./detector');
const { version: PACKAGE_VERSION } = require('../package.json');

// ANSI Color Palette
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  emerald: '\x1b[32m',
  violet: '\x1b[35m',
  amber: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bgCyan: '\x1b[46m\x1b[30m',
  bgViolet: '\x1b[45m\x1b[30m',
  bgEmerald: '\x1b[42m\x1b[30m'
};

function printBanner() {
  console.clear();
  console.log(`${colors.cyan}
   ██████╗██╗      ██████╗     ██╗  ██╗███████╗██████╗ ███╗   ██╗███████╗██╗     
  ██╔════╝██║     ██╔════╝     ██║ ██╔╝██╔════╝██╔══██╗████╗  ██║██╔════╝██║     
  ██║     ██║     ██║    █████╗█████═╝ █████╗  ██████╔╝██╔██╗ ██║█████╗  ██║     
  ██║     ██║     ██║    ╚════╝██╔═██╗ ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ██║     
  ╚██████╗███████╗╚██████╗     ██║ ╚██╗███████╗██║  ██║██║ ╚████║███████╗███████╗
   ╚═════╝╚══════╝ ╚═════╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
${colors.reset}`);
  console.log(`  ${colors.bgCyan} CLC KERNEL ${colors.reset} ${colors.bold}The AI Agent Governance & Quality Engineering Engine${colors.reset} ${colors.gray}v${PACKAGE_VERSION}${colors.reset}\n`);
}

function printBox(title, items) {
  const width = 68;
  console.log(`${colors.dim}┌${'─'.repeat(width)}┐${colors.reset}`);
  console.log(`${colors.dim}│${colors.reset}  ${colors.bold}${colors.cyan}${title.padEnd(width - 4)}${colors.reset}  ${colors.dim}│${colors.reset}`);
  console.log(`${colors.dim}├${'─'.repeat(width)}┤${colors.reset}`);

  items.forEach(({ label, value, badgeColor = colors.emerald }) => {
    const line = ` ${colors.gray}${label.padEnd(22)}:${colors.reset} ${badgeColor}${colors.bold}${value}${colors.reset}`;
    const plainLength = `${label} : ${value}`.length;
    const padding = Math.max(0, width - plainLength - 3);
    console.log(`${colors.dim}│${colors.reset} ${line}${' '.repeat(padding)}${colors.dim}│${colors.reset}`);
  });

  console.log(`${colors.dim}└${'─'.repeat(width)}┘${colors.reset}\n`);
}

/** Second-level select value for the stack-agnostic harness. */
const GENERIC_STACK = 'generic';

/**
 * Lets the user confirm the detected stack, pick another one, or cancel.
 * Picking another stack returns the config the detector builds for that
 * adapter, so the chosen adapter drives provisioning, AGENTS.md and the hook.
 * @param {object} detected - Config from autoDetectStack
 * @param {object} [options]
 * @param {string} [options.targetDir] - Project root (cwd when absent)
 * @param {object} [options.prompts] - Prompts implementation (@clack/prompts)
 * @param {boolean} [options.interactive] - Defaults to TTY, no CI, no --yes/-y
 * @returns {Promise<object>} Final config
 */
async function promptOptions(detected, options = {}) {
  const {
    targetDir = process.cwd(),
    prompts = p,
    interactive = Boolean(process.stdin.isTTY) &&
      !process.env.CI &&
      !process.argv.includes('--yes') &&
      !process.argv.includes('-y')
  } = options;

  if (!interactive) {
    return detected;
  }

  prompts.intro(`${colors.cyan}${colors.bold}CLC Kernel Setup${colors.reset}`);

  const choice = await prompts.select({
    message: '¿Cómo deseas inicializar CLC Kernel en este proyecto?',
    initialValue: 'confirm',
    options: [
      {
        value: 'confirm',
        label: 'Confirmar e Instalar CLC Kernel',
        hint: `Recomendado (${detected.projectType.toUpperCase()} - ${detected.framework})`
      },
      {
        value: 'other',
        label: 'Elegir otro stack',
        hint: 'Instalar las salvaguardas de otro framework'
      },
      {
        value: 'cancel',
        label: 'Cancelar',
        hint: 'Salir sin realizar cambios'
      }
    ]
  });

  if (prompts.isCancel(choice) || choice === 'cancel') {
    prompts.cancel('Instalación de CLC Kernel cancelada.');
    process.exit(0);
  }

  if (choice !== 'other') {
    return detected;
  }

  const stack = await prompts.select({
    message: '¿Qué stack deseas instalar?',
    initialValue: detected.adapter ? detected.adapter.name : GENERIC_STACK,
    options: [
      ...adapters.map((adapter) => ({
        value: adapter.name,
        label: adapter.name,
        hint: `${adapter.projectType.toUpperCase()} - ${adapter.testRunner}`
      })),
      {
        value: GENERIC_STACK,
        label: 'Genérico',
        hint: 'Salvaguardas agnósticas de stack'
      }
    ]
  });

  if (prompts.isCancel(stack)) {
    prompts.cancel('Instalación de CLC Kernel cancelada.');
    process.exit(0);
  }

  const adapter = adapters.find((a) => a.name === stack) || null;
  return buildStackConfig(targetDir, adapter);
}

/**
 * One line per part of a multi-part config: `dir: framework (test runner)`.
 * Empty for a single-stack config, whose summary stays as it was.
 * @param {object} config - Project config
 * @returns {string[]}
 */
function partLines(config) {
  if (!config || !Array.isArray(config.parts)) return [];
  return config.parts.map((part) => `${part.dir}: ${part.framework} (${part.testRunner})`);
}

/**
 * Prints the installation summary.
 * @param {string} targetDir - Provisioned project root
 * @param {{ file: string, active: boolean }} [hook] - Hook written (relative path)
 *   and whether git runs it
 * @param {object} config - Final project config
 * @param {string[]} [installedGuards] - Guards actually copied into tools/
 */
function printSuccess(targetDir, hook, config, installedGuards = []) {
  const hookDesc = !hook
    ? `${colors.amber}no hook written${colors.reset}`
    : hook.active
      ? `active hook ${colors.amber}${hook.file}${colors.reset}`
      : `${colors.amber}${hook.file} written but not active (core.hooksPath unchanged)${colors.reset}`;
  const guardsDesc = installedGuards.length > 0
    ? `${colors.emerald}${installedGuards.length} guard(s): ${installedGuards.join(', ')}${colors.reset}`
    : `${colors.amber}no guards installed${colors.reset}`;

  const summary = [
    `🔨 ${colors.bold}Proyecto Inicializado:${colors.reset} ${colors.cyan}${targetDir}${colors.reset}`,
    `🛡️  ${colors.bold}Salvaguardas:${colors.reset} ${guardsDesc}`,
    `📝 ${colors.bold}Leyes & SDD:${colors.reset} AGENTS.md, sdds/, docs/Journal/ precargados`,
    `🔒 ${colors.bold}Git Hooks:${colors.reset} ${hookDesc}`,
    ...(partLines(config).length > 0 ? [`🧩 ${colors.bold}Partes:${colors.reset}`] : []),
    ...partLines(config).map((line) => `   • ${line}`)
  ].join('\n');

  if (p.note && p.outro) {
    p.note(summary, '🚀 Resumen de Instalación');
    p.outro(`${colors.emerald}${colors.bold}¡CLC Kernel instalado exitosamente!${colors.reset}`);
  } else {
    console.log(`\n${colors.bgEmerald} SUCCESS ${colors.reset} ${colors.bold}${colors.emerald}¡CLC Kernel instalado exitosamente!${colors.reset}\n`);
    console.log(summary + '\n');
  }
}

/**
 * Lines of the install/update summary (sdds/safe-update, decision 4): written,
 * unchanged, protected (with the .clckernel-new path), moved, removed, added
 * to .gitignore and git config; then what was left out on purpose: guards
 * available but not installed, mirrors not present, tracked paths not
 * ignored. A dry run prints the same sections as a plan.
 * @param {object} plan - io.plan()
 * @param {{ dryRun?: boolean }} [options]
 * @returns {string[]}
 */
function planLines(plan, { dryRun = false } = {}) {
  const label = (real, planned) => (dryRun ? planned : real);
  const lines = [];
  const section = (title, items, color = colors.emerald) => {
    if (items.length === 0) return;
    lines.push(`${colors.bold}${title} (${items.length}):${colors.reset}`);
    for (const item of items) lines.push(`   ${color}•${colors.reset} ${item}`);
  };
  section(label('Written', 'Would write'), plan.written);
  if (plan.unchanged.length > 0) {
    lines.push(`${colors.bold}${label('Unchanged', 'Unchanged')} (${plan.unchanged.length}):${colors.reset} already up to date`);
  }
  section(label('Protected (local changes kept)', 'Would protect (local changes kept)'),
    plan.protected.map((p) => `${p.path} (${p.reason}) -> new version in ${p.newPath}`), colors.amber);
  section(label('Moved', 'Would move'), plan.moved.map((m) => `${m.from} -> ${m.to}`));
  section(label('Removed', 'Would remove'), plan.removed);
  section(label('Added to .gitignore', 'Would add to .gitignore'), plan.gitignore);
  section(label('git config', 'Would set git config'), plan.gitConfig.map((c) => `${c.key} = ${c.value}`));
  // sdds/update-no-additions, decision 5: what was left out on purpose.
  section('Available, not installed (add with --add-guards <name,...|all>)', plan.available || [], colors.cyan);
  section('Mirrors not present (skipped)', plan.mirrorsSkipped || [], colors.cyan);
  section('Tracked, not ignored (git tracks them; no .gitignore entry added)', plan.trackedNotIgnored || [], colors.cyan);
  // sdds/config-foundation: update.exclude in .clckernel.yaml.
  section('Excluded by config (update.exclude; left as they are)', plan.excluded || [], colors.cyan);
  if (plan.protected.length > 0) {
    lines.push('');
    lines.push(`${colors.amber}⚠ ${plan.protected.length} file(s) ${dryRun ? 'would be' : 'were'} protected: the kernel cannot prove they are its own and intact.${colors.reset}`);
    lines.push(`${colors.amber}  Review each *.clckernel-new copy, merge what you want, then delete it (it is gitignored).${colors.reset}`);
  }
  if (dryRun) {
    lines.push('');
    lines.push(`${colors.cyan}Dry run: nothing was written (no files, .gitignore or git config).${colors.reset}`);
  }
  return lines;
}

/**
 * AI harnesses by the AGENTS.md mirror they read (sdds/onboarding). Agents
 * that read AGENTS.md itself (Codex, OpenCode, ...) need no mirror.
 */
const HARNESS_MIRRORS = [
  { name: 'Claude Code (CLAUDE.md)', match: (p) => p === 'CLAUDE.md' },
  { name: 'Gemini (GEMINI.md)', match: (p) => p === 'GEMINI.md' },
  { name: 'Cursor', match: (p) => p === '.cursorrules' || p.startsWith('.cursor/') },
  { name: 'Copilot', match: (p) => p === '.github/copilot-instructions.md' },
  { name: 'Antigravity', match: (p) => p.startsWith('.antigravity/') },
  { name: 'Windsurf', match: (p) => p === '.windsurfrules' },
];

/**
 * Harness names whose mirror the run wrote or found up to date.
 * @param {object} plan - io.plan()
 * @returns {string[]}
 */
function harnessNames(plan) {
  const paths = [...(plan.written || []), ...(plan.unchanged || [])].map((entry) => entry.split(' -> ')[0]);
  return HARNESS_MIRRORS.filter((h) => paths.some(h.match)).map((h) => h.name);
}

/**
 * "Next steps" after a real install (sdds/onboarding), true to what was
 * installed: the hook file and whether git runs it (or the command that
 * activates it), the harness mirrors written and the parts. English, like
 * the plan listing.
 * @param {{ file: string, active: boolean, activate?: string|null }|undefined} hook
 * @param {object} plan - io.plan()
 * @param {object} [config] - Final project config
 * @returns {string[]}
 */
function nextStepsLines(hook, plan, config = {}) {
  const c = colors;
  const cmd = (text) => `${c.cyan}${text}${c.reset}`;
  const lines = [`${c.bold}Next steps${c.reset}`];
  const commit = cmd('git add -A && git commit -m "chore: install clckernel"');
  const parts = Array.isArray(config.parts) && config.parts.length > 0
    ? `     The hook runs the checks of every part (${config.parts.map((p) => p.dir).join(', ')}) from the repository root.`
    : null;
  if (hook && hook.active) {
    lines.push(`  1. Review and commit the harness: ${commit}`);
    lines.push(`     The pre-commit hook (${hook.file}) runs on this commit.`);
  } else if (hook) {
    lines.push(`  1. The pre-commit hook (${hook.file}) is not active yet. Activate it: ${cmd(hook.activate || 'git config core.hooksPath .githooks')}`);
    lines.push(`     Then review and commit the harness: ${commit}`);
  } else {
    lines.push(`  1. Review and commit the harness: ${commit} (no pre-commit hook was written)`);
  }
  if (hook && parts) lines.push(parts);
  const harnesses = harnessNames(plan || {});
  const agents = harnesses.length > 0
    ? `AGENTS.md mirrors written for: ${harnesses.join(', ')}.`
    : 'No AGENTS.md mirrors written: use an agent that reads AGENTS.md itself.';
  lines.push(`  2. Open your AI agent and ask it to run ${cmd('clckernel start')} to tailor the rules (.clckernel.yaml),`);
  lines.push('     or just start working: it follows AGENTS.md.');
  lines.push(`     ${agents}`);
  lines.push(`  3. Run ${cmd('npx clckernel audit')} anytime to see every guard's result.`);
  lines.push('  4. Project-specific checks go in tools/guards/ (the hook and the audit run them).');
  lines.push(`  5. Later, preview kernel updates with ${cmd('npx clckernel update --dry-run')}.`);
  return lines;
}

/**
 * Shorter "Next steps" after an update: only what needs attention
 * (protected files to merge, guards available but not installed); empty
 * when nothing does.
 * @param {object} plan - io.plan()
 * @returns {string[]}
 */
function updateNextStepsLines(plan) {
  const c = colors;
  const steps = [];
  for (const entry of plan.protected || []) {
    steps.push(`Review ${entry.newPath}, merge what you want into ${entry.path}, then delete the copy.`);
  }
  if ((plan.available || []).length > 0) {
    steps.push(`Optional guards: ${c.cyan}npx clckernel update --add-guards ${plan.available.join(',')}${c.reset}`);
  }
  if (steps.length === 0) return [];
  return [`${c.bold}Next steps${c.reset}`, ...steps.map((step, i) => `  ${i + 1}. ${step}`)];
}

/** Prints planLines. */
function printPlan(plan, options) {
  console.log(planLines(plan, options).join('\n'));
}

module.exports = {
  planLines,
  nextStepsLines,
  updateNextStepsLines,
  harnessNames,
  printPlan,
  colors,
  printBanner,
  printBox,
  promptOptions,
  printSuccess,
  partLines
};
