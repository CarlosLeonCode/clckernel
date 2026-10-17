const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');

describe('autoDetectStack', () => {
  const { autoDetectStack } = require('../src/detector');

  describe('Next.js detection', () => {
    it('detects package.json with "next" in dependencies', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'frontend');
        assert.strictEqual(config.framework, 'Next.js (App Router)');
        assert.strictEqual(config.testRunner, 'Vitest / Jest');
      } finally {
        teardown(dir);
      }
    });

    it('detects package.json with "next" in devDependencies', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ devDependencies: { next: '15.0.0' } }),
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'frontend');
        assert.strictEqual(config.framework, 'Next.js (App Router)');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('Django detection', () => {
    it('detects manage.py presence', () => {
      const dir = createTmpProject({ 'manage.py': '' });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'Django Framework');
      } finally {
        teardown(dir);
      }
    });

    it('detects requirements.txt with django', () => {
      const dir = createTmpProject({
        'requirements.txt': 'django>=4.0\ndjangorestframework\n',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'Django Framework');
      } finally {
        teardown(dir);
      }
    });

    it('detects pyproject.toml with django', () => {
      const dir = createTmpProject({
        'pyproject.toml': '[project]\nname = "myapp"\ndependencies = ["django>=4.0"]\n',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'Django Framework');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('Go detection', () => {
    it('detects go.mod presence', () => {
      const dir = createTmpProject({
        'go.mod': 'module example.com/myapp\n\ngo 1.21\n',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'Go (Golang)');
        assert.strictEqual(config.testRunner, 'go test');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('FastAPI detection', () => {
    it('detects pyproject.toml with fastapi', () => {
      const dir = createTmpProject({
        'pyproject.toml': '[project]\nname = "myapi"\ndependencies = ["fastapi"]\n',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'FastAPI Framework');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('Astro detection', () => {
    it('detects package.json with astro', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { astro: '3.0.0' } }),
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'frontend');
        assert.strictEqual(config.framework, 'Astro Framework');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('Rails detection', () => {
    it('detects Gemfile with rails and config/routes.rb', () => {
      const dir = createTmpProject({
        'Gemfile': "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\n",
        'config/routes.rb': "Rails.application.routes.draw do\nend\n",
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'Ruby on Rails');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('Rust detection', () => {
    it('detects Cargo.toml with [package]', () => {
      const dir = createTmpProject({
        'Cargo.toml': '[package]\nname = "myapp"\nversion = "0.1.0"\nedition = "2021"\n',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'Rust Engine');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('Laravel detection', () => {
    it('detects artisan and composer.json', () => {
      const dir = createTmpProject({
        artisan: '',
        'composer.json': JSON.stringify({ require: { 'laravel/framework': '^10.0' } }),
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.projectType, 'backend');
        assert.strictEqual(config.framework, 'PHP / Laravel');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('Fallback detection', () => {
    // No adapter matched: the detector must not guess a stack (a Java repo used
    // to receive FastAPI rules, a src/app dir used to be declared Next.js).
    for (const [label, files] of [
      ['src/app exists', { 'src/app/page.tsx': '' }],
      ['src/pages exists', { 'src/pages/index.tsx': '' }],
      ['empty directory', {}],
      ['package.json with unknown dependencies', { 'package.json': JSON.stringify({ dependencies: { lodash: '4.17.21' } }) }],
      ['only pom.xml', { 'pom.xml': '<project/>\n' }],
    ]) {
      it(`returns unknown/unknown when no adapter matches (${label})`, () => {
        const dir = createTmpProject(files);
        try {
          const config = autoDetectStack(dir);
          assert.strictEqual(config.projectType, 'unknown');
          assert.strictEqual(config.framework, 'unknown');
          assert.strictEqual(config.testRunner, 'unknown');
          assert.strictEqual(config.adapter, null);
        } finally {
          teardown(dir);
        }
      });
    }
  });

  describe('Husky detection', () => {
    it('returns gitHooks=husky when .husky directory exists', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
        '.husky/pre-commit': '#!/bin/sh\nnpm test\n',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.gitHooks, 'husky');
      } finally {
        teardown(dir);
      }
    });

    it('returns gitHooks=githooks when .husky directory is absent', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.gitHooks, 'githooks');
      } finally {
        teardown(dir);
      }
    });

    it('returns gitHooks=husky in fallback when .husky exists', () => {
      const dir = createTmpProject({
        '.husky/pre-commit': '',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.gitHooks, 'husky');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('config object shape', () => {
    it('returns all required fields for a matched adapter', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      });
      try {
        const config = autoDetectStack(dir);
        assert.ok('projectType' in config, 'missing projectType');
        assert.ok('framework' in config, 'missing framework');
        assert.ok('styling' in config, 'missing styling');
        assert.ok('uiLibrary' in config, 'missing uiLibrary');
        assert.ok('testRunner' in config, 'missing testRunner');
        assert.ok('gitHooks' in config, 'missing gitHooks');
        assert.ok('orm' in config, 'missing orm');
        assert.ok('adapter' in config, 'missing adapter');
        assert.ok(config.adapter !== null, 'adapter should be set');
      } finally {
        teardown(dir);
      }
    });

    it('sets styling and uiLibrary for frontend adapters', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.styling, 'Tailwind CSS v4');
        assert.strictEqual(config.uiLibrary, 'Component Primitives');
      } finally {
        teardown(dir);
      }
    });

    it('sets N/A for styling and uiLibrary on backend adapters', () => {
      const dir = createTmpProject({ 'go.mod': 'module example.com\n' });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.styling, 'N/A');
        assert.strictEqual(config.uiLibrary, 'N/A');
      } finally {
        teardown(dir);
      }
    });

    it('returns all required fields for fallback config', () => {
      const dir = createTmpProject({});
      try {
        const config = autoDetectStack(dir);
        assert.ok('projectType' in config);
        assert.ok('framework' in config);
        assert.ok('styling' in config);
        assert.ok('uiLibrary' in config);
        assert.ok('testRunner' in config);
        assert.ok('gitHooks' in config);
        assert.ok('orm' in config);
        assert.strictEqual(config.adapter, null);
      } finally {
        teardown(dir);
      }
    });
  });

  describe('adapter priority', () => {
    it('Next.js matches before Django when both signals exist', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
        'manage.py': '',
      });
      try {
        const config = autoDetectStack(dir);
        assert.strictEqual(config.framework, 'Next.js (App Router)');
      } finally {
        teardown(dir);
      }
    });
  });
});
