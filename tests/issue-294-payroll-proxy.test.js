'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const live = read('app/assets/payroll-operator-live.js');
const proxy = read('netlify/functions/payroll-calculate-proxy.mjs');
const edge = read('supabase/functions/payroll-calculate/index.ts');

test('browser payroll calculation uses a same-origin proxy instead of cross-origin Supabase fetch', () => {
  assert.match(live, /fetch\('\/api\/payroll-calculate'/);
  const calculateStart = live.indexOf('async function calculateConfirmedPayroll');
  const calculateEnd = live.indexOf('async function loadMonth', calculateStart);
  const calculateBlock = live.slice(calculateStart, calculateEnd);
  assert.doesNotMatch(calculateBlock, /\/functions\/v1\/payroll-calculate/);
  assert.match(calculateBlock, /requestPayrollCalculation/);
});

test('same-origin proxy forwards only the authenticated request to the Supabase payroll function', () => {
  assert.match(proxy, /process\.env\.SUPABASE_URL/);
  assert.match(proxy, /process\.env\.SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(proxy, /Netlify\.env/);
  assert.match(proxy, /\/functions\/v1\/payroll-calculate/);
  assert.match(proxy, /apikey: publishableKey/);
  assert.match(proxy, /Authorization: `Bearer \$\{token\}`/);
  assert.match(proxy, /path: '\/api\/payroll-calculate'/);
  assert.doesNotMatch(proxy, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(proxy, /Access-Control-Allow-Origin/i);
});

test('proxy fails closed for missing auth, oversized requests, or upstream network failures', () => {
  assert.match(proxy, /PAYROLL_AUTH_REQUIRED/);
  assert.match(proxy, /MAX_REQUEST_BYTES = 32 \* 1024/);
  assert.match(proxy, /PAYROLL_REQUEST_TOO_LARGE/);
  assert.match(proxy, /PAYROLL_UPSTREAM_UNAVAILABLE/);
});

test('direct Edge Function keeps strict production origin and header defenses as a fallback', () => {
  assert.match(edge, /OFFICIAL_ALLOWED_ORIGINS/);
  assert.match(edge, /authorization, x-client-info, apikey, content-type/);
  assert.doesNotMatch(edge, /access-control-allow-origin['"]?\s*[:,]\s*['"]\*['"]/i);
});
