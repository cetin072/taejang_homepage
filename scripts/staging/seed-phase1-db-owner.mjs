import { api, EMAIL_DOMAIN, PREFIX, qaEmail, readManifest, stagingConfig, printTarget, writeManifest } from './shared.mjs';

const DB_OWNER_TOKEN = 'SUPABASE_ACCESS_TOKEN';
const TEST_DEPARTMENT = 'staging_test';
const TEST_DEPARTMENT_NAME = `${PREFIX} [TEST] 시험부서`;
const TEST_GROUP = `${PREFIX} [TEST] 시험 작업반`;
const TEST_ADMIN_EMAIL = qaEmail('test-admin');
const TEST_WORKER_EMAIL = qaEmail('test-worker');
const TEST_TITLES = {
  guide: `${PREFIX} [TEST] 포장 작업방법`,
  assignment: `${PREFIX} [TEST] 오늘 업무`,
  schedule: `${PREFIX} [TEST] 일정`,
  notice: `${PREFIX} [TEST] 중요공지`,
  guidance: `${PREFIX} [TEST] 자주 보는 안내`
};

const required = name => {
  if (!process.env[name]) throw new Error(`${name} is required and is never printed.`);
  return process.env[name];
};

async function databaseQuery(config, accessToken, query, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${config.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: readOnly })
  });
  if (!response.ok) throw new Error(`DB owner query failed (${response.status}) without exposing credentials.`);
  return response.json();
}

