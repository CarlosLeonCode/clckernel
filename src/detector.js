/**
 * CLC Kernel — Universal Auto-Discovery Engine
 * Inspects repository signatures to auto-match the right polyglot Stack Adapter
 * (Next.js, FastAPI, Django, Astro, Rails, Go, Rust, Laravel).
 */

const fs = require('fs');
const path = require('path');

const NextjsAdapter = require('./adapters/nextjs');
const FastApiAdapter = require('./adapters/fastapi');
const DjangoAdapter = require('./adapters/django');
const AstroAdapter = require('./adapters/astro');
const RailsAdapter = require('./adapters/rails');
const GoAdapter = require('./adapters/go');
const RustAdapter = require('./adapters/rust');
const LaravelAdapter = require('./adapters/laravel');
const AgentOSAdapter = require('./adapters/agent-os');
const { TechnologyDetector } = require('./technologies/detector');

const adapters = [
  new AgentOSAdapter(),
  new NextjsAdapter(),
  new FastApiAdapter(),
  new DjangoAdapter(),
  new AstroAdapter(),
  new RailsAdapter(),
  new GoAdapter(),
  new RustAdapter(),
  new LaravelAdapter()
];

/**
 * Builds the project config for a given adapter, exactly as auto-detection
 * does for a matched adapter. A null adapter yields the generic config.
 * Used by autoDetectStack and by the "Elegir otro stack" prompt, so a stack
 * chosen by hand provisions exactly what a detected one would.
 * @param {string} targetDir - Project root
 * @param {object|null} adapter - One of `adapters`, or null for generic
 * @returns {object} Project config
 */
function buildStackConfig(targetDir, adapter) {
  // Phase-1 technologies (Celery, Redis, PostgreSQL, Docker)
  const techDetector = new TechnologyDetector();
  const detectedTechs = techDetector.detect(targetDir);
  const techTools = techDetector.getToolsForTech(detectedTechs);
  const gitHooks = fs.existsSync(path.join(targetDir, '.husky')) ? 'husky' : 'githooks';

  if (!adapter) {
    // No adapter: report the stack as unknown instead of guessing one; the
    // generator installs a generic, stack-agnostic harness.
    return {
      projectType: 'unknown',
      framework: 'unknown',
      styling: 'none',
      uiLibrary: 'none',
      testRunner: 'unknown',
      gitHooks,
      orm: 'none',
      adapter: null,
      techTools
    };
  }

  return {
    projectType: adapter.projectType,
    framework: adapter.name,
    styling: adapter.projectType === 'frontend' ? 'Tailwind CSS v4' : 'N/A',
    uiLibrary: adapter.projectType === 'frontend' ? 'Component Primitives' : 'N/A',
    testRunner: adapter.testRunner,
    gitHooks,
    orm: 'Framework Native',
    adapter,
    techTools
  };
}

function autoDetectStack(targetDir) {
  const adapter = adapters.find((a) => a.detect(targetDir)) || null;
  return buildStackConfig(targetDir, adapter);
}

module.exports = { autoDetectStack, buildStackConfig, adapters };
