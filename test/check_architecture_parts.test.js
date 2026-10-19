/**
 * sdds/residual-fixes item 3: check_architecture.py decides Django vs Clean
 * Architecture per changed file, from its nearest project root in the
 * snapshot (manage.py / pyproject.toml / setup.cfg / requirements*.txt), so a
 * Django part inside a monorepo gets the Django rules.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const GUARD = path.resolve(__dirname, '..', 'tools', 'check_architecture.py');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env: ENV });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** Commit `base`, stage `staged`, run the guard on the index. */
function run(base, staged) {
  const dir = createTmpProject({ 'README.md': '# fixture\n', ...base });
  try {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    for (const [rel, content] of Object.entries(staged)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    git(dir, 'add', '-A');
    const res = spawnSync('python3', [GUARD, dir], { cwd: dir, encoding: 'utf-8' });
    const parsed = JSON.parse(res.stdout);
    return { status: res.status, violations: parsed.data.violations, raw: res.stdout };
  } finally {
    teardown(dir);
  }
}

const MODELS_IMPORT_VIEWS = 'from shop.views import home\n';
const DOMAIN_IMPORTS_INFRA = 'import infrastructure.db\n';

describe('check_architecture.py: framework per project part (sdds/residual-fixes item 3)', () => {
  it('a Django part in backend/ (backend/manage.py) gets the Django rules', () => {
    const res = run({ 'backend/manage.py': '# django\n' }, { 'backend/shop/models.py': MODELS_IMPORT_VIEWS });
    assert.strictEqual(res.status, 1, res.raw);
    assert.ok(res.violations['backend/shop/models.py'], res.raw);
  });

  it('a Django part detected from apps/api/requirements-dev.txt', () => {
    const res = run({ 'apps/api/requirements-dev.txt': 'Django==4.2\n' }, { 'apps/api/shop/models.py': MODELS_IMPORT_VIEWS });
    assert.strictEqual(res.status, 1, res.raw);
  });

  it('next to it, a FastAPI part keeps the clean-architecture rules', () => {
    const base = {
      'backend/manage.py': '# django\n',
      'api/pyproject.toml': '[project]\nname = "api"\ndependencies = ["fastapi"]\n',
    };
    const res = run(base, {
      'api/domain/x.py': DOMAIN_IMPORTS_INFRA,
      'api/shop/models.py': MODELS_IMPORT_VIEWS,
      'backend/shop/models.py': MODELS_IMPORT_VIEWS,
    });
    assert.strictEqual(res.status, 1, res.raw);
    assert.deepStrictEqual(Object.keys(res.violations).sort(), ['api/domain/x.py', 'backend/shop/models.py'], res.raw);
  });

  it('the nearest root wins: a non-Django part under a Django root is not Django', () => {
    const base = { 'manage.py': '# django\n', 'tools/svc/pyproject.toml': '[project]\nname = "svc"\n' };
    const res = run(base, { 'tools/svc/shop/models.py': MODELS_IMPORT_VIEWS });
    assert.strictEqual(res.status, 0, res.raw);
  });

  it('single stack: a root manage.py is still Django', () => {
    const res = run({ 'manage.py': '# django\n' }, { 'shop/models.py': MODELS_IMPORT_VIEWS });
    assert.strictEqual(res.status, 1, res.raw);
  });

  it('single stack: no marker anywhere is still generic', () => {
    const res = run({}, { 'shop/models.py': MODELS_IMPORT_VIEWS, 'domain/x.py': DOMAIN_IMPORTS_INFRA });
    assert.strictEqual(res.status, 1, res.raw);
    assert.deepStrictEqual(Object.keys(res.violations), ['domain/x.py'], res.raw);
  });
});
