/**
 * CLC Kernel — Astro Stack Adapter
 * Supports Astro components, Tailwind CSS v4, Vitest, A11y, and Storybook/MDX stories.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class AstroAdapter extends BaseAdapter {
  constructor() {
    super('Astro Framework', 'frontend', 'Vitest / Playwright');
  }

  detect(targetDir) {
    const hasAstroConfig = fs.existsSync(path.join(targetDir, 'astro.config.mjs')) || fs.existsSync(path.join(targetDir, 'astro.config.js'));
    const hasPkg = fs.existsSync(path.join(targetDir, 'package.json'));
    if (!hasPkg) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return hasAstroConfig || Boolean(deps['astro']);
    } catch (e) {
      return hasAstroConfig;
    }
  }

  getSafeguards() {
    return [
      'Astro Component & UI Primitive Reuse First Guard',
      'Tailwind v4 Semantic Design Token Guard',
      'Accessibility & ARIA Guard (A11y & alt tags)',
      'Responsive Design & Mobile-First Adaptability Guard (breakpoint & touch target audit)',
      'SEO, GEO & Web Performance Guard (metadata, OpenGraph, Core Web Vitals)',
      'Secret & API Key Leak Scanner',
      'Content Collection Schema Validation Guard',
      'TDD protocol (agent-enforced; no verifier installed for this stack)',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
    ];
  }

  /**
   * Returns the tool manifest for Astro projects.
   * Includes JS guard scripts and external CLI tools (astro check, vitest).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'scan_secrets',     language: 'js',       path: 'scan_secrets.js',     command: 'node tools/scan_secrets.js',     description: 'Scans for leaked secrets and API keys' },
      { name: 'check_a11y',       language: 'js',       path: 'check_a11y.js',       command: 'node tools/check_a11y.js',       description: 'Validates ARIA and accessibility rules' },
      { name: 'check_responsive', language: 'js',       path: 'check_responsive.js', command: 'node tools/check_responsive.js', description: 'Audits mobile-first responsiveness and fixed-width overflows' },
      { name: 'check_seo',        language: 'js',       path: 'check_seo.js',        command: 'node tools/check_seo.js',        description: 'Validates SEO metadata, OpenGraph, GEO tags, and LCP priority' },
      { name: 'check_custom',     language: 'js',       path: 'check_custom.js',     command: 'node tools/check_custom.js',     description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'astro_check',      language: 'external', path: '', command: 'npx astro check', description: 'Astro type checking', extCLI: 'astro' },
      { name: 'vitest',           language: 'external', path: '', command: 'npx vitest run',  description: 'Test runner', extCLI: 'vitest' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = AstroAdapter;
