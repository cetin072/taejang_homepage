import { qaEmail, stagingConfig, printTarget } from './shared.mjs';

const DB_OWNER_TOKEN = 'SUPABASE_ACCESS_TOKEN';
const QA_NAMESPACE = 'phase-c-promotion-test';
const TEST_EMAILS = [qaEmail('promotion-staff'), qaEmail('promotion-lead'), qaEmail('promotion-operations'), qaEmail('promotion-ceo')];

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
  if (!response.ok) throw new Error(`Phase C TEST cleanup query failed (${response.status}) without exposing credentials.`);
  return response.json();
}

function literal(value) { return `'${value.replaceAll("'", "''")}'`; }

function cleanupSql() {
  const emails = TEST_EMAILS.map(literal).join(', ');
  return `do $$
declare
  test_profile_ids uuid[];
begin
  select array_agg(user_row.id order by user_row.id) into test_profile_ids
  from auth.users user_row
  where user_row.email in (${emails}) and user_row.deleted_at is null
    and coalesce(user_row.raw_user_meta_data->>'staging_qa', 'false') = 'true'
    and user_row.raw_user_meta_data->>'qa_namespace' = ${literal(QA_NAMESPACE)};
  if coalesce(array_length(test_profile_ids, 1), 0) <> 4 then raise exception 'STOP_PHASE_C_TEST_IDENTITY_MISMATCH'; end if;
  if exists (
    select 1 from public.promotion_content_revisions revision
    join public.promotion_contents content on content.id = revision.content_id
    where content.owner_profile_id = any(test_profile_ids)
      and revision.author_profile_id <> all(test_profile_ids)
  ) then raise exception 'STOP_PHASE_C_TEST_CONTENT_AUTHOR_MISMATCH'; end if;

  update public.promotion_contents
  set current_revision_id = null
  where owner_profile_id = any(test_profile_ids);
  delete from public.promotion_publication_queue queue
  using public.promotion_content_revisions revision
  where queue.revision_id = revision.id and revision.author_profile_id = any(test_profile_ids);
  delete from public.promotion_review_requests review
  using public.promotion_content_revisions revision
  where review.revision_id = revision.id and revision.author_profile_id = any(test_profile_ids);
  delete from public.promotion_content_revisions where author_profile_id = any(test_profile_ids);
  delete from public.promotion_contents where owner_profile_id = any(test_profile_ids);

  update public.profile_roles
  set revoked_at = now(), revoked_by = profile_id
  where profile_id = any(test_profile_ids) and revoked_at is null;
  update public.profiles
  set account_status = 'pending', approved_at = null, status_reason = '[STAGING-QA] Phase C TEST cleanup'
  where id = any(test_profile_ids);
end $$;`;
}

try {
  if (process.argv.length !== 2) throw new Error('Phase C TEST cleanup supports no options.');
  const config = stagingConfig({ mutation: true });
  printTarget(config, 'Phase C DB owner TEST cleanup');
  await databaseQuery(config, required(DB_OWNER_TOKEN), cleanupSql(), false);
  console.log('Phase C TEST cleanup complete: TEST promotion data removed and 4 TEST accounts returned to pending with no active roles.');
} catch (error) {
  console.error(`STOP: ${error.message}`);
  process.exitCode = 2;
}
