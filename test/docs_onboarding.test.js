/**
 * The README and website show the post-install guidance the CLI really
 * prints (src/ui.js nextStepsLines) and the AGENTS.md first-session rules
 * (src/onboarding.js), so the docs cannot drift from the code.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { nextStepsLines } = require('../src/ui');
const { FIRST_SESSION_SECTION } = require('../src/onboarding');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

// The plan of a default install: every default mirror written.
const PLAN = {
  written: [
    'CLAUDE.md -> AGENTS.md',
    'GEMINI.md -> AGENTS.md',
    '.cursorrules -> AGENTS.md',
    '.cursor/rules/clckernel_context.mdc -> ../../AGENTS.md',
    '.github/copilot-instructions.md -> ../AGENTS.md',
    '.antigravity/rules.md -> ../AGENTS.md',
  ],
  unchanged: [],
};
const NEXT_STEPS = nextStepsLines({ file: '.githooks/pre-commit', active: true }, PLAN, {}).map(stripAnsi);

const DOCS = [
  'README.md',
  'README.es.md',
  'website/src/pages/docs.astro',
  'website/src/pages/es/docs.astro',
  'website/src/components/QuickstartSection.astro',
];

describe('docs — Next steps block matches the CLI output', () => {
  for (const doc of DOCS) {
    it(`${doc} reproduces every Next steps line`, () => {
      const text = read(doc);
      const missing = NEXT_STEPS.filter((line) => !text.includes(line));
      assert.deepStrictEqual(missing, []);
    });
  }
});

describe('docs — first session after install', () => {
  it('the AGENTS.md section still has the rules the docs describe', () => {
    assert.match(FIRST_SESSION_SECTION, /## First session after install/);
    assert.match(FIRST_SESSION_SECTION, /tools\/\.clckernel-managed\.json` exists and `\.clckernel\.yaml` does not/);
    assert.match(FIRST_SESSION_SECTION, /The user's request comes first/);
    assert.match(FIRST_SESSION_SECTION, /Ask ONE question/);
    assert.match(FIRST_SESSION_SECTION, /holds only a comment/);
  });

  const cases = [
    ['README.md', /## [^\n]*What happens after install/, [/First session after install/, /holds only a comment/, /never rewritten/, /Windsurf/]],
    ['README.es.md', /## [^\n]*Qué ocurre después de instalar/, [/First session after install/, /solo contiene un comentario/, /nunca se reescribe/, /Windsurf/]],
  ];
  for (const [file, heading, facts] of cases) {
    it(`${file} has the after-install section with the facts`, () => {
      const text = read(file);
      assert.match(text, heading);
      const section = text.slice(text.search(heading)).split(/\n## /)[0];
      for (const fact of facts) assert.match(section, fact);
    });
  }

  it('the website quickstart and loop describe the first session in EN and ES', () => {
    const quickstart = read('website/src/components/QuickstartSection.astro');
    assert.match(quickstart, /It asks ONE question/);
    assert.match(quickstart, /Hace UNA pregunta/);
    const loop = read('website/src/components/LoopSection.astro');
    assert.match(loop, /first session is onboarding/);
    assert.match(loop, /primera sesión es de onboarding/);
  });
});

describe('docs — neutral Spanish (no voseo)', () => {
  const VOSEO = /(?<!\p{L})(Abrí|escribí|indicá|Pasale|podés|Podés|Previsualizá|commiteás|querés|tenés|usá|Usá)(?!\p{L})/u;
  const files = ['README.es.md', 'website/src/pages/es/docs.astro', 'website/src/i18n/ui.js', 'website/src/components/QuickstartSection.astro', 'website/src/components/LoopSection.astro'];
  for (const file of files) {
    it(`${file} uses tú forms`, () => {
      const offenders = read(file).split('\n').filter((line) => VOSEO.test(line));
      assert.deepStrictEqual(offenders, []);
    });
  }
});
