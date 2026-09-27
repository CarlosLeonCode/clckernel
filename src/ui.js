/**
 * CLC Kernel — Pro Terminal UI & ANSI Renderer
 * Brand Identity: The AI Agent Governance & Quality Engineering Engine
 */

const p = require('@clack/prompts');

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
  console.log(`  ${colors.bgCyan} CLC KERNEL ${colors.reset} ${colors.bold}The AI Agent Governance & Quality Engineering Engine${colors.reset} ${colors.gray}v1.2.6${colors.reset}\n`);
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

async function promptOptions(detected) {
  const isInteractive = Boolean(process.stdin.isTTY) &&
    !process.env.CI &&
    !process.argv.includes('--yes') &&
    !process.argv.includes('-y');

  if (!isInteractive) {
    return detected;
  }

  p.intro(`${colors.cyan}${colors.bold}CLC Kernel Setup${colors.reset}`);

  const choice = await p.select({
    message: '¿Cómo deseas inicializar CLC Kernel en este proyecto?',
    initialValue: 'confirm',
    options: [
      {
        value: 'confirm',
        label: 'Confirmar e Instalar CLC Kernel',
        hint: `Recomendado (${detected.projectType.toUpperCase()} - ${detected.framework})`
      },
      {
        value: 'frontend',
        label: 'Forzar modo FRONTEND',
        hint: 'Salvaguardas A11y, Zod, Next/Image, UI Reuse'
      },
      {
        value: 'backend',
        label: 'Forzar modo BACKEND',
        hint: 'Salvaguardas TDD, Clean Arch, N+1, Secrets'
      },
      {
        value: 'cancel',
        label: 'Cancelar',
        hint: 'Salir sin realizar cambios'
      }
    ]
  });

  if (p.isCancel(choice) || choice === 'cancel') {
    p.cancel('Instalación de CLC Kernel cancelada.');
    process.exit(0);
  }

  if (choice === 'frontend') {
    detected.projectType = 'frontend';
  } else if (choice === 'backend') {
    detected.projectType = 'backend';
  }

  return detected;
}

function printSuccess(targetDir, isFront, config) {
  const summary = [
    `🔨 ${colors.bold}Proyecto Inicializado:${colors.reset} ${colors.cyan}${targetDir}${colors.reset}`,
    `🛡️  ${colors.bold}Salvaguardas:${colors.reset} ${isFront ? `${colors.emerald}10 Guardias Frontend (A11y, Zod, Image, UI Reuse, Storybook)` : `${colors.violet}7 Guardias Backend (TDD, Architecture, Scope, Secret Scan)`}${colors.reset}`,
    `📝 ${colors.bold}Leyes & SDD:${colors.reset} AGENTS.md, sdds/, docs/Journal/ precargados`,
    `🔒 ${colors.bold}Git Hooks:${colors.reset} Configurados en ${colors.amber}${config.gitHooks === 'husky' ? '.husky/pre-commit' : '.githooks/pre-commit'}${colors.reset}`
  ].join('\n');

  if (p.note && p.outro) {
    p.note(summary, '🚀 Resumen de Instalación');
    p.outro(`${colors.emerald}${colors.bold}¡CLC Kernel instalado exitosamente!${colors.reset}`);
  } else {
    console.log(`\n${colors.bgEmerald} SUCCESS ${colors.reset} ${colors.bold}${colors.emerald}¡CLC Kernel instalado exitosamente!${colors.reset}\n`);
    console.log(summary + '\n');
  }
}

module.exports = {
  colors,
  printBanner,
  printBox,
  promptOptions,
  printSuccess
};
