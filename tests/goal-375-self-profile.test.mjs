import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) { return readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }

test('Goal #375 keeps the employee profile minimal and places it in settings', async () => {
  const screen = await text('mobile/app/profile.tsx');
  const settings = await text('mobile/app/settings.tsx');
  const api = await text('mobile/src/features/profile/profile-api.ts');

  for (const label of ['이름', '부서', '직책', '입사일', '연락처']) assert.match(screen, new RegExp(label));
  assert.match(settings, /router\.push\('\/profile'\)/);
  assert.match(screen, /관리자 확인 후 등록된 연락처가 바뀝니다/);
  assert.match(api, /get_my_employee_profile/);
  assert.match(api, /submit_my_employee_contact_change_request/);
  assert.doesNotMatch(screen, /주민등록번호|급여|인사평가|관리자 메모/);
});

test('Goal #375 migration exposes only guarded profile and approval RPCs', async () => {
  const migration = await text('supabase/migrations/20260925135506_goal_375_self_profile_contact_requests.sql');
  assert.match(migration, /employee_self_service_contact_requests/);
  assert.match(migration, /alter table public\.employee_self_service_contact_requests enable row level security/);
  assert.match(migration, /revoke all on public\.employee_self_service_contact_requests from public, anon, authenticated/);
  assert.match(migration, /private_active_employee_for_profile/);
  assert.match(migration, /profile\.account_status = 'active'/);
  assert.match(migration, /private_actor_can\('employee\.review_change_requests'\)/);
  assert.match(migration, /private_get_employee_management_context_pre375/);
  assert.match(migration, /self_service_contact_requests/);
  assert.match(migration, /CONTACT_CHANGE_ALREADY_PENDING/);
  assert.match(migration, /update public\.profiles/);
  const submit = migration.slice(migration.indexOf('create function public.submit_my_employee_contact_change_request'), migration.indexOf('create function public.review_employee_contact_change_request'));
  assert.doesNotMatch(submit, /update public\.profiles/);
});

test('Goal #375 reuses the existing web reviewer surface without a direct employee update', async () => {
  const employeeManagement = await text('app/assets/employee-management.js');
  assert.match(employeeManagement, /review_employee_contact_change_request/);
  assert.match(employeeManagement, /self_service_contact_requests/);
  assert.match(employeeManagement, /request\.kind === 'employee_contact'/);
});
