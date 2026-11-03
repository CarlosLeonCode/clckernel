const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const pkg = require(path.join(ROOT, 'package.json'));

describe('open source project metadata', () => {
  it('ships the official AGPL-3.0 text as LICENSE, matching package.json', () => {
    assert.ok(exists('LICENSE'), 'LICENSE is missing');
    assert.strictEqual(pkg.license, 'AGPL-3.0-only');
    const bytes = fs.readFileSync(path.join(ROOT, 'LICENSE'));
    assert.ok(bytes.toString('utf-8').trimStart().startsWith('GNU AFFERO GENERAL PUBLIC LICENSE'));
    // sha256 of https://www.gnu.org/licenses/agpl-3.0.txt, copied byte for byte.
    assert.strictEqual(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0',
    );
  });

  it('ships the notice, the Installed Files exception and the trademark policy', () => {
    for (const rel of ['NOTICE', 'LICENSE-EXCEPTION.md', 'TRADEMARKS.md']) {
      assert.ok(exists(rel), `${rel} is missing`);
      assert.ok(pkg.files.includes(rel), `${rel} is not in package.json files`);
    }
    const notice = read('NOTICE');
    assert.match(notice, /Copyright \(C\) 2025-2026 CarlosLeonCode/);
    assert.match(notice, /GNU Affero General Public License/);
    assert.match(notice, /WITHOUT ANY WARRANTY/);
    assert.match(notice, /2\.0\.4[^\n]*\n?[^\n]*MIT License/);
    const exception = read('LICENSE-EXCEPTION.md');
    assert.match(exception, /section 7/i);
    assert.match(exception, /Installed Files/);
    assert.match(exception, /not legal advice/i);
    assert.match(read('TRADEMARKS.md'), /images\/brand/);
    assert.ok(exists('website/public/images/brand/README.md'));
    assert.match(read('website/public/images/brand/README.md'), /TRADEMARKS\.md/);
  });

  it('declares the website package as private AGPL-3.0-only', () => {
    const site = require(path.join(ROOT, 'website', 'package.json'));
    assert.strictEqual(site.license, 'AGPL-3.0-only');
    assert.strictEqual(site.private, true);
  });

  it('links the exception and trademark policy from both READMEs and keeps the MIT history note', () => {
    for (const readme of ['README.md', 'README.es.md']) {
      const text = read(readme);
      for (const doc of ['LICENSE-EXCEPTION.md', 'TRADEMARKS.md']) {
        assert.ok(text.includes(doc), `${readme} does not link ${doc}`);
      }
      assert.match(text, /License-AGPL--3\.0/, `${readme} lacks the AGPL-3.0 badge`);
      const lines = text.split('\n').filter((l) => /\bMIT\b/.test(l));
      assert.ok(lines.length >= 1, `${readme} lacks the historical MIT note`);
      for (const l of lines) assert.match(l, /2\.0\.4/, `${readme}: unexpected MIT mention: ${l}`);
    }
  });

  it('mentions no MIT license on the website sources', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    for (const file of walk(path.join(ROOT, 'website', 'src'))) {
      const text = fs.readFileSync(file, 'utf-8');
      assert.ok(!/\bMIT\b/.test(text), `${path.relative(ROOT, file)} still mentions MIT`);
    }
  });

  it('asks contributors for a DCO sign-off under AGPL-3.0-only', () => {
    const contributing = read('CONTRIBUTING.md');
    assert.match(contributing, /AGPL-3\.0-only/);
    assert.match(contributing, /Developer Certificate of Origin/);
    assert.match(contributing, /git commit -s/);
    assert.match(read('.github/PULL_REQUEST_TEMPLATE.md'), /Signed-off-by/);
    assert.match(read('CHANGELOG.md'), /relicensed from MIT to AGPL-3\.0-only/i);
  });

  it('declares where the source, issues and homepage live', () => {
    assert.match(pkg.repository && pkg.repository.url, /github\.com\/CarlosLeonCode\//);
    assert.match(pkg.bugs && pkg.bugs.url, /github\.com\/CarlosLeonCode\/.+\/issues$/);
    assert.match(pkg.homepage, /^https:\/\//);
  });

  for (const doc of ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'CHANGELOG.md']) {
    it(`has ${doc}`, () => assert.ok(exists(doc), `${doc} is missing`));
  }

  it('records the breaking YAML change in the changelog', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /^## \[Unreleased\]$/m);
    assert.match(changelog, /^## \[2\.0\.0\] - \d{4}-\d{2}-\d{2}\n\n### ⚠ BREAKING CHANGES/m);
    assert.match(changelog, /^\[2\.0\.0\]: https:\/\/github\.com\/CarlosLeonCode\/clc_forge\/compare\/v1\.2\.19\.\.\.v2\.0\.0$/m);
  });

  it('has GitHub issue and pull request templates', () => {
    for (const rel of [
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/feature_request.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/PULL_REQUEST_TEMPLATE.md',
    ]) {
      assert.ok(exists(rel), `${rel} is missing`);
    }
  });

  it('keeps dependencies and workflows updated automatically', () => {
    const cfg = read('.github/dependabot.yml');
    for (const eco of ['npm', 'github-actions']) {
      assert.match(cfg, new RegExp(`package-ecosystem:\\s*["']?${eco}`));
    }
  });

  it('links the community docs from both READMEs', () => {
    for (const readme of ['README.md', 'README.es.md']) {
      const text = read(readme);
      for (const doc of ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'LICENSE']) {
        assert.ok(text.includes(doc), `${readme} does not link ${doc}`);
      }
    }
  });

  it('publishes the license and changelog with the npm package', () => {
    assert.ok(pkg.files.includes('LICENSE'));
    assert.ok(pkg.files.includes('CHANGELOG.md'));
  });
});
