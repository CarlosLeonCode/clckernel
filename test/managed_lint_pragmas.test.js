/**
 * sdds/managed-lint-pragmas: the JS and Python files the kernel owns in a
 * project declare themselves kernel-owned with file-level pragmas, so the
 * project's linters (ESLint, Biome, ruff, flake8, pylint, mypy, isort and the
 * black/ruff formatters) skip them instead of failing the project's hooks on
 * code the project cannot edit. The kernel never edits the project's linter
 * config: the pragmas are written into the files themselves, by the single
 * write point for kernel-owned files (writeManaged in src/io.js), so install
 * and update write the same bytes and the registry hash is what is on disk.
 * Project files (tools/guards/, .clckernel.yaml, AGENTS.md) never get them.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createTmpProject, createGitRepo, teardown, git } = require('./helpers');
const { autoDetectStack } = require('../src/detector');
const { generateHarness } = require('../src/generator');
const { updateHarness } = require('../src/updater');
const { managedHeader, withManagedHeader } = require('../src/managed-header');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = 'tools/.clckernel-managed.json';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const PACKAGE = (pkg) => `${JSON.stringify(pkg, null, 2)}\n`;

const STACKS = {
  'Next.js + TypeScript': {
    'package.json': PACKAGE({ name: 'web', private: true, dependencies: { next: '^16.0.0', react: '^19.0.0' }, devDependencies: { typescript: '^5.0.0' } }),
    'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
  },
  FastAPI: { 'requirements.txt': 'fastapi\n', 'app/__init__.py': '' },
  'FastAPI + Docker + Redis': { 'requirements.txt': 'fastapi\nredis\ncelery\npsycopg2\n', 'app/__init__.py': '', Dockerfile: 'FROM python:3.12\n' },
  Django: { 'requirements.txt': 'django\n', 'app/__init__.py': '' },
  Astro: {
    'package.json': PACKAGE({ name: 'site', private: true, dependencies: { astro: '^4.0.0' } }),
    'astro.config.mjs': 'export default {};\n',
  },
  Go: { 'go.mod': 'module example.com/app\n\ngo 1.21\n', 'main.go': 'package main\n\nfunc main() {}\n' },
  'agent-os': {
    'skills/research/SKILL.md': '---\nname: research\ndescription: Researches a topic.\n---\n# Research\n\nHITL: the operator approves the brief.\n',
    'tools/build_report.js': "const fs = require('fs');\nmodule.exports = fs;\n",
  },
  generic: { 'README.md': '# A project of an unknown stack\n' },
};

const quietly = (fn) => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};

const install = (dir) => quietly(() => generateHarness(dir, autoDetectStack(dir)));
const registry = (dir) => JSON.parse(fs.readFileSync(path.join(dir, REGISTRY), 'utf-8'));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel));
const isCode = (rel) => /\.(?:c|m)?js$|\.py$/.test(rel);

/** The lines a file starts with once a leading shebang is skipped. */
function leadingLines(text, count) {
  const lines = text.split('\n');
  const start = lines[0].startsWith('#!') ? 1 : 0;
  return lines.slice(start, start + count);
}

// ── The header itself ───────────────────────────────────────────────────────

describe('managedHeader / withManagedHeader', () => {
  it('JS files get an ESLint blanket disable, a Biome file suppression and @ts-nocheck', () => {
    const header = managedHeader('tools/audit.js');
    assert.ok(header.some((l) => /^\/\* eslint-disable\b/.test(l)), header.join('\n'));
    assert.ok(header.some((l) => /^\/\/ biome-ignore-all lint: /.test(l)), header.join('\n'));
    assert.ok(header.includes('// @ts-nocheck'), header.join('\n'));
    assert.deepStrictEqual(managedHeader('tools/x.cjs'), header);
    assert.deepStrictEqual(managedHeader('tools/x.mjs'), header);
  });

  it('Python files get ruff, flake8, pylint, mypy, isort and formatter opt-outs', () => {
    const header = managedHeader('tools/audit.py');
    for (const pragma of ['# ruff: noqa', '# flake8: noqa', '# pylint: skip-file', '# mypy: ignore-errors', '# isort: skip_file', '# fmt: off']) {
      assert.ok(header.includes(pragma), `${pragma} missing from:\n${header.join('\n')}`);
    }
  });

  it('other files (hook, package.json, Markdown) get no header and keep their bytes', () => {
    for (const rel of ['.githooks/pre-commit', 'tools/package.json', '.agents/skills/clckernel_cli/SKILL.md']) {
      assert.strictEqual(managedHeader(rel), null, rel);
      const bytes = Buffer.from('content\n');
      assert.ok(withManagedHeader(rel, bytes).equals(bytes), rel);
    }
  });

  it('goes after a shebang, before everything else', () => {
    const out = withManagedHeader('tools/a.js', Buffer.from('#!/usr/bin/env node\nconst a = 1;\n')).toString();
    const header = managedHeader('tools/a.js');
    assert.strictEqual(out, ['#!/usr/bin/env node', ...header, 'const a = 1;', ''].join('\n'));
    const py = withManagedHeader('tools/a.py', Buffer.from('"""Doc."""\nimport os\n')).toString();
    assert.strictEqual(py, [...managedHeader('tools/a.py'), '"""Doc."""', 'import os', ''].join('\n'));
  });

  it('is idempotent: a file that already starts with the header is returned unchanged', () => {
    for (const rel of ['tools/a.js', 'tools/a.py']) {
      for (const source of ['#!/usr/bin/env x\nbody\n', 'body\n']) {
        const once = withManagedHeader(rel, Buffer.from(source));
        assert.ok(withManagedHeader(rel, once).equals(once), `${rel}: ${JSON.stringify(source)}`);
      }
    }
  });
});

