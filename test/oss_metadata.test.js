const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const pkg = require(path.join(ROOT, 'package.json'));

describe('open source project metadata', () => {
  it('ships a LICENSE whose type matches package.json', () => {
    assert.ok(exists('LICENSE'), 'LICENSE is missing');
    assert.strictEqual(pkg.license, 'MIT');
    assert.match(read('LICENSE'), /^MIT License\n\nCopyright \(c\) \d{4} /);
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
    assert.match(read('CHANGELOG.md'), /## \[Unreleased\][\s\S]*BREAKING/);
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
