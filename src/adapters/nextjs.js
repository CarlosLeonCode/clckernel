/**
 * CLC Kernel — Next.js Stack Adapter
 * Supports Next.js (App Router / Pages), React Server Components, Tailwind CSS, Vitest / Jest, and A11y.
 */

const fs = require('fs');
const path = require('path');
const BaseAdapter = require('./base');

class NextjsAdapter extends BaseAdapter {
  constructor() {
    super('Next.js (App Router)', 'frontend', 'Vitest / Jest');
  }

  detect(targetDir) {
    const hasPkg = fs.existsSync(path.join(targetDir, 'package.json'));
    if (!hasPkg) return false;

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return Boolean(deps['next']);
    } catch (e) {
      return false;
    }
  }

  getSafeguards() {
    return [
      'UI Component Reuse First Guard (components/ui/ & atomic primitives)',
      'Tailwind v4 Semantic Design Token Guard (bg-primary, text-muted-foreground)',
      'Next.js Clean Architecture & Server Components Guard (layout.tsx protection)',
      'Secret & Client Token Exposure Guard',
      'Accessibility & ARIA Guard (A11y & alt tags)',
      'Responsive Design & Mobile-First Adaptability Guard (breakpoint & touch target audit)',
      'SEO, GEO & Web Performance Guard (metadata, OpenGraph, Core Web Vitals)',
      'Zod API Contract Guard (services response schema parsing)',
      'Performance & Next/Image Guard (next/image & tree-shaking)',
      'Storybook Story Coverage Guard (.stories.tsx)',
      'Red→Green TDD Verifier (runs changed tests with vitest / jest / node:test)',
      'Educational Audit Gate (05-audit-report.md)',
      'Memory protocol (agent-enforced; Engram / Graphify optional, not checked by a guard)'
    ];
  }

  /**
   * Returns the tool manifest for Next.js projects.
   * Includes JS guard scripts and external CLI tools (tsc, lint-staged).
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string, extCLI?: string}>}
   */
  getTools() {
    const baseTools = [
      { name: 'scan_secrets',       language: 'js',       path: 'scan_secrets.js',       command: 'node tools/scan_secrets.js',       description: 'Scans for leaked secrets and API keys' },
      { name: 'check_a11y',         language: 'js',       path: 'check_a11y.js',         command: 'node tools/check_a11y.js',         description: 'Validates ARIA and accessibility rules' },
      { name: 'check_responsive',   language: 'js',       path: 'check_responsive.js',   command: 'node tools/check_responsive.js',   description: 'Audits mobile-first responsiveness and fixed-width overflows' },
      { name: 'check_seo',          language: 'js',       path: 'check_seo.js',          command: 'node tools/check_seo.js',          description: 'Validates SEO metadata, OpenGraph, GEO tags, and LCP priority' },
      { name: 'check_ui_reuse',     language: 'js',       path: 'check_ui_reuse.js',     command: 'node tools/check_ui_reuse.js',     description: 'Enforces UI primitive reuse from components/ui/' },
      { name: 'check_architecture', language: 'js',       path: 'check_architecture.js', command: 'node tools/check_architecture.js', description: 'Validates Next.js Server Component boundaries' },
      { name: 'check_performance',  language: 'js',       path: 'check_performance.js',  command: 'node tools/check_performance.js',  description: 'Checks next/image and bundle optimization' },
      { name: 'verify_tdd',         language: 'js',       path: 'verify_tdd.js',         command: 'node tools/verify_tdd.js',         description: 'Runs changed tests (vitest / jest / node:test) against BASE (must fail) and the staged code (must pass)' },
      { name: 'check_custom',        language: 'js',       path: 'check_custom.js',       command: 'node tools/check_custom.js',       description: 'Runs user-defined custom rules from .clckernel.yaml' },
      { name: 'tsc',                language: 'external', path: '', command: 'npx tsc --noEmit',        description: 'TypeScript type checking', extCLI: 'tsc', availableIf: '[ -x node_modules/.bin/tsc ]' },
      { name: 'lint',               language: 'external', path: '', command: 'npx lint-staged',         description: 'Lint staged files', extCLI: 'lint-staged', availableIf: '[ -x node_modules/.bin/lint-staged ]' },
    ];
    return baseTools;
  }

  provision(targetDir, config) {
    super.provision(targetDir, config);
    // Pre-commit hook generation moved to generator.js via getTools() manifest
  }
}

module.exports = NextjsAdapter;
