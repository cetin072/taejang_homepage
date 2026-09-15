import { stagingConfig, printTarget } from './shared.mjs';

const required = (name) => {
  if (!process.env[name]) throw new Error(`${name} is required and is never printed.`);
  return process.env[name];
};

function executiveEmployeeIds() {
  const values = required('PAYROLL_JULY_EXECUTIVE_EMPLOYEE_UUIDS')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.length !== 2 || new Set(values).size !== 2 || values.some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))) {
    throw new Error('PAYROLL_JULY_EXECUTIVE_EMPLOYEE_UUIDS must contain exactly two distinct canonical UUIDs and is never printed.');
  }
  return values;
}

async function databaseQuery(config, accessToken, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${config.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!response.ok) throw new Error(`July executive-lane verification query failed (${response.status}) without exposing credentials.`);
  return response.json();
}

function resultRows(result) {
  return Array.isArray(result) ? result : result?.result || [];
}

try {
  const config = stagingConfig();
  printTarget(config, 'July Shadow Payroll executive/fixed-monthly lane verification');
  const executiveIds = executiveEmployeeIds();
  const executiveIdsSql = executiveIds.map((id) => `'${id}'`).join(', ');
  const result = await databaseQuery(config, required('SUPABASE_ACCESS_TOKEN'), `
    with july_canonical_executives as (
      select e.id
      from public.employees e
      where e.id in (${executiveIdsSql})
        and e.hired_on <= date '2026-07-31'
        and (e.departed_on is null or e.departed_on >= date '2026-07-01')
    ), july_executive_monthly_terms as (
      select distinct e.id
      from july_canonical_executives e
      join public.payroll_employment_terms t on t.employee_uuid = e.id
      where t.pay_type = 'monthly'
        and t.monthly_salary > 0
        and t.effective_from <= date '2026-07-01'
        and (t.effective_to is null or t.effective_to >= date '2026-07-31')
    ), mapped_executives as (
      select distinct e.id
      from july_canonical_executives e
      join public.payroll_source_identity_mappings m on m.employee_uuid = e.id
      where m.status = 'active'
    ), july_attendance_hourly_workers as (
      select distinct e.id
      from public.employees e
      join public.payroll_employment_terms t on t.employee_uuid = e.id
      where e.id not in (${executiveIdsSql})
        and t.pay_type = 'hourly'
        and t.hourly_rate > 0
        and t.effective_from <= date '2026-07-01'
        and (t.effective_to is null or t.effective_to >= date '2026-07-31')
    )
    select
      (select count(*) from july_canonical_executives) as canonical_executive_employee_ids,
      (select count(*) from july_executive_monthly_terms) as july_executive_full_monthly_terms,
      (select count(*) from mapped_executives) as active_payroll_source_mappings,
      (select count(*) from july_attendance_hourly_workers) as attendance_hourly_workers;
  `);
  const row = resultRows(result)[0];
  const expected = {
    canonical_executive_employee_ids: '2',
    july_executive_full_monthly_terms: '2',
    active_payroll_source_mappings: '2',
    attendance_hourly_workers: '21',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (String(row?.[key]) !== value) {
      throw new Error(`July executive-lane verification failed for ${key}: expected ${value}, observed ${String(row?.[key] ?? 'none')}. Aggregate counts only; no identifiers or amounts were returned.`);
    }
  }
  console.log('July lane verification passed: 21 attendance-driven workers plus 2 canonical executive fixed-monthly payroll subjects; no identifiers or amounts were printed.');
} catch (error) {
  console.error(`STOP: ${error.message}`);
  process.exitCode = 2;
}
