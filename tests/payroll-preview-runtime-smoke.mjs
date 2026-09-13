#!/usr/bin/env node

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

const STAGING_REF = 'jgsxpdflgkqroecfjzxq';
const rawBase = String(process.env.PAYROLL_PREVIEW_URL || '').trim();
assert.match(rawBase, /^https:\/\/deploy-preview-\d+--taejang-homepage\.netlify\.app\/?$/i, 'PAYROLL_PREVIEW_URL must be a Taejang Netlify Deploy Preview URL');
const base = rawBase.replace(/\/$/, '');

async function fetchReady(path, { attempts = 36, delayMs = 5000 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, {
        cache: 'no-store',
        redirect: 'follow',
        headers: { 'User-Agent': 'taejang-payroll-preview-qa/1.0' },
      });
      if (response.ok) return response;
      lastError = new Error(`${path} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw lastError || new Error(`${path} did not become ready`);
}

function assertStayedOnPreview(response, label) {
  const finalUrl = new URL(response.url);
  assert.equal(finalUrl.origin, base, `${label} must not redirect from Deploy Preview to another origin`);
}

const liveResponse = await fetchReady('/app/payroll/live.html?month=2026-09');
assertStayedOnPreview(liveResponse, 'payroll live page');
const liveHtml = await liveResponse.text();
assert.match(liveHtml, /id="payroll-attendance-editor"/, 'Deploy Preview must contain the attendance editor');
assert.match(liveHtml, /id="payroll-live-export"/, 'Deploy Preview must contain payroll XLSX export');
assert.match(liveHtml, /payroll-attendance-editor\.js/, 'Deploy Preview must load attendance editor JS');
assert.match(liveHtml, /payroll-operator-live\.js/, 'Deploy Preview must load payroll ledger JS');

for (const path of [
  '/app/assets/payroll-attendance-editor.js',
  '/app/assets/payroll-operator-live.js',
  '/app/assets/payroll-ledger-xlsx.js',
  '/app/assets/payroll-attendance-editor.css',
]) {
  const response = await fetchReady(path, { attempts: 3, delayMs: 1000 });
  assertStayedOnPreview(response, path);
  const body = await response.text();
  assert.ok(body.length > 100, `${path} must contain a real built asset`);
}

const configResponse = await fetchReady('/.netlify/functions/staff-config', { attempts: 12, delayMs: 2500 });
assertStayedOnPreview(configResponse, 'staff-config');
const config = await configResponse.json();
assert.equal(config.url, `https://${STAGING_REF}.supabase.co`, 'Deploy Preview must point staff runtime at Taejang Staging Supabase');
assert.ok(config.publishableKey, 'Deploy Preview staff-config must expose a publishable key');
assert.ok(String(config.environmentLabel || '').trim(), 'Deploy Preview must visibly identify itself as a non-production environment');

console.log(`Payroll Deploy Preview runtime PASS: ${base}`);
console.log(`Staging backend boundary PASS: ${config.url} · ${config.environmentLabel}`);