// ── Every managed JS/PY file an install writes carries it ───────────────────

describe('install writes the header into every kernel-owned JS/Python file', () => {
  for (const [stack, files] of Object.entries(STACKS)) {
    it(`${stack}: every registered .js/.py starts with the header and the registry hash matches the disk`, () => {
      const dir = createTmpProject(files);
      try {
        install(dir);
        const entries = registry(dir).files;
        const code = entries.filter((e) => isCode(e.path));
        assert.ok(code.length > 0, `${stack}: no JS/PY kernel files installed`);
        for (const entry of entries) {
          const bytes = read(dir, entry.path);
          assert.strictEqual(sha(bytes), entry.sha256, `${entry.path}: registry hash differs from the disk`);
          if (!isCode(entry.path)) continue;
          const header = managedHeader(entry.path);
          assert.deepStrictEqual(leadingLines(bytes.toString('utf-8'), header.length), header, entry.path);
        }
      } finally {
        teardown(dir);
      }
    });
  }

  it('the installed tools still run: shebang kept first, audit.js and audit.py load', () => {
    const dir = createGitRepo({ ...STACKS.FastAPI, ...STACKS['Next.js + TypeScript'], 'notes.txt': 'x\n' });
    try {
      install(dir);
      for (const entry of registry(dir).files.filter((e) => isCode(e.path))) {
        const source = fs.readFileSync(path.join(ROOT, entry.path));
        if (source.toString('utf-8').startsWith('#!')) {
          assert.strictEqual(read(dir, entry.path).toString('utf-8').split('\n')[0], source.toString('utf-8').split('\n')[0], entry.path);
        }
      }
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'y\n');
      git(dir, 'add', 'notes.txt');
      for (const [bin, script] of [[process.execPath, 'tools/audit.js'], ['python3', 'tools/audit.py']]) {
        if (!fs.existsSync(path.join(dir, script))) continue;
        const res = spawnSync(bin, [script, '--hook'], { cwd: dir, encoding: 'utf-8' });
        assert.ok(!/SyntaxError|IndentationError/.test(`${res.stdout}${res.stderr}`), `${script}:\n${res.stdout}${res.stderr}`);
      }
    } finally {
      teardown(dir);
    }
  });

  it('project files never get it: tools/guards/, other tools/ files, .clckernel.yaml, AGENTS.md', () => {
    const guardJs = "const fs = require('fs');\nmodule.exports = () => fs;\n";
    const guardPy = 'import os\n\n\ndef check():\n    return os\n';
    const config = 'exclude_paths:\n  - "dist/**"\n';
    const dir = createTmpProject({
      ...STACKS['Next.js + TypeScript'],
      'tools/guards/check_local.js': guardJs,
      'tools/guards/check_local.py': guardPy,
      'tools/build_report.js': guardJs,
      '.clckernel.yaml': config,
    });
    try {
      install(dir);
      assert.strictEqual(read(dir, 'tools/guards/check_local.js').toString(), guardJs);
      assert.strictEqual(read(dir, 'tools/guards/check_local.py').toString(), guardPy);
      assert.strictEqual(read(dir, 'tools/build_report.js').toString(), guardJs);
      assert.strictEqual(read(dir, '.clckernel.yaml').toString(), config);
      assert.ok(!/eslint-disable|ruff: noqa/.test(read(dir, 'AGENTS.md').toString()));
    } finally {
      teardown(dir);
    }
  });
});

