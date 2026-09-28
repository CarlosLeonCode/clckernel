/**
 * CLC Forge — Universal Auto-Discovery Engine
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

function autoDetectStack(targetDir) {
  // 1. Check registered polyglot adapters
  for (const adapter of adapters) {
    if (adapter.detect(targetDir)) {
      // Detect Phase-1 technologies (Celery, Redis, PostgreSQL, Docker)
      const techDetector = new TechnologyDetector();
      const detectedTechs = techDetector.detect(targetDir);
      const techTools = techDetector.getToolsForTech(detectedTechs);

      return {
        projectType: adapter.projectType,
        framework: adapter.name,
        styling: adapter.projectType === 'frontend' ? 'Tailwind CSS v4' : 'N/A',
        uiLibrary: adapter.projectType === 'frontend' ? 'Component Primitives' : 'N/A',
        testRunner: adapter.testRunner,
        gitHooks: fs.existsSync(path.join(targetDir, '.husky')) ? 'husky' : 'githooks',
        orm: 'Framework Native',
        adapter,
        techTools
      };
    }
  }

  // 2. Fallback detection
  const techDetector = new TechnologyDetector();
  const detectedTechs = techDetector.detect(targetDir);
  const techTools = techDetector.getToolsForTech(detectedTechs);

  const config = {
    projectType: 'unknown',
    framework: 'unknown',
    styling: 'none',
    uiLibrary: 'none',
    testRunner: 'unknown',
    gitHooks: fs.existsSync(path.join(targetDir, '.husky')) ? 'husky' : 'githooks',
    orm: 'none',
    adapter: null,
    techTools
  };

  if (fs.existsSync(path.join(targetDir, 'src', 'app')) || fs.existsSync(path.join(targetDir, 'src', 'pages'))) {
    config.projectType = 'frontend';
    config.framework = 'Next.js';
    config.testRunner = 'Vitest';
    config.styling = 'Tailwind CSS v4';
  } else {
    config.projectType = 'backend';
    config.framework = 'FastAPI';
    config.testRunner = 'Pytest';
  }

  return config;
}

module.exports = { autoDetectStack };
