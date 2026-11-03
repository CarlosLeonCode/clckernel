export const languages = {
  en: 'English',
  es: 'Español',
};

export const defaultLang = 'en';

export const links = {
  github: 'https://github.com/CarlosLeonCode/clc_forge',
  npm: 'https://www.npmjs.com/package/clckernel',
  license: 'https://github.com/CarlosLeonCode/clc_forge/blob/main/LICENSE',
  issues: 'https://github.com/CarlosLeonCode/clc_forge/issues',
};

export const INSTALL_CMD = 'npx clckernel . --yes';

export const assistants = ['Claude Code', 'Cursor', 'Copilot', 'Gemini', 'Antigravity'];

export const ui = {
  en: {
    'skip': 'Skip to content',
    'nav.how': 'How it works',
    'nav.docs': 'Docs',
    'nav.github': 'GitHub',
    'nav.home': 'CLC Kernel home',
    'nav.lang': 'Language',
    'copy.idle': 'Copy',
    'copy.done': 'Copied',
    'copy.fail': 'Select and copy',
    'copy.label': 'Copy the install command',

    'meta.home.title': 'CLC Kernel: a safety check for the work your AI assistant does',
    'meta.home.desc': 'CLC Kernel gives every AI assistant the same rulebook and checks each change before it is saved: leaked keys, untested code, broken links, forgotten placeholders. Open source, MIT, runs locally.',
    'meta.how.title': 'How CLC Kernel works: rulebook, guards and the pre-commit hook',
    'meta.how.desc': 'The technical side of CLC Kernel: the AGENTS.md rulebook and its mirrors, the guards in tools/, the pre-commit hook, red-to-green TDD, supported stacks, quickstart and glossary.',

    'hero.line1': 'AI writes fast.',
    'hero.line2': 'Now its work gets checked.',
    'hero.sub': 'CLC Kernel is the safety check between your AI assistant and your project. It gives every assistant the same rulebook, and stops changes that break it before they are saved.',
    'hero.secondary': 'How it works',
    'hero.cmdNote': 'Run it in your project folder. Node 18 or newer.',
    'hero.fig': 'Fig. 01 · How a change travels',
    'hero.figAlt': 'Illustration of the whole path: an AGENTS.md rulebook linked to five assistants; their changes travel along a track through a test chamber and a gate; a risky change is stopped in amber with the tag "leaked key", one waits for your approval, and passed changes are saved in blue.',
    'hero.checked': 'Checked',
    'hero.stopped': 'Stopped',
    'hero.send': 'What you send',
    'hero.good': 'Good change',
    'hero.goodShort': 'Good',
    'hero.risky': 'Risky change',
    'hero.riskyShort': 'Risky',
    'hero.hint': 'Click or tap to send',
    'hero.stage': 'Send a change through the gate',
    'hero.passedMsg': 'Change passed',
    'hero.stoppedMsg': 'Change stopped',
    'hero.reasons': 'leaked key|no failing test|broken link|placeholder',
    'hero.approval': 'Needs approval',
    'hero.approvalShort': 'Approval',
    'hero.approved': 'Approved',
    'hero.approve': 'Approve',
    'hero.approveLabel': 'Approve the waiting change',
    'hero.approvedMsg': 'Change approved and saved',
    'hero.waitingMsg': 'Change waiting for your approval',
    'story.label': 'How CLC Kernel works, in four steps',
    'story.labels': 'AGENTS.md|Tests|Guards|Your approval|Saved',
    'story.1.cap': '01 / 04',
    'story.1.title': 'One rulebook',
    'story.1.text': 'One AGENTS.md rulebook, mirrored so every assistant reads the same rules.',
    'story.2.cap': '02 / 04',
    'story.2.title': 'Your AI works',
    'story.2.text': 'Your assistant writes code as usual. Each change it makes heads for the same checks.',
    'story.3.cap': '03 / 04',
    'story.3.title': 'Every change is checked',
    'story.3.text': 'Before a commit is saved, a test must fail without the change and pass with it, and the guards look for things like leaked keys, broken links and placeholders.',
    'story.4.cap': '04 / 04',
    'story.4.title': 'You approve what matters',
    'story.4.text': 'The rulebook tells your AI to stop and ask before the steps that need a person. You approve, and the change is saved to history.',
    'hero.sim': 'Illustration',

    'statement.a': 'Without checks, an AI assistant can leak a password, skip a test or leave a placeholder behind, and nobody notices until it is too late.',
    'statement.b': 'With CLC Kernel, every change meets the same rules',
    'statement.mark': 'before it is saved,',
    'statement.c': 'and you approve what matters.',

    'steps.title': 'How it helps',
    'steps.lede': 'Three things happen. You only do the first one.',
    'steps': [
      { title: 'Install once', body: 'One command adds a rulebook and a set of automatic checks to your project. Nothing to host, nothing to sign up for.' },
      { title: 'Your AI follows the rules', body: 'Claude Code, Cursor, Copilot, Gemini and Antigravity all read the same rulebook, so every assistant works the same way.' },
      { title: 'Every change is checked before it is saved', body: 'Before each save to the project history, the checks look for leaked keys, code without a test, broken links and forgotten placeholders. The rulebook tells the AI to stop and ask you at the steps that need a person.' },
    ],

    'who.title': 'Who it is for',
    'who': [
      { title: 'Developers and teams coding with AI assistants', body: 'Keep the speed and add the checks a careful reviewer would run on every change, for many languages and frameworks.' },
      { title: 'Teams whose AI works from documents', body: 'If your assistant follows skills, playbooks or rules written in plain files, CLC Kernel checks those files too: links, placeholders and the points where a person must approve.' },
    ],

    'strip.label': 'The facts',
    'strip': ['Open source', 'MIT license', 'Free', 'Runs on your machine'],
    'strip.works': 'Works with',

    'cta.line1': 'Give your AI a rulebook.',
    'cta.line2': 'Start with one command.',
    'cta.more': 'Read how it works',

    'footer.tagline': 'A rulebook and automatic checks for AI-assisted work.',
    'footer.product': 'Product',
    'footer.project': 'Project',
    'footer.license': 'MIT license',
    'footer.by': 'Made by',
  },
  es: {
    'skip': 'Saltar al contenido',
    'nav.how': 'Cómo funciona',
    'nav.docs': 'Documentación',
    'nav.github': 'GitHub',
    'nav.home': 'Inicio de CLC Kernel',
    'nav.lang': 'Idioma',
    'copy.idle': 'Copiar',
    'copy.done': 'Copiado',
    'copy.fail': 'Selecciona y copia',
    'copy.label': 'Copiar el comando de instalación',

    'meta.home.title': 'CLC Kernel: un control de seguridad para el trabajo de tu asistente de IA',
    'meta.home.desc': 'CLC Kernel da a todos los asistentes de IA el mismo reglamento y revisa cada cambio antes de guardarlo: claves filtradas, código sin pruebas, enlaces rotos, marcadores olvidados. Código abierto, MIT, se ejecuta en local.',
    'meta.how.title': 'Cómo funciona CLC Kernel: reglamento, guards y el hook de pre-commit',
    'meta.how.desc': 'La parte técnica de CLC Kernel: el reglamento AGENTS.md y sus mirrors, los guards de tools/, el hook de pre-commit, TDD de rojo a verde, stacks compatibles, inicio rápido y glosario.',

    'hero.line1': 'La IA escribe rápido.',
    'hero.line2': 'Ahora su trabajo se revisa.',
    'hero.sub': 'CLC Kernel es el control de seguridad entre tu asistente de IA y tu proyecto. Da a todos los asistentes el mismo reglamento y detiene los cambios que lo incumplen antes de que se guarden.',
    'hero.secondary': 'Cómo funciona',
    'hero.cmdNote': 'Ejecútalo en la carpeta de tu proyecto. Requiere Node 18 o superior.',
    'hero.fig': 'Fig. 01 · El recorrido de un cambio',
    'hero.figAlt': 'Ilustración del recorrido completo: un reglamento AGENTS.md conectado a cinco asistentes; sus cambios avanzan por una pista a través de una cámara de pruebas y una compuerta; un cambio riesgoso se detiene en ámbar con la etiqueta "clave filtrada", otro espera tu aprobación y los cambios aprobados se guardan en azul.',
    'hero.checked': 'Revisados',
    'hero.stopped': 'Detenidos',
    'hero.send': 'Qué envías',
    'hero.good': 'Cambio correcto',
    'hero.goodShort': 'Correcto',
    'hero.risky': 'Cambio riesgoso',
    'hero.riskyShort': 'Riesgoso',
    'hero.hint': 'Haz clic o toca para enviar',
    'hero.stage': 'Enviar un cambio a la compuerta',
    'hero.passedMsg': 'Cambio aprobado',
    'hero.stoppedMsg': 'Cambio detenido',
    'hero.reasons': 'clave filtrada|sin prueba que falle|enlace roto|marcador sin completar',
    'hero.approval': 'Requiere aprobación',
    'hero.approvalShort': 'Aprobación',
    'hero.approved': 'Aprobados',
    'hero.approve': 'Aprobar',
    'hero.approveLabel': 'Aprobar el cambio en espera',
    'hero.approvedMsg': 'Cambio aprobado y guardado',
    'hero.waitingMsg': 'Cambio en espera de tu aprobación',
    'story.label': 'Cómo funciona CLC Kernel, en cuatro pasos',
    'story.labels': 'AGENTS.md|Pruebas|Guards|Tu aprobación|Guardado',
    'story.1.cap': '01 / 04',
    'story.1.title': 'Un solo reglamento',
    'story.1.text': 'Un solo reglamento, AGENTS.md, replicado para que todos los asistentes lean las mismas reglas.',
    'story.2.cap': '02 / 04',
    'story.2.title': 'Tu IA trabaja',
    'story.2.text': 'Tu asistente escribe código como siempre. Cada cambio que hace pasa por los mismos controles.',
    'story.3.cap': '03 / 04',
    'story.3.title': 'Cada cambio se revisa',
    'story.3.text': 'Antes de guardar un commit, una prueba debe fallar sin el cambio y pasar con él, y los guards buscan cosas como claves filtradas, enlaces rotos y marcadores sin completar.',
    'story.4.cap': '04 / 04',
    'story.4.title': 'Tú apruebas lo importante',
    'story.4.text': 'El reglamento le indica a tu IA que se detenga y pregunte antes de los pasos que necesitan a una persona. Tú apruebas y el cambio se guarda en el historial.',
    'hero.sim': 'Ilustración',

    'statement.a': 'Sin controles, un asistente de IA puede filtrar una contraseña, saltarse una prueba o dejar un marcador sin completar, y nadie lo nota hasta que es tarde.',
    'statement.b': 'Con CLC Kernel, cada cambio cumple las mismas reglas',
    'statement.mark': 'antes de guardarse,',
    'statement.c': 'y tú apruebas lo importante.',

    'steps.title': 'Cómo ayuda',
    'steps.lede': 'Ocurren tres cosas. Tú solo haces la primera.',
    'steps': [
      { title: 'Se instala una vez', body: 'Un comando añade a tu proyecto un reglamento y un conjunto de controles automáticos. No hay servidores ni registros.' },
      { title: 'Tu IA sigue las reglas', body: 'Claude Code, Cursor, Copilot, Gemini y Antigravity leen el mismo reglamento, así que todos los asistentes trabajan igual.' },
      { title: 'Cada cambio se revisa antes de guardarse', body: 'Antes de cada guardado en el historial del proyecto, los controles buscan claves filtradas, código sin prueba, enlaces rotos y marcadores olvidados. El reglamento indica a la IA que se detenga y te pregunte en los pasos que requieren a una persona.' },
    ],

    'who.title': 'Para quién es',
    'who': [
      { title: 'Desarrolladores y equipos que programan con asistentes de IA', body: 'Mantienen la velocidad y suman los controles que haría un revisor cuidadoso en cada cambio, en muchos lenguajes y frameworks.' },
      { title: 'Equipos cuya IA trabaja con documentos', body: 'Si tu asistente sigue skills, playbooks o reglas escritas en archivos de texto, CLC Kernel también revisa esos archivos: enlaces, marcadores y los puntos en los que una persona debe aprobar.' },
    ],

    'strip.label': 'Los hechos',
    'strip': ['Código abierto', 'Licencia MIT', 'Gratis', 'Se ejecuta en tu equipo'],
    'strip.works': 'Funciona con',

    'cta.line1': 'Dale un reglamento a tu IA.',
    'cta.line2': 'Empieza con un comando.',
    'cta.more': 'Ver cómo funciona',

    'footer.tagline': 'Un reglamento y controles automáticos para el trabajo asistido por IA.',
    'footer.product': 'Producto',
    'footer.project': 'Proyecto',
    'footer.license': 'Licencia MIT',
    'footer.by': 'Hecho por',
  },
};

/** Localised path: '/how-it-works' -> '/es/how-it-works' for Spanish. */
export function localePath(lang, path) {
  if (lang !== 'es') return path;
  return path === '/' ? '/es/' : `/es${path}`;
}
