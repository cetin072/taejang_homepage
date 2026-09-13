const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'app', 'assets', 'mobile-sidebar-dismiss.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'assets', 'app-ui.js'), 'utf8');

test('mobile sidebar dismiss module is loaded', () => {
  assert.match(loader, /mobile-sidebar-dismiss\.js/);
});

test('outside tap closes the open mobile sidebar without activating underlying content', () => {
  assert.match(ui, /max-width: 900px/);
  assert.match(ui, /sidebar-open/);
  assert.match(ui, /app-sidebar/);
  assert.match(ui, /sidebar-toggle/);
  assert.match(ui, /sidebar\?\.contains\(target\)/);
  assert.match(ui, /toggle\?\.contains\(target\)/);
  assert.match(ui, /classList\.remove\('sidebar-open'\)/);
  assert.match(ui, /preventDefault\(\)/);
  assert.match(ui, /stopImmediatePropagation\(\)/);
  assert.match(ui, /aria-expanded', 'false/);
});

test('escape key can close the mobile sidebar', () => {
  assert.match(ui, /event\.key !== 'Escape'/);
  assert.match(ui, /sidebar-toggle'\)\?\.focus\(\)/);
});
