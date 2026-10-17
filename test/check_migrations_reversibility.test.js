/**
 * check_migrations.py judges reversibility from the AST: a destructive op in
 * upgrade() needs a matching create/add op in downgrade(); Django
 * RunPython/RunSQL are reversible when a reverse is passed positionally or by
 * keyword.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createTmpProject, teardown } = require('./helpers');

const GUARD = path.resolve(__dirname, '..', 'tools', 'check_migrations.py');

function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** Stage one migration file in a fresh repo; returns the guard's rules for it. */
function rulesFor(rel, content) {
  const dir = createTmpProject({ 'README.md': '# fixture\n' });
  try {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
    git(dir, 'add', '-A');
    const res = spawnSync('python3', [GUARD, dir], { cwd: dir, encoding: 'utf-8' });
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.skipped, false, res.stdout);
    const rules = (parsed.data.violations[rel] || []).map((v) => v.rule);
    assert.strictEqual(res.status, rules.length ? 1 : 0, res.stdout);
    return rules;
  } finally {
    teardown(dir);
  }
}

const ALEMBIC = 'alembic/versions/0002_change.py';

function alembic(upgrade, downgrade) {
  return [
    'from alembic import op',
    'import sqlalchemy as sa',
    '',
    '',
    'def upgrade():',
    ...upgrade.map((l) => `    ${l}`),
    '',
    '',
    'def downgrade():',
    ...downgrade.map((l) => `    ${l}`),
    '',
  ].join('\n');
}

describe('check_migrations.py — Alembic', () => {
  it('accepts upgrade dropping a column when downgrade re-adds it', () => {
    const src = alembic(
      ['op.drop_column("users", "nick")'],
      ['op.add_column("users", sa.Column("nick", sa.String()))'],
    );
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), []);
  });

  it('accepts a batch drop_column reversed by a batch add_column', () => {
    const src = alembic(
      ['with op.batch_alter_table("users") as batch:', '    batch.drop_column("nick")'],
      ['with op.batch_alter_table("users") as batch:', '    batch.add_column(sa.Column("nick", sa.String()))'],
    );
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), []);
  });

  it('accepts create in upgrade and drop in downgrade', () => {
    const src = alembic(['op.create_table("t", sa.Column("id", sa.Integer()))'], ['op.drop_table("t")']);
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), []);
  });

  it('flags a destructive upgrade even when downgrade also drops', () => {
    const src = alembic(['op.drop_table("legacy")'], ['op.drop_table("legacy")']);
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), ['destructive-drop_table']);
  });

  it('flags a drop when downgrade is `pass`', () => {
    const src = alembic(['op.drop_column("users", "nick")'], ['pass']);
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), ['destructive-drop_column']);
  });

  it('flags drop_constraint and drop_index without a recreate', () => {
    const src = alembic(
      ['op.drop_constraint("fk_a", "users")', 'op.drop_index("ix_a")'],
      ['pass'],
    );
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), ['destructive-drop_constraint', 'destructive-drop_index']);
  });

  it('accepts drop_constraint reversed by create_foreign_key', () => {
    const src = alembic(
      ['op.drop_constraint("fk_a", "users", type_="foreignkey")'],
      ['op.create_foreign_key("fk_a", "users", "orgs", ["org_id"], ["id"])'],
    );
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), []);
  });

  it('still requires upgrade() and downgrade()', () => {
    const src = 'from alembic import op\n\n\ndef upgrade():\n    op.drop_table("t")\n';
    assert.deepStrictEqual(rulesFor(ALEMBIC, src), ['missing-downgrade', 'destructive-drop_table']);
  });
});

const DJANGO = 'shop/migrations/0002_data.py';

function django(op) {
  return [
    'from django.db import migrations',
    '',
    '',
    'def forwards(apps, schema_editor):',
    '    pass',
    '',
    '',
    'def backwards(apps, schema_editor):',
    '    pass',
    '',
    '',
    'class Migration(migrations.Migration):',
    `    operations = [${op}]`,
    '',
  ].join('\n');
}

describe('check_migrations.py — Django', () => {
  it('accepts RunPython with a positional reverse function', () => {
    assert.deepStrictEqual(rulesFor(DJANGO, django('migrations.RunPython(forwards, backwards)')), []);
  });

  it('accepts RunPython with reverse_code=', () => {
    assert.deepStrictEqual(rulesFor(DJANGO, django('migrations.RunPython(forwards, reverse_code=backwards)')), []);
  });

  it('flags RunPython without a reverse', () => {
    assert.deepStrictEqual(rulesFor(DJANGO, django('migrations.RunPython(forwards)')), ['run-python-no-reverse']);
  });

  it('accepts RunSQL with a positional reverse_sql', () => {
    assert.deepStrictEqual(rulesFor(DJANGO, django('migrations.RunSQL("SELECT 1", "SELECT 2")')), []);
  });

  it('accepts RunSQL whose arguments contain parentheses', () => {
    assert.deepStrictEqual(
      rulesFor(DJANGO, django('migrations.RunSQL(sql=str("SELECT 1"), reverse_sql=str("SELECT 2"))')),
      [],
    );
  });

  it('flags RunSQL without a reverse', () => {
    assert.deepStrictEqual(rulesFor(DJANGO, django('migrations.RunSQL("SELECT 1")')), ['run-sql-no-reverse']);
  });
});
