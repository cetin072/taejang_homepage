import { api, qaEmail, stagingConfig, printTarget } from './shared.mjs';

const DB_OWNER_TOKEN = 'SUPABASE_ACCESS_TOKEN';
const QA_NAMESPACE = 'phase-c-promotion-test';
const TEST_USERS = [
  ['staff', qaEmail('promotion-staff'), '[STAGING-QA] [TEST-C] 홍보직원', 'promotion', 'staff', 'promotion_staff'],
  ['lead', qaEmail('promotion-lead'), '[STAGING-QA] [TEST-C] 홍보팀장', 'promotion', 'department_lead', 'promotion_lead'],
  ['operations', qaEmail('promotion-operations'), '[STAGING-QA] [TEST-C] 운영총괄', 'operations', 'operations_manager', 'operations_manager'],
  ['ceo', qaEmail('promotion-ceo'), '[STAGING-QA] [TEST-C] 대표이사', 'operations', 'ceo', 'ceo']
];

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
  if (!response.ok) throw new Error(`Phase C DB owner query failed (${response.status}) without exposing credentials.`);
  return response.json();
}

async function ensureTestAuthUsers(config, password) {
  const existing = await api(config, '/auth/v1/admin/users?per_page=1000');
  const byEmail = new Map((existing.users || []).map(user => [user.email, user]));
  const users = {};
  for (const [slug, email, displayName] of TEST_USERS) {
    let user = byEmail.get(email);
    if (user && (user.user_metadata?.staging_qa !== true || user.user_metadata?.qa_namespace !== QA_NAMESPACE)) {
      throw new Error('Refuse to reuse a non-Phase-C-QA Auth user.');
    }
    const body = {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, staging_qa: true, qa_namespace: QA_NAMESPACE }
    };
    user = user
      ? await api(config, `/auth/v1/admin/users/${user.id}`, { method: 'PUT', body })
      : await api(config, '/auth/v1/admin/users', { method: 'POST', body: { email, ...body } });
    if (user.user_metadata?.staging_qa !== true || user.user_metadata?.qa_namespace !== QA_NAMESPACE) {
      throw new Error('Refuse an Auth response without the Phase C TEST marker.');
    }
    users[slug] = user.id;
  }
  return users;
}

function literal(value) { return `'${value.replaceAll("'", "''")}'`; }

function seedSql() {
  const userStatements = TEST_USERS.map(([slug, email, displayName, departmentCode, positionCode, roleCode]) => `
  select id into v_${slug}_id from auth.users where email = ${literal(email)} and deleted_at is null;
  if v_${slug}_id is null then raise exception 'STOP_PHASE_C_TEST_AUTH_USER_MISSING'; end if;
  if not exists (select 1 from auth.users where id = v_${slug}_id and coalesce(raw_user_meta_data->>'staging_qa', 'false') = 'true' and raw_user_meta_data->>'qa_namespace' = ${literal(QA_NAMESPACE)}) then raise exception 'STOP_NON_QA_AUTH_USER'; end if;
  select id into v_${slug}_department_id from public.departments where code = ${literal(departmentCode)} and active;
  select id into v_${slug}_position_id from public.positions where code = ${literal(positionCode)} and active;
  select id into v_${slug}_role_id from public.roles where code = ${literal(roleCode)} and active;
  if v_${slug}_department_id is null or v_${slug}_position_id is null or v_${slug}_role_id is null then raise exception 'STOP_PHASE_C_REFERENCE_DATA_MISSING'; end if;
  update public.profiles set display_name = ${literal(displayName)}, work_email = ${literal(email)}, account_status = 'active', department_id = v_${slug}_department_id, position_id = v_${slug}_position_id, approved_at = coalesce(approved_at, now()), status_reason = ${literal('[STAGING-QA] Phase C TEST seed')} where id = v_${slug}_id;
  if not found then raise exception 'STOP_PHASE_C_PROFILE_MISSING'; end if;
  update public.profile_roles set revoked_at = now(), revoked_by = v_${slug}_id where profile_id = v_${slug}_id and revoked_at is null;
  insert into public.profile_roles (profile_id, role_id, scope_type, scope_id, granted_by) values (v_${slug}_id, v_${slug}_role_id, 'company', null, v_${slug}_id);`).join('\n');

  return `do $$
declare
  v_staff_id uuid; v_lead_id uuid; v_operations_id uuid; v_ceo_id uuid;
  v_staff_department_id uuid; v_lead_department_id uuid; v_operations_department_id uuid; v_ceo_department_id uuid;
  v_staff_position_id uuid; v_lead_position_id uuid; v_operations_position_id uuid; v_ceo_position_id uuid;
  v_staff_role_id uuid; v_lead_role_id uuid; v_operations_role_id uuid; v_ceo_role_id uuid;
begin${userStatements}
end $$;`;
}

try {
  if (process.argv.length !== 2) throw new Error('Phase C DB owner seed supports only the approved minimal TEST mode with no options.');
  const config = stagingConfig({ serviceRole: true, mutation: true });
  const password = required('STAGING_QA_PASSWORD');
  if (password.length < 12) throw new Error('STAGING_QA_PASSWORD must be at least 12 characters and is never printed.');
  const accessToken = required(DB_OWNER_TOKEN);
  printTarget(config, 'Phase C DB owner minimal TEST seed');
  const userIds = await ensureTestAuthUsers(config, password);
  await databaseQuery(config, accessToken, seedSql(), false);
  console.log(`Phase C DB owner minimal TEST seed complete: ${Object.keys(userIds).length} TEST accounts only. Credentials were not printed.`);
} catch (error) {
  console.error(`STOP: ${error.message}`);
  process.exitCode = 2;
}
