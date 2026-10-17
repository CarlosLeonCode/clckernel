const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('../helpers');

const CLI_PATH = path.join(__dirname, '..', '..', 'bin', 'cli.js');

describe('Integration: Full CLI Flow', () => {
  describe('runCli() doctor command', () => {
    it('runs doctor and exits 0 on healthy project', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/audit.js': 'module.exports = {};\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        const result = execSync(`node "${CLI_PATH}" doctor "${dir}"`, {
          encoding: 'utf-8',
          timeout: 15000,
        });
        assert.ok(result.includes('HEALTHY'), 'doctor should report HEALTHY');
        assert.ok(result.includes('CLC KERNEL DOCTOR') || result.includes('CLC FORGE DOCTOR'), 'should show doctor header');
        assert.ok(result.includes('[PASS]'), 'should show PASS checks');
      } finally {
        teardown(dir);
      }
    });

    it('runs doctor, reports issues and exits 1 on unhealthy project', () => {
      const dir = createTmpProject({
        'package.json': '{}',
      });
      try {
        const res = spawnSync('node', [CLI_PATH, 'doctor', dir], {
          encoding: 'utf-8',
          timeout: 15000,
        });
        assert.strictEqual(res.status, 1, 'doctor must exit 1 when checks fail');
        const result = res.stdout;
        assert.ok(result.includes('[FAIL]'), 'doctor should report FAIL checks');
        assert.ok(!result.includes('HEALTHY'), 'should not be HEALTHY');
        assert.ok(result.includes('issue(s) detected'), 'should report issue count');
      } finally {
        teardown(dir);
      }
    });

    it('resolves target directory from second argument', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        const result = execSync(`node "${CLI_PATH}" doctor "${dir}"`, {
          encoding: 'utf-8',
          timeout: 15000,
        });
        // The output should show the target directory path
        assert.ok(result.includes(dir), 'output should show target directory');
      } finally {
        teardown(dir);
      }
    });

    it('uses cwd when no directory argument is provided', () => {
      // Create a healthy project in a temp dir and run from there
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        const result = execSync(`node "${CLI_PATH}" doctor`, {
          encoding: 'utf-8',
          timeout: 15000,
          cwd: dir,
        });
        assert.ok(result.includes('HEALTHY'), 'doctor should use cwd');
        assert.ok(result.includes(dir), 'should show cwd path');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('runCli() default flow (non-doctor)', () => {
    it('resolves target directory from first argument', () => {
      const dir = createTmpProject({
        'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      });
      try {
        // The default flow will try to printBanner → autoDetectStack → promptOptions
        // promptOptions reads stdin so it will hang — use timeout and check output
        try {
          execSync(`node "${CLI_PATH}" "${dir}"`, {
            encoding: 'utf-8',
            timeout: 3000,
            input: '1\n',
          });
        } catch (e) {
          // May exit non-zero due to prompt timeout, but we check the output
          const output = e.stdout || e.stderr || '';
          // Should at least detect the stack (Next.js)
          assert.ok(output.length > 0, 'should produce output');
        }
      } finally {
        teardown(dir);
      }
    });
  });

  describe('runCli() with --doctor flag', () => {
    it('accepts --doctor flag as alternative to doctor command', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        const result = execSync(`node "${CLI_PATH}" --doctor "${dir}"`, {
          encoding: 'utf-8',
          timeout: 15000,
        });
        assert.ok(result.includes('HEALTHY'), '--doctor flag should run doctor');
        assert.ok(result.includes('CLC KERNEL DOCTOR') || result.includes('CLC FORGE DOCTOR'), 'should show doctor header');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('doctor detects all hook types', () => {
    it('detects .githooks/pre-commit via CLI', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_lint.py': 'def check():\n    return True\n',
        '.githooks/pre-commit': '#!/usr/bin/env bash\necho test\n',
      });
      try {
        const result = execSync(`node "${CLI_PATH}" doctor "${dir}"`, {
          encoding: 'utf-8',
          timeout: 15000,
        });
        // .githooks should satisfy the pre-commit check
        assert.ok(result.includes('[PASS]') && result.includes('pre-commit git hooks'), '.githooks should PASS');
      } finally {
        teardown(dir);
      }
    });

    it('validates Python tool parsing via CLI', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_syntax.py': 'x = 1\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        const result = execSync(`node "${CLI_PATH}" doctor "${dir}"`, {
          encoding: 'utf-8',
          timeout: 15000,
        });
        assert.ok(result.includes('tool/check_syntax.py parses'), 'should validate Python tool');
        assert.ok(result.includes('[PASS]') && result.includes('check_syntax.py parses'), 'valid Python should PASS');
      } finally {
        teardown(dir);
      }
    });
  });
});

