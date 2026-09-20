#!/usr/bin/env node

// Real hosted regression for Issue #301.  It has deliberately no fixture,
// password, screenshot/video/trace-on-success, or payroll-value logging.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SITE = 'https://taejang.co.kr';
const STAGING_REF = 'jgsxpdflgkqroecfjzxq';
const MONTH = '2026-07';
const EMPLOYEE_ID = 'TJ-000017';
const handoffCode = process.env.PAYROLL_HOSTED_HANDOFF_CODE;

function fail(message) { throw new Error(`PAYROLL_HOSTED_E2E: ${message}`); }
function required(value, label) { if (!value) fail(`${label} is required and is never printed`); return value; }
function safeCode(value) { return String(value?.code || value?.error || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80) || 'UNKNOWN'; }
function jwtSubject(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub || null; }
  catch { return null; }
}
async function json(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) fail(`${label} HTTP_${response.status} ${safeCode(body)}`);
  return body;
}

async function runtimeConfig() {
  const config = await json(await fetch(`${SITE}/.netlify/functions/staff-config`, { cache: 'no-store' }), 'staff-config');
  if (config?.url !== `https://${STAGING_REF}.supabase.co` || !config?.publishableKey) fail('TARGET_NOT_APPROVED_STAGING');
  return config;
}

