const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'app', 'assets');
const access = fs.readFileSync(path.join(assets, 'support-radar-access.js'), 'utf8');
const appUi = fs.readFileSync(path.join(assets, 'app-ui.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260911150000_support_radar_capability_contract.sql'), 'utf8');
const featureFiles = fs.readdirSync(assets).filter(name => /^support-radar.*\.js$/.test(name) && name !== 'support-radar-access.js');

test('Support Radar centralizes management and assigned-work capability checks', () => {
  for (const capability of ['support_radar.management_view', 'support_radar.management_edit', 'support_radar.assigned_work']) {
    assert.match(access, new RegExp(capability.replace('.', '\\.')));
    assert.match(migration, new RegExp(capability.replace('.', '\\.')));
  }
  assert.ok(appUi.indexOf('support-radar-access.js') < appUi.indexOf("support-radar.js'"));
  assert.match(migration, /\('ceo', 'support_radar\.management_view'\)/);
  assert.doesNotMatch(migration, /\('ceo', 'support_radar\.management_edit'\)/);
});

test('Support Radar feature modules use explicit render lifecycle without DOM observers', () => {
  for (const file of featureFiles) {
    const source = fs.readFileSync(path.join(assets, file), 'utf8');
    assert.doesNotMatch(source, /MutationObserver/, `${file} must not observe and mutate its own surface`);
    assert.doesNotMatch(source, /getRoute\?\./, `${file} must use the shared Support Radar access helper`);
  }
  assert.match(access, /taejang-support-radar-rendered/);
});
