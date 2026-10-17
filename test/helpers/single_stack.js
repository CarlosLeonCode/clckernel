/**
 * Single-stack harness snapshot (sdds/fullstack-monorepo, decision 2): a repo
 * with one code part must be installed exactly as before multi-part support.
 * `captureSingleStack` installs the harness into a throwaway git repo built
 * from a fixture and returns everything the install produced (config shape,
 * hook path and bytes, AGENTS.md, tools/ listing). The golden file
 * test/fixtures/single_stack_snapshot.json was captured with the code that
 * predates multi-part support.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;

const SINGLE_STACK_FIXTURES = {
  FastAPI: { 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' },
  'FastAPI + Docker': { 'requirements.txt': 'fastapi\nredis\n', 'app/__init__.py': '', Dockerfile: 'FROM python:3.12\n' },
  Django: { 'requirements.txt': 'django\n', 'app/__init__.py': '' },
  Astro: {
    'package.json': PACKAGE({ name: 'site', private: true, dependencies: { astro: '^4.0.0' } }),
    'astro.config.mjs': 'export default {};\n',
  },
  'Next.js': { 'package.json': PACKAGE({ name: 'web', private: true, dependencies: { next: '^14.0.0' } }) },
  // Subdirectories that hold no code stack never turn a repo into a monorepo.
  'Next.js + plain packages': {
    'package.json': PACKAGE({ name: 'web', private: true, workspaces: ['packages/*'], dependencies: { next: '^14.0.0' } }),
    'packages/ui/package.json': PACKAGE({ name: 'ui', dependencies: { react: '^18.0.0' } }),
    'server/index.js': 'module.exports = {};\n',
  },
  Rails: { Gemfile: "source 'https://rubygems.org'\n", 'config/routes.rb': 'Rails.application.routes.draw do\nend\n' },
  Go: { 'go.mod': 'module example.com/app\n\ngo 1.21\n', 'main.go': 'package main\n\nfunc main() {}\n' },
  Laravel: { 'composer.json': PACKAGE({ name: 'acme/app' }), artisan: '#!/usr/bin/env php\n<?php\n' },
  Rust: {
    'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/main.rs': 'fn main() {}\n',
  },
  'agent-os': { 'package.json': PACKAGE({ name: 'acme-agent-os', private: true, keywords: ['agent-os'] }) },
  generic: { 'README.md': '# A project of an unknown stack\n' },
};

function gitEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
}

/** Plain-data view of a detected config: adapters by name, tech tools by name. */
function configShape(config) {
  const shape = {};
  for (const key of Object.keys(config).sort()) {
    const value = config[key];
    if (key === 'adapter') shape[key] = value ? value.name : null;
    else if (key === 'techTools') shape[key] = value.map((t) => t.name);
    else shape[key] = value;
  }
  return shape;
}

/**
 * Detects and installs the fixture with the given modules and returns the result.
 * @param {Record<string, string>} files - Fixture files
 * @param {{ autoDetectStack: Function, generateHarness: Function }} api
 */
function captureSingleStack(files, { autoDetectStack, generateHarness }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clckernel-single-stack-'));
  const warn = console.warn;
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
    }
    spawnSync('git', ['init', '-q'], { cwd: dir, env: gitEnv() });
    const config = autoDetectStack(dir);
    const shape = configShape(config);
    // The hooksPath warning text embeds the temp dir; it is not part of the snapshot.
    console.warn = () => {};
    const { hook } = generateHarness(dir, config);
    const read = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf-8') : null);
    return {
      config: shape,
      hookFile: hook.file,
      hook: read(hook.file),
      agents: read('AGENTS.md'),
      tools: fs.readdirSync(path.join(dir, 'tools')).sort(),
    };
  } finally {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { SINGLE_STACK_FIXTURES, captureSingleStack, configShape };