async function ensureTestAuthUsers(config, password) {
  const existing = await api(config, '/auth/v1/admin/users?per_page=1000');
  const byEmail = new Map((existing.users || []).map(user => [user.email, user]));
  const users = {};
  for (const [slug, email, displayName] of [
    ['testAdmin', TEST_ADMIN_EMAIL, '[TEST] 시험 관리자'],
    ['testWorker', TEST_WORKER_EMAIL, '[TEST] 시험 근로자']
  ]) {
    let user = byEmail.get(email);
    if (user && user.user_metadata?.staging_qa !== true) throw new Error('Refuse to reuse a non-QA Auth user.');
    if (user) user = await api(config, `/auth/v1/admin/users/${user.id}`, { method: 'PUT', body: { password, email_confirm: true } });
    else user = await api(config, '/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { display_name: displayName, staging_qa: true, qa_namespace: 'phase1-minimal-db-owner-test' } } });
    if (user.user_metadata?.staging_qa !== true) throw new Error('Refuse an Auth response without the TEST marker.');
    users[slug] = user.id;
  }
  return users;
}

function seedSql() {
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  return `do $$
declare
  v_admin_id uuid; v_worker_id uuid; v_department_id uuid; v_group_id uuid; v_guide_id uuid; v_schedule_id uuid; v_notice_id uuid;
  v_admin_role_id uuid; v_worker_role_id uuid; v_admin_position_id uuid; v_worker_position_id uuid;
begin
  select id into v_admin_id from auth.users where email = ${literal(TEST_ADMIN_EMAIL)} and deleted_at is null;
  select id into v_worker_id from auth.users where email = ${literal(TEST_WORKER_EMAIL)} and deleted_at is null;
  if v_admin_id is null or v_worker_id is null or v_admin_id = v_worker_id then raise exception 'STOP_TEST_AUTH_USERS_INVALID'; end if;
  if exists (select 1 from auth.users where id in (v_admin_id, v_worker_id) and coalesce(raw_user_meta_data->>'staging_qa', 'false') <> 'true') then raise exception 'STOP_NON_QA_AUTH_USER'; end if;
  select id into v_admin_role_id from public.roles where code = 'super_admin' and active;
  select id into v_worker_role_id from public.roles where code = 'general_worker' and active;
  select id into v_admin_position_id from public.positions where code = 'system_super_admin' and active;
  select id into v_worker_position_id from public.positions where code = 'general_worker' and active;
  if v_admin_role_id is null or v_worker_role_id is null or v_admin_position_id is null or v_worker_position_id is null then raise exception 'STOP_REFERENCE_DATA_MISSING'; end if;

  select id into v_department_id from public.departments where code = ${literal(TEST_DEPARTMENT)};
  if v_department_id is not null and not exists (select 1 from public.departments d where d.id = v_department_id and d.name = ${literal(TEST_DEPARTMENT_NAME)}) then raise exception 'STOP_TEST_DEPARTMENT_CONFLICT'; end if;
  insert into public.departments (code, name, active, sort_order) values (${literal(TEST_DEPARTMENT)}, ${literal(TEST_DEPARTMENT_NAME)}, true, 900) on conflict (code) do update set active = true returning id into v_department_id;
  update public.profiles p set account_status = 'active', department_id = v_department_id, position_id = case when p.id = v_admin_id then v_admin_position_id else v_worker_position_id end, approved_at = coalesce(p.approved_at, now()), status_reason = ${literal(`${PREFIX} minimal DB owner TEST seed`)} where p.id in (v_admin_id, v_worker_id);
  insert into public.profile_roles (profile_id, role_id, scope_type, scope_id, granted_by) select v_admin_id, v_admin_role_id, 'company', null, v_admin_id where not exists (select 1 from public.profile_roles pr where pr.profile_id = v_admin_id and pr.role_id = v_admin_role_id and pr.revoked_at is null);
  insert into public.profile_roles (profile_id, role_id, scope_type, scope_id, granted_by) select v_worker_id, v_worker_role_id, 'company', null, v_admin_id where not exists (select 1 from public.profile_roles pr where pr.profile_id = v_worker_id and pr.role_id = v_worker_role_id and pr.revoked_at is null);

  select id into v_group_id from public.work_groups where name = ${literal(TEST_GROUP)};
  if v_group_id is not null and not exists (select 1 from public.work_groups g where g.id = v_group_id and g.department_id = v_department_id) then raise exception 'STOP_TEST_GROUP_CONFLICT'; end if;
  insert into public.work_groups (name, department_id, active, sort_order, created_by, updated_by) values (${literal(TEST_GROUP)}, v_department_id, true, 910, v_admin_id, v_admin_id) on conflict do nothing;
  select id into v_group_id from public.work_groups g where g.name = ${literal(TEST_GROUP)} and g.department_id = v_department_id;
  if v_group_id is null then raise exception 'STOP_TEST_GROUP_MISSING'; end if;
  insert into public.work_group_members (work_group_id, profile_id, member_type, start_date, assigned_by) select v_group_id, v_worker_id, 'worker', (now() at time zone 'Asia/Seoul')::date, v_admin_id where not exists (select 1 from public.work_group_members m where m.work_group_id = v_group_id and m.profile_id = v_worker_id and m.member_type = 'worker' and m.end_date is null);

  select id into v_guide_id from public.work_guides g where g.title = ${literal(TEST_TITLES.guide)} and g.department_id = v_department_id;
  if v_guide_id is null then insert into public.work_guides (department_id, title, summary_text, status, published_at, version_no, change_reason, created_by, updated_by, category, guide_format, audience_scope, audience_department_id) values (v_department_id, ${literal(TEST_TITLES.guide)}, '시험용 세 단계 작업방법입니다.', 'published', now(), 1, ${literal(`${PREFIX} minimal DB owner TEST seed`)}, v_admin_id, v_admin_id, 'packing', 'procedure', 'department', v_department_id) returning id into v_guide_id; end if;
  insert into public.work_guide_steps (work_guide_id, step_order, title, easy_text, status, created_by, updated_by) select v_guide_id, s.step_number, ${literal(`${PREFIX} [TEST] 단계 `)} || s.step_number, '시험용 작업방법 ' || s.step_number || '단계입니다.', 'published', v_admin_id, v_admin_id from generate_series(1, 3) as s(step_number) where not exists (select 1 from public.work_guide_steps ws where ws.work_guide_id = v_guide_id and ws.step_order = s.step_number);
  insert into public.daily_work_assignments (work_date, title, location, start_time, end_time, lead_profile_id, target_scope, target_work_group_id, status, change_reason, created_by, updated_by) select (now() at time zone 'Asia/Seoul')::date, ${literal(TEST_TITLES.assignment)}, '시험 작업장', '09:00', '10:00', v_admin_id, 'work_group', v_group_id, 'published', ${literal(`${PREFIX} minimal DB owner TEST seed`)}, v_admin_id, v_admin_id where not exists (select 1 from public.daily_work_assignments a where a.work_date = (now() at time zone 'Asia/Seoul')::date and a.title = ${literal(TEST_TITLES.assignment)});
  select id into v_schedule_id from public.schedule_items s where s.title = ${literal(TEST_TITLES.schedule)} and s.target_profile_id = v_worker_id;
  if v_schedule_id is null then insert into public.schedule_items (schedule_type, title, starts_at, ends_at, all_day, location, manager_label, easy_text, target_scope, target_profile_id, status, change_reason, created_by, updated_by) values ('training', ${literal(TEST_TITLES.schedule)}, now(), now() + interval '3 days', false, '시험 교육실', '시험 관리자', '시험용 일정입니다.', 'profile', v_worker_id, 'published', ${literal(`${PREFIX} minimal DB owner TEST seed`)}, v_admin_id, v_admin_id) returning id into v_schedule_id; end if;
  select id into v_notice_id from public.notices n where n.title = ${literal(TEST_TITLES.notice)} and n.target_profile_id = v_worker_id;
  if v_notice_id is null then insert into public.notices (notice_kind, importance, title, body_easy, publish_start_at, publish_end_at, effective_start_date, related_schedule_id, related_work_guide_id, requires_acknowledgement, target_scope, target_profile_id, status, published_at, change_reason, created_by, updated_by) values ('safety', 'important', ${literal(TEST_TITLES.notice)}, '시험용 중요공지입니다.', now() - interval '1 hour', now() + interval '3 days', (now() at time zone 'Asia/Seoul')::date, v_schedule_id, v_guide_id, true, 'profile', v_worker_id, 'published', now(), ${literal(`${PREFIX} minimal DB owner TEST seed`)}, v_admin_id, v_admin_id) returning id into v_notice_id; end if;
  insert into public.notice_acknowledgements (notice_id, notice_version, profile_id) select v_notice_id, 1, v_worker_id where not exists (select 1 from public.notice_acknowledgements na where na.notice_id = v_notice_id and na.profile_id = v_worker_id);
  insert into public.staff_guidance_items (category, title, summary_easy, body_easy, related_work_guide_id, related_schedule_id, target_scope, target_profile_id, display_order, is_featured, status, change_reason, created_by, updated_by) select 'company_life', ${literal(TEST_TITLES.guidance)}, '시험용 반복 안내입니다.', '어려우면 가까운 관리자에게 직접 알립니다.', v_guide_id, v_schedule_id, 'profile', v_worker_id, 1, true, 'published', ${literal(`${PREFIX} minimal DB owner TEST seed`)}, v_admin_id, v_admin_id where not exists (select 1 from public.staff_guidance_items gi where gi.title = ${literal(TEST_TITLES.guidance)} and gi.target_profile_id = v_worker_id);
end $$;`;
}

try {
  if (process.argv.length !== 2) throw new Error('DB owner seed supports only the approved minimal TEST mode with no options.');
  const config = stagingConfig({ serviceRole: true, mutation: true });
  const password = required('STAGING_QA_PASSWORD');
  if (password.length < 12) throw new Error('STAGING_QA_PASSWORD must be at least 12 characters and is never printed.');
  const accessToken = required(DB_OWNER_TOKEN);
  printTarget(config, 'Phase 1 DB owner minimal TEST seed');
  const prior = readManifest(); if (prior?.project_ref === config.ref && prior?.seed_state === 'complete') throw new Error('A complete QA manifest exists. Verify or clean it before another DB owner seed.');
  await databaseQuery(config, accessToken, "select 1 from public.departments where code = 'operations' and active", true);
  const ids = await ensureTestAuthUsers(config, password);
  await databaseQuery(config, accessToken, seedSql(), false);
  writeManifest({ schema_version: 3, seed_state: 'complete', seed_mode: 'minimal', seed_path: 'db_owner', project_ref: config.ref, created_at: new Date().toISOString(), qa_prefix: PREFIX, qa_email_domain: EMAIL_DOMAIN, user_ids: ids, work_group_names: [TEST_GROUP] });
  console.log('DB owner minimal TEST seed complete: two TEST accounts only. Credentials were not printed.');
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
