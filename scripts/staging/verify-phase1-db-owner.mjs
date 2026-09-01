import { PREFIX, readManifest, stagingConfig, printTarget } from './shared.mjs';

const TEST_ADMIN_EMAIL = 'qa-test-admin@staging.invalid';
const TEST_WORKER_EMAIL = 'qa-test-worker@staging.invalid';
const required = name => { if (!process.env[name]) throw new Error(`${name} is required and is never printed.`); return process.env[name]; };

async function databaseQuery(config, accessToken, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${config.ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: true }) });
  if (!response.ok) throw new Error(`DB owner verification query failed (${response.status}) without exposing credentials.`);
  return response.json();
}

try {
  const config = stagingConfig(); printTarget(config, 'Phase 1 DB owner minimal TEST verification');
  const manifest = readManifest(); if (manifest?.seed_state !== 'complete' || manifest?.seed_mode !== 'minimal' || manifest?.seed_path !== 'db_owner') throw new Error('A complete DB owner minimal TEST manifest is required.');
  const result = await databaseQuery(config, required('SUPABASE_ACCESS_TOKEN'), `
    with test_users as (
      select id, email from auth.users
      where email in ('${TEST_ADMIN_EMAIL}', '${TEST_WORKER_EMAIL}') and deleted_at is null
        and coalesce(raw_user_meta_data->>'staging_qa', 'false') = 'true'
    )
    select
      (select count(*) from test_users) as test_users,
      (select count(*) from public.profiles p join test_users u on u.id = p.id where p.account_status = 'active') as active_profiles,
      (select count(*) from public.profile_roles pr join public.roles r on r.id = pr.role_id join test_users u on u.id = pr.profile_id where pr.revoked_at is null and r.code in ('super_admin', 'general_worker')) as active_expected_roles,
      (select count(*) from public.departments where code = 'staging_test' and name = '${PREFIX} [TEST] 시험부서' and active) as test_departments,
      (select count(*) from public.work_groups where name = '${PREFIX} [TEST] 시험 작업반' and active) as test_groups,
      (select count(*) from public.work_guides where title = '${PREFIX} [TEST] 포장 작업방법' and status = 'published') as guides,
      (select count(*) from public.daily_work_assignments where title = '${PREFIX} [TEST] 오늘 업무' and status = 'published') as assignments,
      (select count(*) from public.schedule_items where title = '${PREFIX} [TEST] 일정' and status = 'published') as schedules,
      (select count(*) from public.notices where title = '${PREFIX} [TEST] 중요공지' and status = 'published') as notices,
      (select count(*) from public.staff_guidance_items where title = '${PREFIX} [TEST] 자주 보는 안내' and status = 'published') as guidance;
  `);
  const row = Array.isArray(result) ? result[0] : result?.result?.[0];
  const expected = { test_users: '2', active_profiles: '2', active_expected_roles: '2', test_departments: '1', test_groups: '1', guides: '1', assignments: '1', schedules: '1', notices: '1', guidance: '1' };
  for (const [key, value] of Object.entries(expected)) if (String(row?.[key]) !== value) throw new Error(`DB owner verification failed for ${key}.`);
  console.log('DB owner minimal TEST verification passed: 2 accounts, organization, and 5 information samples.');
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