// ── install + update are stable ─────────────────────────────────────────────

describe('install and update write the same bytes', () => {
  for (const stack of ['Next.js + TypeScript', 'FastAPI', 'agent-os']) {
    it(`${stack}: an update right after install changes nothing and keeps the registry`, () => {
      const dir = createTmpProject(STACKS[stack]);
      try {
        install(dir);
        const before = registry(dir).files;
        const result = quietly(() => updateHarness(dir));
        assert.deepStrictEqual(result.plan.protected, []);
        const rewritten = result.plan.written.filter((p) => isCode(p));
        assert.deepStrictEqual(rewritten, [], `update rewrote: ${rewritten.join(', ')}`);
        assert.deepStrictEqual(registry(dir).files, before);
      } finally {
        teardown(dir);
      }
    });
  }
});

// ── Moving from 2.0.3 (files without the header) ────────────────────────────

/**
 * Turns a fresh install into what 2.0.3 left: every kernel JS/PY file holds
 * the bundled source bytes (no header). With `registryHashes` the registry
 * vouches for those bytes (2.0.3 wrote a hashed registry); without it the
 * registry is removed (an older install), so only known-hashes can tell.
 */
function as203(dir, { registryHashes }) {
  const reg = registry(dir);
  for (const entry of reg.files.filter((e) => isCode(e.path))) {
    const raw = fs.readFileSync(path.join(ROOT, entry.path));
    fs.writeFileSync(path.join(dir, entry.path), raw);
    entry.sha256 = sha(raw);
  }
  if (registryHashes) fs.writeFileSync(path.join(dir, REGISTRY), JSON.stringify({ ...reg, kernelVersion: '2.0.3' }, null, 2) + '\n');
  else fs.rmSync(path.join(dir, REGISTRY));
  return reg.files.filter((e) => isCode(e.path)).map((e) => e.path);
}

describe('update from a 2.0.3 install adds the header without protecting anything', () => {
  for (const [label, registryHashes] of [['hashed registry', true], ['no registry (known-hashes)', false]]) {
    for (const stack of ['Next.js + TypeScript', 'FastAPI + Docker + Redis']) {
      it(`${stack}, ${label}: kernel files are rewritten with the header, no .clckernel-new`, () => {
        const dir = createTmpProject(STACKS[stack]);
        try {
          install(dir);
          const paths = as203(dir, { registryHashes });
          const result = quietly(() => updateHarness(dir));
          assert.deepStrictEqual(result.plan.protected, []);
          for (const rel of paths) {
            assert.ok(!fs.existsSync(path.join(dir, `${rel}.clckernel-new`)), `${rel}.clckernel-new`);
            const expected = withManagedHeader(rel, fs.readFileSync(path.join(ROOT, rel)));
            assert.ok(read(dir, rel).equals(expected), `${rel} was not rewritten with the header`);
          }
          const hashes = new Map(registry(dir).files.map((e) => [e.path, e.sha256]));
          for (const rel of paths) assert.strictEqual(hashes.get(rel), sha(read(dir, rel)), rel);
        } finally {
          teardown(dir);
        }
      });
    }
  }

  it('a kernel file the project edited is still protected', () => {
    const dir = createTmpProject(STACKS['Next.js + TypeScript']);
    try {
      install(dir);
      as203(dir, { registryHashes: true });
      const edited = `${fs.readFileSync(path.join(dir, 'tools/audit.js'), 'utf-8')}// local edit\n`;
      fs.writeFileSync(path.join(dir, 'tools/audit.js'), edited);
      const result = quietly(() => updateHarness(dir));
      assert.deepStrictEqual(result.plan.protected.map((p) => p.path), ['tools/audit.js']);
      assert.strictEqual(read(dir, 'tools/audit.js').toString(), edited);
      const pending = read(dir, 'tools/audit.js.clckernel-new');
      assert.ok(pending.equals(withManagedHeader('tools/audit.js', fs.readFileSync(path.join(ROOT, 'tools/audit.js')))));
    } finally {
      teardown(dir);
    }
  });

  it('known-hashes lists every shipped JS/PY file with the header too', () => {
    const table = require('../src/known-hashes.json');
    const missing = [];
    for (const name of fs.readdirSync(path.join(ROOT, 'tools'))) {
      const rel = `tools/${name}`;
      if (!isCode(rel)) continue;
      const headed = withManagedHeader(rel, fs.readFileSync(path.join(ROOT, rel)));
      if (!(table[rel] || []).includes(sha(headed))) missing.push(rel);
    }
    assert.deepStrictEqual(missing, [], 'src/known-hashes.json is stale: run `node scripts/build-known-hashes.js`');
  });
});

