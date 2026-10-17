/**
 * check_db_efficiency.py N+1 heuristic: only calls whose receiver looks like
 * an ORM (Django `.objects`, a session/db object, the result of `.query(...)`,
 * or Flask-SQLAlchemy `Model.query`) count as queries inside a loop.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const GUARD = path.resolve(__dirname, '..', 'tools', 'check_db_efficiency.py');

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** Stage svc.py with `body` inside a for-loop; returns its db-query-in-loop line numbers. */
function loopFindings(body) {
  const dir = createTmpProject({ 'README.md': '# fixture\n' });
  try {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const src = ['def f(self, ids, cfg, requests, request, session, db, User):', '    for i in ids:',
      ...body.map((l) => `        ${l}`), ''].join('\n');
    fs.writeFileSync(path.join(dir, 'svc.py'), src);
    git(dir, 'add', '-A');
    const res = spawnSync('python3', [GUARD, dir], { cwd: dir, encoding: 'utf-8' });
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.skipped, false, res.stdout);
    return (parsed.data.violations['svc.py'] || [])
      .filter((v) => v.rule === 'db-query-in-loop')
      .map((v) => v.lineNo);
  } finally {
    teardown(dir);
  }
}

describe('check_db_efficiency.py ORM receivers', () => {
  it('ignores dict.get, requests.get, config.get and other non-ORM calls', () => {
    assert.deepStrictEqual(loopFindings([
      'd = {}',
      'd.get(i)',
      'requests.get("https://example.test")',
      'cfg.get("key")',
      'self.cache.get(i)',
      'os.environ.get("X")',
      'items.filter(i)',
      'list(ids).all()',
      'request.session.get("cart")',
    ]), []);
  });

  it('flags Django manager calls (User.objects.get)', () => {
    assert.deepStrictEqual(loopFindings(['User.objects.get(id=i)']), [3]);
  });

  it('flags a chained Django query once per statement', () => {
    assert.deepStrictEqual(loopFindings(['User.objects.filter(id=i).first()']), [3]);
  });

  it('flags session.query(User).filter(...) once', () => {
    assert.deepStrictEqual(loopFindings(['session.query(User).filter(User.id == i).first()']), [3]);
  });

  it('flags session.get / db.execute / self.session.execute', () => {
    assert.deepStrictEqual(
      loopFindings(['session.get(User, i)', 'db.execute(i)', 'self.session.execute(i)', 'DB_Session.scalars(i)']),
      [3, 4, 5, 6],
    );
  });

  it('flags Flask-SQLAlchemy Model.query.get', () => {
    assert.deepStrictEqual(loopFindings(['User.query.get(i)']), [3]);
  });
});
