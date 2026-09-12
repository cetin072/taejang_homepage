const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const topbar = fs.readFileSync(path.join(root, 'app', 'assets', 'phase-c-account-topbar.js'), 'utf8');
const previewPage = fs.readFileSync(path.join(root, 'app', 'qa-account-preview.html'), 'utf8');

test('real employee preview keeps a return control inside the actual employee app', () => {
  assert.match(topbar, /taejang-qa-account-preview-v1/);
  assert.match(topbar, /data-qa-account-return/);
  assert.match(topbar, /내 계정으로 돌아가기/);
  assert.match(topbar, /window\.parent\s*===\s*window/);
  assert.match(topbar, /parent.*document.*getElementById\('qa-close'\)/s);
  assert.match(topbar, /window\.top\?\.close\(\)/);
});

test('employee preview return control is limited to local or deploy-preview contexts', () => {
  assert.match(topbar, /host\s*===\s*'localhost'/);
  assert.match(topbar, /host\s*===\s*'127\.0\.0\.1'/);
  assert.match(topbar, /host\.startsWith\('deploy-preview-'\)/);
  assert.match(topbar, /host\.endsWith\('--taejang-homepage\.netlify\.app'\)/);
  assert.doesNotMatch(topbar, /host\s*===\s*'taejang-homepage\.netlify\.app'/);
});

test('mobile actual employee app keeps the return action visible and touchable', () => {
  assert.match(topbar, /@media \(max-width: 900px\)[\s\S]*\[data-qa-account-return\]/);
  assert.match(topbar, /\[data-qa-account-return\][\s\S]*min-height:\s*44px/);
  assert.match(topbar, /background:\s*#174f38/);
});

test('inner app return delegates to the isolated preview wrapper instead of replacing the operator session', () => {
  assert.match(previewPage, /id="qa-close">내 계정으로 돌아가기<\/button>/);
  assert.match(previewPage, /function closePreview\(\)/);
  assert.match(previewPage, /sessionStorage\.removeItem\(SESSION_KEY\)/);
  assert.match(previewPage, /window\.close\(\)/);
  assert.doesNotMatch(topbar, /sessionStorage\.setItem\('taejang-staff-session-v1'/);
});