// ── Kernel guards do not flag the pragmas ───────────────────────────────────

describe('a project rule against lint-disable pragmas', () => {
  it('flags the project\'s own files, never the kernel-owned ones', () => {
    const dir = createGitRepo({ ...STACKS['Next.js + TypeScript'], 'src/app.ts': 'export const a = 1;\n' });
    try {
      install(dir);
      fs.writeFileSync(path.join(dir, '.clckernel.yaml'), [
        'rules:',
        '  - name: no-lint-disable',
        // Bracketed letters so the rule does not match its own config line.
        '    pattern: "eslint-disab[l]e|no[q]a|ts-noch[e]ck"',
        '    message: Fix the finding instead of disabling the linter',
        '    severity: error',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'src/app.ts'), '/* eslint-disable */\nexport const a = 1;\n');
      git(dir, 'add', '-A');
      const res = spawnSync(process.execPath, ['tools/check_custom.js', dir], { cwd: dir, encoding: 'utf-8' });
      const result = JSON.parse(res.stdout);
      assert.deepStrictEqual(Object.keys(result.data.violations), ['src/app.ts'], res.stdout);
    } finally {
      teardown(dir);
    }
  });
});

// ── The shipped sources are clean under strict default lint rules ───────────

const shipped = (ext) => fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith(ext)).map((f) => `tools/${f}`);

describe('shipped tools have no findings the common default rule sets report', () => {
  it('JS: no local named `module`, unused top-level constants, empty blocks, irregular whitespace or control chars in regexes', () => {
    const findings = [];
    for (const rel of shipped('.js')) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      text.split('\n').forEach((line, i) => {
        const where = `${rel}:${i + 1}`;
        if (/\b(?:const|let|var)\s+module\b/.test(line)) findings.push(`${where} declares a local named module`);
        if (/\b(?:catch|try|finally|else)\b[^{}]*\{\s*\}/.test(line)) findings.push(`${where} empty block`);
        if (/[\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(line)) findings.push(`${where} irregular whitespace`);
        if (/\/[^/\n]*\\x(?:0[0-9a-f]|1[0-9a-f])[^/\n]*\/[gimsuy]*/i.test(line)) findings.push(`${where} control character in a regex`);
      });
      for (const [, name] of text.matchAll(/^const ([A-Z][A-Z0-9_]*) =/gm)) {
        if ((text.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length === 1) findings.push(`${rel}: ${name} is never used`);
      }
    }
    assert.deepStrictEqual(findings, []);
  });

  it('Python: no unused imports, f-strings without placeholders or ambiguous names (pyflakes F401/F541, E741)', () => {
    const script = [
      'import ast, json, sys',
      'out = []',
      'for path in sys.argv[1:]:',
      '    tree = ast.parse(open(path, encoding="utf-8").read())',
      '    used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}',
      '    used |= {n.value.id for n in ast.walk(tree) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)}',
      '    exported = set()',
      '    for n in ast.walk(tree):',
      '        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in n.targets):',
      '            exported |= {e.value for e in getattr(n.value, "elts", []) if isinstance(e, ast.Constant)}',
      '    for n in tree.body:',
      '        if isinstance(n, (ast.Import, ast.ImportFrom)) and not (isinstance(n, ast.ImportFrom) and n.module == "__future__"):',
      '            for a in n.names:',
      '                name = (a.asname or a.name).split(".")[0]',
      '                if name not in used and name not in exported:',
      '                    out.append(f"{path}:{n.lineno} unused import {name}")',
      '    specs = {id(n.format_spec) for n in ast.walk(tree) if isinstance(n, ast.FormattedValue) and n.format_spec}',
      '    for n in ast.walk(tree):',
      '        if isinstance(n, ast.JoinedStr) and id(n) not in specs and not any(isinstance(v, ast.FormattedValue) for v in n.values):',
      '            out.append(f"{path}:{n.lineno} f-string without placeholders")',
      '        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and n.id in ("l", "O", "I"):',
      '            out.append(f"{path}:{n.lineno} ambiguous variable name {n.id}")',
      'print(json.dumps(out))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', script, ...shipped('.py')], { cwd: ROOT, encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout), []);
  });
});
