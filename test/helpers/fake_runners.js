#!/usr/bin/env node
/**
 * Fake test runners for test/verify_tdd_other_stacks.test.js (sdds/tdd-other-stacks).
 * Installed under the names go, cargo, bundle, phpunit and pest; the behavior is
 * chosen by the name it is invoked as. A test file passes when every
 * `NEEDS <file> <token>` marker it holds finds <token> in <file> (relative to
 * the cwd, the project root in the temporary tree); each `CASE <name>` marker is
 * one test. Each fake prints the summary format of the real runner.
 */
const fs = require('fs');
const path = require('path');

const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);

function evaluate(file) {
  const text = fs.readFileSync(file, 'utf-8');
  const cases = [...text.matchAll(/\bCASE (\S+)/g)].map((m) => m[1]);
  let ok = true;
  for (const m of text.matchAll(/\bNEEDS (\S+) (\S+)/g)) {
    let content = '';
    try { content = fs.readFileSync(m[1], 'utf-8'); } catch { /* missing file: the need is unmet */ }
    if (!content.includes(m[2])) ok = false;
  }
  return { cases, ok };
}

function same(a, b) {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
}

function go() {
  const pkgs = args.filter((a) => a === '.' || a.startsWith('./'));
  let failed = false;
  for (const pkg of pkgs) {
    const dir = pkg === '.' ? '.' : pkg.slice(2);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('_test.go'));
    if (files.length === 0) {
      console.log(`?   \texample.com/${dir}\t[no test files]`);
      continue;
    }
    let pkgFailed = false;
    for (const f of files) {
      const { cases, ok } = evaluate(path.join(dir, f));
      for (const c of cases) {
        console.log(`=== RUN   ${c}`);
        console.log(`--- ${ok ? 'PASS' : 'FAIL'}: ${c} (0.00s)`);
      }
      if (!ok) pkgFailed = true;
    }
    console.log(pkgFailed ? `FAIL\texample.com/${dir}\t0.01s` : `ok  \texample.com/${dir}\t0.01s`);
    failed = failed || pkgFailed;
  }
  process.exit(failed ? 1 : 0);
}

function cargo() {
  const target = process.env.CARGO_TARGET_DIR;
  if (!target || path.resolve(target).startsWith(fs.realpathSync(process.cwd()))) {
    console.error(`FAKE-CARGO: CARGO_TARGET_DIR must be set outside the tree (got ${target})`);
    process.exit(2);
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'fake-cargo-was-here'), 'x');
  let failed = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '--test') continue;
    const name = args[i + 1];
    const file = fs.existsSync(path.join('tests', `${name}.rs`)) ? path.join('tests', `${name}.rs`) : path.join('tests', name, 'main.rs');
    const { cases, ok } = evaluate(file);
    console.log(`     Running tests/${name}.rs`);
    console.log(`\nrunning ${cases.length} test${cases.length === 1 ? '' : 's'}`);
    for (const c of cases) console.log(`test ${c} ... ${ok ? 'ok' : 'FAILED'}`);
    console.log(`\ntest result: ${ok ? 'ok' : 'FAILED'}. ${ok ? cases.length : 0} passed; ${ok ? 0 : cases.length} failed`);
    failed = failed || !ok;
  }
  process.exit(failed ? 101 : 0);
}

function bundle() {
  if (!same(process.env.BUNDLE_GEMFILE || '', path.join(process.cwd(), 'Gemfile'))) {
    console.error(`FAKE-BUNDLE: BUNDLE_GEMFILE must be the tree's Gemfile (got ${process.env.BUNDLE_GEMFILE})`);
    process.exit(2);
  }
  const rspec = args[1] === 'rspec';
  const files = rspec ? args.slice(2) : args.slice(args.indexOf('-e') + 2);
  let total = 0;
  let failures = 0;
  for (const f of files) {
    const { cases, ok } = evaluate(f);
    total += cases.length;
    if (!ok) failures += Math.max(cases.length, 1);
  }
  console.log(rspec
    ? `${total} examples, ${failures} failures`
    : `${total} runs, ${total} assertions, ${failures} failures, 0 errors, 0 skips`);
  process.exit(failures > 0 ? 1 : 0);
}

function php(pest) {
  for (const rel of ['vendor/autoload.php', 'vendor/composer', 'vendor/bin']) {
    if (fs.lstatSync(rel).isSymbolicLink()) {
      console.error(`FAKE-PHP: ${rel} must be a real copy, not a symlink`);
      process.exit(2);
    }
  }
  if (!pest && args.length !== 1) {
    console.error('FAKE-PHPUNIT: exactly one test path');
    process.exit(2);
  }
  let total = 0;
  let failed = false;
  for (const f of args) {
    const { cases, ok } = evaluate(f);
    total += cases.length;
    failed = failed || !ok;
  }
  if (failed) {
    console.log(pest ? `Tests:    1 failed (${total} assertions)` : `FAILURES!\nTests: ${total}, Assertions: ${total}, Failures: 1.`);
    process.exit(1);
  }
  if (total === 0) {
    console.log(pest ? 'INFO  No tests found.' : 'No tests executed!');
    process.exit(0);
  }
  console.log(pest ? `Tests:    ${total} passed (${total} assertions)` : `OK (${total} tests, ${total} assertions)`);
  process.exit(0);
}

if (tool === 'go') go();
else if (tool === 'cargo') cargo();
else if (tool === 'bundle') bundle();
else if (tool === 'phpunit' || tool === 'pest') php(tool === 'pest');
else {
  console.error(`fake runner: unknown tool ${tool}`);
  process.exit(2);
}
