import { qaEmail, stagingConfig, printTarget } from './shared.mjs';

const DB_OWNER_TOKEN = 'SUPABASE_ACCESS_TOKEN';
const QA_NAMESPACE = 'phase-c-promotion-test';
const TEST_EMAILS = [qaEmail('promotion-staff'), qaEmail('promotion-lead'), qaEmail('promotion-operations'), qaEmail('promotion-ceo')];

const required = name => {
  if (!process.env[name]) throw new Error(`${name} is required and is never printed.`);
  return process.env[name];
};

async function databaseQuery(config, accessToken, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${config.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true })
  });
  if (!response.ok) throw new Error(`Phase C DB owner verification query failed (${response.status}) without exposing credentials.`);
  return response.json();
}

function literal(value) { return `'${value.replaceAll("'", "''")}'`; }

try {
  if (process.argv.length !== 2) throw new Error('Phase C DB owner verification supports only the approved TEST-only mode with no options.');
  const config = stagingConfig();
  printTarget(config, 'Phase C DB owner TEST verification');
  const emails = TEST_EMAILS.map(literal).join(', ');
  const result = await databaseQuery(config, required(DB_OWNER_TOKEN), `
    with test_users as (
      select id, email from auth.users
      where email in (${emails}) and deleted_at is null
        and coalesce(raw_user_meta_data->>'staging_qa', 'false') = 'true'
        and raw_user_meta_data->>'qa_namespace' = ${literal(QA_NAMESPACE)}
    ), expected_roles(email, role_code) as (
      values
        (${literal(TEST_EMAILS[0])}, 'promotion_staff'),
        (${literal(TEST_EMAILS[1])}, 'promotion_lead'),
        (${literal(TEST_EMAILS[2])}, 'operations_manager'),
        (${literal(TEST_EMAILS[3])}, 'ceo')
    )
    select
      (select count(*) from test_users) as test_users,
      (select count(*) from public.profiles profile join test_users user_row on user_row.id = profile.id where profile.account_status = 'active') as active_profiles,
      (select count(*) from expected_roles expected join test_users user_row on user_row.email = expected.email join public.profile_roles assignment on assignment.profile_id = user_row.id and assignment.revoked_at is null join public.roles role on role.id = assignment.role_id and role.code = expected.role_code) as active_expected_roles,
      (select count(*) from public.promotion_contents) as promotion_contents_visible_to_owner,
      (select count(*) from unnest(array['promotion_contents', 'promotion_content_revisions', 'promotion_review_requests', 'promotion_publication_queue']) table_name where to_regclass('public.' || table_name) is not null) as promotion_tables,
      (select count(*) from unnest(array['save_promotion_draft', 'submit_promotion_revision', 'review_promotion_revision', 'queue_promotion_revision', 'get_my_promotion_workspace', 'list_promotion_public_export_candidates']) function_name where to_regprocedure('public.' || function_name || case when function_name = 'save_promotion_draft' then '(uuid,promotion_content_type,text,text,text,text,text,text,promotion_byline_kind,text,text,text,jsonb,promotion_disclosure_answer,promotion_disclosure_answer,date,text)' when function_name = 'review_promotion_revision' then '(uuid,text,text,date)' when function_name = 'queue_promotion_revision' then '(uuid,timestamp with time zone)' else '()' end) is not null) as promotion_functions;
  `);
  const row = Array.isArray(result) ? result[0] : result?.result?.[0];
  const expected = { test_users: '4', active_profiles: '4', active_expected_roles: '4', promotion_tables: '4', promotion_functions: '6' };
  for (const [key, value] of Object.entries(expected)) if (String(row?.[key]) !== value) throw new Error(`Phase C DB owner verification failed for ${key}.`);
  console.log('Phase C DB owner TEST verification passed: 4 TEST accounts, exact roles, schema, and RPC contracts are present.');
} catch (error) {
  console.error(`STOP: ${error.message}`);
  process.exitCode = 2;
}