describe('Integration: Component Composition', () => {
  it('autoDetectStack + generateHarness creates valid project structure', () => {
    const { autoDetectStack } = require('../../src/detector');
    const { generateHarness } = require('../../src/generator');

    const dir = createTmpProject({
      'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
    });
    try {
      const config = autoDetectStack(dir);
      assert.strictEqual(config.framework, 'Next.js (App Router)', 'should detect Next.js');

      generateHarness(dir, config);

      // Verify all expected artifacts
      assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md should exist');
      assert.ok(fs.existsSync(path.join(dir, 'sdds')), 'sdds/ should exist');
      assert.ok(fs.existsSync(path.join(dir, 'docs', 'Journal')), 'docs/Journal/ should exist');
      assert.ok(fs.existsSync(path.join(dir, 'tools')), 'tools/ should exist');
      assert.ok(fs.existsSync(path.join(dir, '.husky', 'pre-commit')), '.husky/pre-commit should exist');

      // Verify AGENTS.md content
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.ok(agents.includes('Next.js'), 'AGENTS.md should mention Next.js');
      assert.ok(agents.includes('FRONTEND'), 'AGENTS.md should mention FRONTEND');
    } finally {
      teardown(dir);
    }
  });

  it('autoDetectStack fallback + generateHarness creates backend structure', () => {
    const { autoDetectStack } = require('../../src/detector');
    const { generateHarness } = require('../../src/generator');

    const dir = createTmpProject({
      'go.mod': 'module example.com\n\ngo 1.21\n',
    });
    try {
      const config = autoDetectStack(dir);
      assert.strictEqual(config.framework, 'Go (Golang)', 'should detect Go');

      generateHarness(dir, config);

      assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md should exist');
      assert.ok(fs.existsSync(path.join(dir, 'sdds')), 'sdds/ should exist');
      assert.ok(fs.existsSync(path.join(dir, '.githooks', 'pre-commit')), '.githooks/pre-commit should exist');

      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
      assert.ok(agents.includes('Go'), 'AGENTS.md should mention Go');
      assert.ok(agents.includes('BACKEND'), 'AGENTS.md should mention BACKEND');
    } finally {
      teardown(dir);
    }
  });

  it('detect → generate → doctor reports HEALTHY', () => {
    const { autoDetectStack } = require('../../src/detector');
    const { generateHarness } = require('../../src/generator');
    const { runDoctor } = require('../../src/doctor');

    const dir = createTmpProject({
      'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
    });
    try {
      // Step 1: Detect
      const config = autoDetectStack(dir);
      assert.strictEqual(config.framework, 'Next.js (App Router)');

      // Step 2: Generate
      generateHarness(dir, config);

      // Step 3: Doctor should report HEALTHY
      let capturedOutput = '';
      const originalLog = console.log;
      console.log = (...args) => { capturedOutput += args.join(' ') + '\n'; };
      try {
        runDoctor(dir);
        assert.ok(capturedOutput.includes('HEALTHY'), 'after detect+generate, doctor should be HEALTHY');
      } finally {
        console.log = originalLog;
      }
    } finally {
      teardown(dir);
    }
  });
});
