const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260910084000_support_radar_source_catalog_v1.sql'), 'utf8');

test('verified Phase 1 source catalog includes core official sources', () => {
  ['bizinfo','enaradoom','kead_standard','gyeongnam119'].forEach(code => assert.match(sql, new RegExp(`'${code}'`)));
});

test('source catalog does not activate external ingestion', () => {
  assert.doesNotMatch(sql, /'enabled'/);
  assert.match(sql, /'manual_only'/);
  assert.match(sql, /키 미설정·자동수집 OFF/);
});

test('no API credentials or secrets are embedded in the source catalog', () => {
  assert.doesNotMatch(sql, /crtfcKey\s*=|service[_-]?key\s*=|bearer\s+[a-z0-9]/i);
});

test('catalog preserves later operator edits on repeated migrations', () => {
  assert.match(sql, /on conflict \(code\) do nothing/i);
});