async function freshQaSession(config) {
  const code = required(handoffCode, 'PAYROLL_HOSTED_HANDOFF_CODE');
  if (!/^[0-9a-f]{64}$/i.test(code)) fail('PAYROLL_HOSTED_HANDOFF_CODE_INVALID');
  const preview = await json(await fetch(`${config.url}/functions/v1/web-auth-handoff`, {
    method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }), 'web-auth-handoff');
  const verified = await json(await fetch(`${config.url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_hash: preview.token_hash, type: preview.type || 'email' }),
  }), 'qa-session-verify');
  if (!verified?.access_token) fail('QA_SESSION_NOT_CREATED');
  return verified;
}

async function rpc(config, session, name, body) {
  return json(await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), `rpc-${name}`);
}

async function apiSmoke(config, session) {
  const payrollMonth = `${MONTH}-01`;
  const readiness = await rpc(config, session, 'get_payroll_confirmed_attendance_readiness', { p_payroll_month: payrollMonth, p_cutoff_date: '2026-07-31' });
  assert.equal(readiness?.ready, true, 'confirmed attendance readiness must be ready');
  assert.equal(Array.isArray(readiness?.blockers) ? readiness.blockers.length : -1, 0, 'readiness blockers must be zero');
  const input = await rpc(config, session, 'get_payroll_calculation_input', { p_payroll_month: payrollMonth, p_cutoff_date: '2026-07-31', p_expected_batch_id: null });
  const canonicalEmployee = input?.employees?.find((row) => row?.employee_id === EMPLOYEE_ID);
  assert.ok(canonicalEmployee?.employee_uuid, 'TJ-000017 must be present in canonical payroll employees');
  const absence = input?.attendance?.find((row) => row?.employee_uuid === canonicalEmployee.employee_uuid && row?.work_date === '2026-07-01');
  assert.equal(absence?.auto_decision, 'unpaid_absence', 'July 1 must reach canonical input as unpaid_absence');
  const calculation = await json(await fetch(`${SITE}/api/payroll-calculate`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payroll_month: payrollMonth, cutoff_date: '2026-07-31', request_id: `issue-301-api-${Date.now()}` }),
  }), 'payroll-proxy');
  if (safeCode(calculation) === 'WORKER_ERROR' || safeCode(calculation) === 'PAYROLL_MONTH_NOT_FOUND') fail(`payroll-proxy ${safeCode(calculation)}`);
  assert.equal(calculation?.persisted, true, 'calculation must persist through the trusted run RPC');
  assert.ok(calculation?.runId, 'payroll calculation must return its persisted run identifier');
  const ledger = await rpc(config, session, 'get_payroll_operator_ledger_context', { p_payroll_month: payrollMonth });
  assert.ok(ledger?.latest_run?.id && ledger?.month?.latest_run_id, 'persisted payroll run and latest pointer required');
  assert.ok(Array.isArray(ledger?.employees) && ledger.employees.length > 0, 'employee results required');
  const employee = ledger.employees.find((row) => row?.employee_id === EMPLOYEE_ID);
  assert.ok(employee, 'TJ-000017 ledger result required');
  assert.equal(Number(employee.absence_day_count), 1, 'TJ-000017 must have one absence day');
  const payslip = await rpc(config, session, 'get_payroll_employee_payslip_draft', { p_payroll_month: payrollMonth, p_employee_uuid: employee.employee_uuid });
  assert.ok(payslip?.employee?.employee_id === EMPLOYEE_ID, 'payslip draft must return the persisted employee result');
  console.log('Staging API smoke: PASS');
}

async function browserE2E(session) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const failures = [];
  page.on('console', (entry) => {
    const message = entry.text();
    if (entry.type() === 'error' && !/^Failed to load resource: the server responded with a status of 404/.test(message)) {
      failures.push(`console:${message.slice(0, 120)}`);
    }
  });
  page.on('response', async (response) => {
    const url = response.url();
    if (response.status() >= 400 && (/\/api\/payroll-calculate|\/rest\/v1\/rpc\/(get_payroll_|private_)/).test(url)) failures.push(`network:${response.request().method()} ${response.status()} ${new URL(url).pathname}`);
  });
  try {
    await page.goto(`${SITE}/app/payroll/live.html?month=${MONTH}`, { waitUntil: 'networkidle' });
    await page.evaluate((value) => sessionStorage.setItem('taejang-staff-session-v1', JSON.stringify(value)), session);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#payroll-readiness-state').getByText('확정 근태 준비 완료').waitFor();
    await page.locator('#payroll-confirmed-calculate').click();
    await page.locator('#payroll-live-table-body tr').first().waitFor();
    const employee = page.locator('#payroll-live-table-body tr').filter({ hasText: EMPLOYEE_ID });
    assert.ok(await employee.getByText('1일', { exact: true }).count() >= 1, 'TJ-000017 must display at least one one-day absence value');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#payroll-live-export').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.xlsx$/i, 'Excel filename');
    const saved = join(await mkdtemp(join(tmpdir(), 'taejang-payroll-')), download.suggestedFilename());
    await download.saveAs(saved);
    assert.ok((await stat(saved)).size > 0, 'Excel file must be non-empty');
    assert.equal((await readFile(saved)).subarray(0, 2).toString(), 'PK', 'Excel must be a ZIP/XLSX payload');
    await Promise.all([page.waitForURL(/\/app\/payroll\/payslip\.html/), employee.getByRole('button', { name: '명세서 초안' }).click()]);
    for (const id of ['payslip-content', 'payslip-status', 'payslip-employee', 'payslip-work', 'payslip-earnings', 'payslip-deductions']) await page.locator(`#${id}`).waitFor();
    assert.equal(await page.locator('#payslip-content').isVisible(), true, 'payslip content visible');
    if (failures.length) fail(failures.join(' | '));
    console.log('Hosted browser: PASS');
  } catch (error) {
    const artifact = join(await mkdtemp(join(tmpdir(), 'taejang-payroll-failure-')), 'failure.png');
    await page.screenshot({ path: artifact, fullPage: true }).catch(() => {});
    console.error(`Hosted browser failure artifact: ${artifact}`);
    throw error;
  } finally { await browser.close(); }
}

if (process.env.STAGING_CONFIRM !== 'STAGING') fail('set STAGING_CONFIRM=STAGING before this mutating staging-only test');
const config = await runtimeConfig();
const smokeSession = await freshQaSession(config);
await apiSmoke(config, smokeSession);
await browserE2E(smokeSession);
console.log('Hosted Payroll E2E: PASS');
