const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');

const { generateHookFromManifest, generateHarness } = require('../src/generator');

describe('generateHookFromManifest', () => {
  describe('frontend hook', () => {
    it('creates .husky/pre-commit with shebang and husky.sh line', () => {
      const adapter = {
        projectType: 'frontend',
        name: 'Next.js (App Router)',
        getTools: () => [
          { name: 'scan', command: 'node tools/scan_secrets.js', language: 'js', path: 'scan_secrets.js' },
          { name: 'tsc', command: 'npx tsc --noEmit', language: 'external', path: '' },
        ],
      };
      const dir = createTmpProject({});
      try {
        generateHookFromManifest(adapter, dir);

        const hookFile = path.join(dir, '.husky', 'pre-commit');
        assert.ok(fs.existsSync(hookFile), '.husky/pre-commit should exist');

        const content = fs.readFileSync(hookFile, 'utf-8');
        assert.ok(content.startsWith('#!/usr/bin/env sh'), 'should start with sh shebang');
        assert.ok(content.includes('husky.sh'), 'should include husky.sh reference');
        assert.ok(content.includes('node tools/scan_secrets.js'), 'should include tool command');
        assert.ok(content.includes('npx tsc --noEmit'), 'should include external tool command');

        // Frontend should NOT have .githooks directory
        assert.ok(!fs.existsSync(path.join(dir, '.githooks')), 'should not create .githooks for frontend');
      } finally {
        teardown(dir);
      }
    });

    it('creates hook directory recursively', () => {
      const adapter = {
        projectType: 'frontend',
        name: 'Astro Framework',
        getTools: () => [],
      };
      const dir = createTmpProject({});
      try {
        generateHookFromManifest(adapter, dir);
        assert.ok(fs.existsSync(path.join(dir, '.husky', 'pre-commit')), '.husky/pre-commit should exist');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('backend hook', () => {
    it('creates .githooks/pre-commit with bash shebang', () => {
      const adapter = {
        projectType: 'backend',
        name: 'Django Framework',
        getTools: () => [
          { name: 'scan', command: 'python3 tools/scan_secrets.py', language: 'py', path: 'scan_secrets.py' },
          { name: 'ruff', command: 'python3 -m ruff check .', language: 'external', path: '' },
        ],
      };
      const dir = createTmpProject({});
      try {
        generateHookFromManifest(adapter, dir);

        const hookFile = path.join(dir, '.githooks', 'pre-commit');
        assert.ok(fs.existsSync(hookFile), '.githooks/pre-commit should exist');

        const content = fs.readFileSync(hookFile, 'utf-8');
        assert.ok(content.startsWith('#!/usr/bin/env bash'), 'should start with bash shebang');
        assert.ok(content.includes('Django Framework'), 'should mention adapter name');
        assert.ok(content.includes('python3 tools/scan_secrets.py'), 'should include tool command');
        assert.ok(content.includes('python3 -m ruff check .'), 'should include external tool command');

        // Backend should NOT have .husky directory
        assert.ok(!fs.existsSync(path.join(dir, '.husky')), 'should not create .husky for backend');
      } finally {
        teardown(dir);
      }
    });

    it('hooks directory is created recursively', () => {
      const adapter = {
        projectType: 'backend',
        name: 'FastAPI Framework',
        getTools: () => [],
      };
      const dir = createTmpProject({});
      try {
        generateHookFromManifest(adapter, dir);
        assert.ok(fs.existsSync(path.join(dir, '.githooks', 'pre-commit')), '.githooks/pre-commit should exist');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('skips tools without command', () => {
    it('does not include tools with undefined command in hook', () => {
      const adapter = {
        projectType: 'frontend',
        name: 'Next.js (App Router)',
        getTools: () => [
          { name: 'scan', command: 'node tools/scan_secrets.js', language: 'js', path: 'scan_secrets.js' },
          { name: 'tsc', command: undefined, language: 'external', path: '' },
        ],
      };
      const dir = createTmpProject({});
      try {
        generateHookFromManifest(adapter, dir);

        const hookFile = path.join(dir, '.husky', 'pre-commit');
        const content = fs.readFileSync(hookFile, 'utf-8');
        assert.ok(!content.includes('undefined'), 'should not include undefined in hook');
        assert.ok(content.includes('node tools/scan_secrets.js'), 'should include valid command');
      } finally {
        teardown(dir);
      }
    });

    it('does not include tools with empty string command', () => {
      const adapter = {
        projectType: 'backend',
        name: 'FastAPI Framework',
        getTools: () => [
          { name: 'lint', command: '', language: 'external', path: '' },
        ],
      };
      const dir = createTmpProject({});
      try {
        generateHookFromManifest(adapter, dir);

        const hookFile = path.join(dir, '.githooks', 'pre-commit');
        const content = fs.readFileSync(hookFile, 'utf-8');
        // Should only have shebang + echo + blank line, no empty command
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        assert.strictEqual(lines.length, 2, 'should only have shebang and echo line');
      } finally {
        teardown(dir);
      }
    });

    it('generates empty hook when all tools lack commands', () => {
      const adapter = {
        projectType: 'frontend',
        name: 'Next.js (App Router)',
        getTools: () => [
          { name: 'tsc', command: undefined, language: 'external', path: '' },
        ],
      };
      const dir = createTmpProject({});
      try {
        generateHookFromManifest(adapter, dir);

        const hookFile = path.join(dir, '.husky', 'pre-commit');
        const content = fs.readFileSync(hookFile, 'utf-8');
        // Just shebang + husky.sh line
        assert.ok(content.startsWith('#!/usr/bin/env sh'));
        assert.ok(content.includes('husky.sh'));
        assert.ok(!content.includes('tsc'));
      } finally {
        teardown(dir);
      }
    });
  });
});

describe('generateHarness', () => {
  describe('with adapter', () => {
    it('calls adapter.provision() and generates hook from manifest', () => {
      let provisionCalled = false;
      let provisionDir = null;
      const adapter = {
        projectType: 'frontend',
        name: 'Next.js (App Router)',
        provision(dir, config) {
          provisionCalled = true;
          provisionDir = dir;
          // Simulate what BaseAdapter.provision does
          fs.mkdirSync(path.join(dir, 'docs', 'Journal'), { recursive: true });
          fs.mkdirSync(path.join(dir, 'docs', 'Architecture'), { recursive: true });
          fs.mkdirSync(path.join(dir, 'docs', 'Development'), { recursive: true });
          fs.mkdirSync(path.join(dir, 'sdds'), { recursive: true });
          fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
          fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
          fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# CLC Forge Next.js (App Router)');
        },
        getTools: () => [
          { name: 'scan', language: 'js', path: 'scan_secrets.js', command: 'node tools/scan_secrets.js' },
        ],
        getSafeguards: () => ['Guard 1', 'Guard 2'],
      };

      const config = {
        projectType: 'frontend',
        framework: 'Next.js (App Router)',
        testRunner: 'Vitest / Jest',
        adapter,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        assert.ok(provisionCalled, 'adapter.provision() should be called');
        assert.strictEqual(provisionDir, dir, 'provision should receive targetDir');
        assert.ok(fs.existsSync(path.join(dir, 'docs', 'Journal')), 'docs/Journal should exist');
        assert.ok(fs.existsSync(path.join(dir, 'sdds')), 'sdds/ should exist');
        assert.ok(fs.existsSync(path.join(dir, 'tools')), 'tools/ should exist');
        assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md should exist');
        assert.ok(fs.existsSync(path.join(dir, '.husky', 'pre-commit')), '.husky/pre-commit should exist');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('fallback (no adapter)', () => {
    it('creates directory structure for frontend project', () => {
      const config = {
        projectType: 'frontend',
        framework: 'Next.js',
        testRunner: 'Vitest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        assert.ok(fs.existsSync(path.join(dir, 'docs', 'Journal')), 'docs/Journal should exist');
        assert.ok(fs.existsSync(path.join(dir, 'docs', 'Architecture')), 'docs/Architecture should exist');
        assert.ok(fs.existsSync(path.join(dir, 'docs', 'Development')), 'docs/Development should exist');
        assert.ok(fs.existsSync(path.join(dir, 'sdds')), 'sdds/ should exist');
        assert.ok(fs.existsSync(path.join(dir, 'tools')), 'tools/ should exist');
      } finally {
        teardown(dir);
      }
    });

    it('creates AGENTS.md with framework and project type', () => {
      const config = {
        projectType: 'frontend',
        framework: 'Next.js',
        testRunner: 'Vitest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        assert.ok(agents.includes('Next.js'), 'AGENTS.md should include framework name');
        assert.ok(agents.includes('FRONTEND'), 'AGENTS.md should include project type');
        assert.ok(agents.includes('Vitest'), 'AGENTS.md should include test runner');
      } finally {
        teardown(dir);
      }
    });

    it('creates AGENTS.md with backend safeguards for backend project', () => {
      const config = {
        projectType: 'backend',
        framework: 'FastAPI',
        testRunner: 'Pytest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        assert.ok(agents.includes('FastAPI'), 'AGENTS.md should include framework name');
        assert.ok(agents.includes('BACKEND'), 'AGENTS.md should include project type');
        assert.ok(agents.includes('Scope Guardrail'), 'should include backend safeguard');
        assert.ok(!agents.includes('UI Component Reuse First'), 'should not include frontend safeguards');
      } finally {
        teardown(dir);
      }
    });

    it('creates AGENTS.md with frontend safeguards for frontend project', () => {
      const config = {
        projectType: 'frontend',
        framework: 'Next.js',
        testRunner: 'Vitest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        assert.ok(agents.includes('UI Component Reuse First'), 'should include frontend safeguards');
        assert.ok(agents.includes('Accessibility & ARIA Guard'), 'should include a11y guard');
        assert.ok(!agents.includes('Scope Guardrail'), 'should not include backend safeguards');
      } finally {
        teardown(dir);
      }
    });

    it('creates AGENTS.md with Universal Command Interface', () => {
      const config = {
        projectType: 'frontend',
        framework: 'Next.js',
        testRunner: 'Vitest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
        assert.ok(agents.includes('Universal Command Interface'), 'should include command interface section');
        assert.ok(agents.includes('clckernel feature'), 'should include clckernel feature command');
        assert.ok(agents.includes('clckernel fix'), 'should include clckernel fix command');
        assert.ok(agents.includes('clckernel audit'), 'should include clckernel audit command');
        assert.ok(agents.includes('clckernel commit'), 'should include clckernel commit command');
      } finally {
        teardown(dir);
      }
    });

    it('writes .gitignore with sdds/* entry', () => {
      const config = {
        projectType: 'backend',
        framework: 'FastAPI',
        testRunner: 'Pytest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
        assert.ok(gitignore.includes('sdds/*'), '.gitignore should include sdds/*');
        assert.ok(gitignore.includes('.gitkeep'), '.gitignore should reference .gitkeep');
      } finally {
        teardown(dir);
      }
    });

    it('creates .gitkeep in sdds/', () => {
      const config = {
        projectType: 'backend',
        framework: 'FastAPI',
        testRunner: 'Pytest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);
        assert.ok(fs.existsSync(path.join(dir, 'sdds', '.gitkeep')), 'sdds/.gitkeep should exist');
      } finally {
        teardown(dir);
      }
    });

    it('appends to existing .gitignore without duplicating sdds/*', () => {
      const config = {
        projectType: 'backend',
        framework: 'FastAPI',
        testRunner: 'Pytest',
        adapter: null,
      };

      const dir = createTmpProject({
        '.gitignore': 'node_modules/\n.env\n',
      });
      try {
        generateHarness(dir, config);

        const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
        const matches = gitignore.match(/sdds\/\*/g);
        assert.strictEqual(matches.length, 1, 'sdds/* should appear exactly once');
        assert.ok(gitignore.includes('node_modules/'), 'original content preserved');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('fallback hook generation', () => {
    it('creates .husky/pre-commit for frontend projects', () => {
      const config = {
        projectType: 'frontend',
        framework: 'Next.js',
        testRunner: 'Vitest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        const hookFile = path.join(dir, '.husky', 'pre-commit');
        assert.ok(fs.existsSync(hookFile), '.husky/pre-commit should exist');

        const content = fs.readFileSync(hookFile, 'utf-8');
        assert.ok(content.startsWith('#!/usr/bin/env sh'), 'should have sh shebang');
        assert.ok(content.includes('husky.sh'), 'should include husky.sh');
        assert.ok(content.includes('scan_secrets'), 'should reference scan_secrets');
      } finally {
        teardown(dir);
      }
    });

    it('creates .githooks/pre-commit for backend projects', () => {
      const config = {
        projectType: 'backend',
        framework: 'FastAPI',
        testRunner: 'Pytest',
        adapter: null,
      };

      const dir = createTmpProject({});
      try {
        generateHarness(dir, config);

        const hookFile = path.join(dir, '.githooks', 'pre-commit');
        assert.ok(fs.existsSync(hookFile), '.githooks/pre-commit should exist');

        const content = fs.readFileSync(hookFile, 'utf-8');
        assert.ok(content.startsWith('#!/usr/bin/env bash'), 'should have bash shebang');
        assert.ok(content.includes('CLC Kernel') || content.includes('CLC Forge'), 'should include CLC branding');
        assert.ok(content.includes('scan_secrets'), 'should reference scan_secrets');
      } finally {
        teardown(dir);
      }
    });
  });
});
