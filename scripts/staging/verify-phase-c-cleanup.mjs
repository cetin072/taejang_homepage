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
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: true })
  });
  if (!response.ok) throw new Error(`Phase C TEST cleanup verification query failed (${response.status}) without exposing credentials.`);
  return response.json();
}
function literal(value) { return `'${value.replaceAll("'", "''")}'`; }

try {
  if (process.argv.length !== 2) throw new Error('Phase C TEST cleanup verification supports no options.');
  const config = stagingConfig();
  printTarget(config, 'Phase C DB owner TEST cleanup verification');
  const emails = TEST_EMAILS.map(literal).join(', ');
  const result = await databaseQuery(config, required(DB_OWNER_TOKEN), `
    with test_users as (
      select id from auth.users where email in (${emails}) and deleted_at is null
        and coalesce(raw_user_meta_data->>'staging_qa', 'false') = 'true'
        and raw_user_meta_data->>'qa_namespace' = ${literal(QA_NAMESPACE)}
    ) select
      (select count(*) from test_users) as test_users,
      (select count(*) from public.profiles profile join test_users user_row on user_row.id = profile.id where profile.account_status = 'pending') as pending_profiles,
      (select count(*) from public.profile_roles assignment join test_users user_row on user_row.id = assignment.profile_id where assignment.revoked_at is null) as active_roles,
      (select count(*) from public.promotion_contents content join test_users user_row on user_row.id = content.owner_profile_id) as test_contents,
      (select count(*) from public.promotion_content_revisions revision join test_users user_row on user_row.id = revision.author_profile_id) as test_revisions;
  `);
  const row = Array.isArray(result) ? result[0] : result?.result?.[0];
  const expected = { test_users: '4', pending_profiles: '4', active_roles: '0', test_contents: '0', test_revisions: '0' };
  for (const [key, value] of Object.entries(expected)) if (String(row?.[key]) !== value) throw new Error(`Phase C TEST cleanup verification failed for ${key}.`);
  console.log('Phase C TEST cleanup verification passed: no TEST promotion content remains and all 4 TEST accounts are pending with no active roles.');
} catch (error) {
  console.error(`STOP: ${error.message}`);
  process.exitCode = 2;
}
