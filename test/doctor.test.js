const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createTmpProject, teardown } = require('./helpers');

describe('runDoctor', () => {
  const { runDoctor } = require('../src/doctor');

  /**
   * Helper: create a fully healthy project with all required structures.
   */
  function createHealthyProject() {
    return createTmpProject({
      'AGENTS.md': '# AGENTS.md\nProject governance rules.\n',
      'sdds/.gitkeep': '',
      'docs/Journal/001-adr.md': '# ADR 001\n',
      'tools/audit.js': "const scan = require('./check_scan');\nmodule.exports = { scan };\n",
      'tools/check_scan.js': 'module.exports = function check() { return true; };\n',
      'tools/check_lint.py': 'def check():\n    return True\n',
      '.husky/pre-commit': '#!/usr/bin/env sh\nnpm test\n',
    });
  }

  let capturedOutput;
  let originalLog;

  beforeEach(() => {
    capturedOutput = [];
    originalLog = console.log;
    console.log = (...args) => capturedOutput.push(args.join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe('healthy project (all checks pass)', () => {
    it('reports HEALTHY when all files and tools are present', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('HEALTHY'), 'output should contain HEALTHY');
        assert.ok(output.includes('[PASS]'), 'output should contain PASS markers');
        assert.ok(!output.includes('[FAIL]'), 'should have no FAIL markers');
      } finally {
        teardown(dir);
      }
    });

    it('summarizes with the concrete number of checks, not a percentage', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        const passLines = capturedOutput.filter((line) => line.includes('[PASS]')).length;
        assert.ok(
          output.includes(`All ${passLines} doctor checks passed.`),
          `expected "All ${passLines} doctor checks passed." in output`
        );
        assert.ok(!output.includes('100%'), 'should not claim a percentage');
      } finally {
        teardown(dir);
      }
    });

    it('has PASS status for AGENTS.md check', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('AGENTS.md law document'), 'should check AGENTS.md');
        // The PASS line for AGENTS.md
        assert.ok(output.includes('[PASS]') && output.includes('AGENTS.md'), 'AGENTS.md should be PASS');
      } finally {
        teardown(dir);
      }
    });

    it('has PASS status for tools/ check', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('tools/ safeguard suite'), 'should check tools/');
        assert.ok(output.includes('[PASS]') && output.includes('tools/ safeguard suite'), 'tools/ should be PASS');
      } finally {
        teardown(dir);
      }
    });

    it('validates JS tool loads successfully', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('tool/check_scan.js loads'), 'should validate check_scan.js');
        assert.ok(output.includes('[PASS]') && output.includes('check_scan.js loads'), 'check_scan.js should PASS');
      } finally {
        teardown(dir);
      }
    });

    it('validates Python tool parses successfully', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('tool/check_lint.py parses'), 'should validate check_lint.py');
        assert.ok(output.includes('[PASS]') && output.includes('check_lint.py parses'), 'check_lint.py should PASS');
      } finally {
        teardown(dir);
      }
    });

    it('validates audit.js import alignment', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('audit.js import ./check_scan'), 'should check audit.js import');
        assert.ok(output.includes('[PASS]') && output.includes('audit.js import ./check_scan'), 'audit.js import should PASS');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('missing AGENTS.md', () => {
    it('marks AGENTS.md check as FAIL', () => {
      const dir = createTmpProject({
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[FAIL]') && output.includes('AGENTS.md law document'), 'AGENTS.md should be FAIL');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('missing sdds/ directory', () => {
    it('marks sdds/ check as FAIL', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[FAIL]') && output.includes('sdds/'), 'sdds/ should be FAIL');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('missing tools/ directory', () => {
    it('marks tools/ safeguard suite as FAIL', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[FAIL]') && output.includes('tools/ safeguard suite'), 'tools/ should be FAIL');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('missing pre-commit hooks', () => {
    it('marks pre-commit git hooks as FAIL when neither .husky nor .githooks exist', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[FAIL]') && output.includes('pre-commit git hooks'), 'pre-commit hooks should be FAIL');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });

    it('marks pre-commit git hooks as PASS when .githooks/pre-commit exists', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_scan.js': 'module.exports = function() {};\n',
        '.githooks/pre-commit': '#!/usr/bin/env bash\necho test\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[PASS]') && output.includes('pre-commit git hooks'), '.githooks should be PASS');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('broken JS tool (require fails)', () => {
    it('marks tool/check_broken.js loads as FAIL when require fails', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_broken.js': "const missing = require('./nonexistent');\nmodule.exports = {};\n",
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[FAIL]') && output.includes('tool/check_broken.js loads'), 'broken JS tool should FAIL');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('broken Python tool (ast.parse fails)', () => {
    it('marks tool/check_bad.py parses as FAIL when syntax is invalid', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/check_bad.py': 'def broken(\n    return True\n',  // Missing closing paren
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[FAIL]') && output.includes('tool/check_bad.py parses'), 'broken Python tool should FAIL');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('English output', () => {
    it('outputs all messages in English (no Spanish)', () => {
      const dir = createHealthyProject();
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        // Key English phrases that should be present
        assert.ok(output.includes('HEALTHY'), 'should output HEALTHY');
        assert.ok(output.includes('CLC KERNEL DOCTOR') || output.includes('CLC FORGE DOCTOR'), 'should output doctor header');
        assert.ok(output.includes('PASS'), 'should output PASS');
        // Spanish phrases that should NOT be present
        const spanishWords = ['éxito', 'éxito', 'falló', 'problema', 'instalado', 'salvaguardas', 'leyes'];
        for (const word of spanishWords) {
          assert.ok(!output.toLowerCase().includes(word), `should not contain Spanish word: ${word}`);
        }
      } finally {
        teardown(dir);
      }
    });
  });

  describe('audit.js import alignment failure', () => {
    it('marks audit.js import as FAIL when required module is missing', () => {
      const dir = createTmpProject({
        'AGENTS.md': '# AGENTS\n',
        'sdds/.gitkeep': '',
        'docs/Journal/001-adr.md': '# ADR\n',
        'tools/audit.js': "const checker = require('./check_nonexistent');\nmodule.exports = {};\n",
        '.husky/pre-commit': '#!/usr/bin/env sh\necho test\n',
      });
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('[FAIL]') && output.includes('audit.js import ./check_nonexistent'), 'audit.js import should FAIL');
        assert.ok(output.includes('Module not found in tools/'), 'should show detail message');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });
  });

  describe('multiple issues detected', () => {
    it('reports correct count of issues', () => {
      const dir = createTmpProject({}); // Empty project — many checks fail
      try {
        runDoctor(dir);
        const output = capturedOutput.join('\n');
        assert.ok(output.includes('issue(s) detected'), 'should report issues detected');
        assert.ok(!output.includes('HEALTHY'), 'should not be HEALTHY');
      } finally {
        teardown(dir);
      }
    });
  });
});
