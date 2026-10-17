/**
 * check_architecture.py (generic Clean Architecture mode): layer detection by
 * path segment, every alias of `import a, b`, relative imports resolved
 * against the file's package, and layer names matched by segment equality.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const GUARD = path.resolve(__dirname, '..', 'tools', 'check_architecture.py');

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** Stage `files` in a fresh repo and run the guard on the index. */
function runOnStaged(files) {
  const dir = createTmpProject({ 'README.md': '# fixture\n' });
  try {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    git(dir, 'add', '-A');
    const res = spawnSync('python3', [GUARD, dir], { cwd: dir, encoding: 'utf-8' });
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.skipped, false, res.stdout);
    return { status: res.status, violations: parsed.data.violations };
  } finally {
    teardown(dir);
  }
}

function assertViolation(files, file, moduleName) {
  const res = runOnStaged(files);
  assert.strictEqual(res.status, 1, `expected a violation: ${JSON.stringify(res.violations)}`);
  const found = (res.violations[file] || []).map((v) => v.module);
  assert.ok(found.includes(moduleName), `expected ${moduleName} in ${JSON.stringify(found)}`);
}

function assertClean(files) {
  const res = runOnStaged(files);
  assert.strictEqual(res.status, 0, `expected no violation: ${JSON.stringify(res.violations)}`);
}

describe('check_architecture.py layer boundaries', () => {
  it('classifies a top-level domain/ package', () => {
    assertViolation({ 'domain/x.py': 'import infrastructure.db\n' }, 'domain/x.py', 'infrastructure.db');
  });

  it('checks every alias of `import a, b`', () => {
    assertViolation({ 'app/domain/x.py': 'import os, infrastructure.db\n' }, 'app/domain/x.py', 'infrastructure.db');
  });

  it('resolves `from ..infrastructure import db` against the package path', () => {
    assertViolation(
      { 'domain/services/x.py': 'from ..infrastructure import db\n' },
      'domain/services/x.py',
      'domain.infrastructure',
    );
  });

  it('resolves `from .. import infrastructure`', () => {
    assertViolation(
      { 'domain/services/x.py': 'from .. import infrastructure\n' },
      'domain/services/x.py',
      'domain.infrastructure',
    );
  });

  it('does not take modules that merely start with a layer name (apispec)', () => {
    assertClean({ 'app/domain/x.py': 'import apispec\nimport applicationinsights\n' });
  });

  it('does not flag a project whose root package is named like a layer', () => {
    assertClean({ 'api/domain/x.py': 'from api.domain.entities import E\nfrom .entities import F\n' });
  });

  it('keeps the allowed directions passing', () => {
    assertClean({
      'app/application/use.py': 'from app.domain.model import User\n',
      'app/infrastructure/repo.py': 'from app.domain.model import User\nfrom app.application.use import run\n',
      'app/api/routes.py': 'from app.application.use import run\n',
      'app/domain/model.py': 'from .entities import E\nimport os\n',
    });
  });

  it('still flags application importing infrastructure', () => {
    assertViolation(
      { 'app/application/use.py': 'from app.infrastructure import db\n' },
      'app/application/use.py',
      'app.infrastructure',
    );
  });
});
