import { readdirSync } from 'node:fs';
import path from 'node:path';

const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const projectRef = String(process.env.STAGING_PROJECT_REF || '').trim();
if (!token) throw new Error('UAR_STAGING_PARITY_SUPABASE_ACCESS_TOKEN_MISSING');
if (!projectRef) throw new Error('UAR_STAGING_PARITY_PROJECT_REF_MISSING');
if (projectRef !== 'jgsxpdflgkqroecfjzxq') throw new Error(`UAR_STAGING_PARITY_UNEXPECTED_PROJECT:${projectRef}`);

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`UAR_STAGING_PARITY_QUERY_FAILED:${response.status}:${JSON.stringify(payload)}`);
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  throw new Error(`UAR_STAGING_PARITY_UNEXPECTED_RESPONSE:${JSON.stringify(payload)}`);
}

// Migration history is diagnostic only. Some Staging repairs were applied through
// a guarded migration tool, which records a different timestamp while preserving
// the same logical migration name or later equivalent schema. Runtime contracts
// below are the authoritative acceptance condition.
const migrationDir = path.resolve('supabase/migrations');
const localMigrations = readdirSync(migrationDir)
  .map(file => {
    const match = file.match(/^(\d{14})_(.+)\.sql$/);
    return match ? { version: match[1], name: match[2], file } : null;
  })
  .filter(Boolean);
const remoteMigrationRows = await query(`
  select version::text as version, name
  from supabase_migrations.schema_migrations
  order by version
`);
const remoteNames = new Set(remoteMigrationRows.map(row => String(row.name || '').trim()).filter(Boolean));
const missingMigrationRecords = localMigrations.filter(item => !remoteNames.has(item.name));
if (missingMigrationRecords.length) {
  console.warn(`UAR_STAGING_PARITY_MIGRATION_HISTORY_DIAGNOSTIC:${missingMigrationRecords.map(item => item.file).join(',')}`);
}

const requiredTables = [
  'homepage_change_requests',
  'public_content_change_requests',
  'information_publication_requests'
];
const tableQuoted = requiredTables.map(value => `'${value.replaceAll("'", "''")}'`).join(',');
const tableRows = await query(`
  select c.relname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p')
    and c.relname in (${tableQuoted})
`);
const actualTables = new Set(tableRows.map(row => String(row.relname)));
const missingTables = requiredTables.filter(name => !actualTables.has(name));
if (missingTables.length) {
  throw new Error(`UAR_STAGING_PARITY_MISSING_TABLES:${missingTables.join(',')}`);
}

const requiredFunctions = [
  'create_homepage_change_request',
  'get_homepage_change_requests',
  'review_homepage_change_request',
  'archive_unpublished_promotion_content',
  'list_information_publication_requests',
  'save_information_publication_request',
  'review_information_publication_request',
  'list_public_content_change_requests',
  'review_public_content_change_request',
  'lead_update_recent_promotion_content',
  'lead_archive_recent_promotion_content'
];
const functionQuoted = requiredFunctions.map(value => `'${value.replaceAll("'", "''")}'`).join(',');
const functionRows = await query(`
  select distinct p.proname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (${functionQuoted})
`);
const actualFunctions = new Set(functionRows.map(row => String(row.proname)));
const missingFunctions = requiredFunctions.filter(name => !actualFunctions.has(name));
if (missingFunctions.length) {
  throw new Error(`UAR_STAGING_PARITY_MISSING_FUNCTIONS:${missingFunctions.join(',')}`);
}

const requiredCapabilities = [
  'homepage.draft',
  'homepage.review',
  'homepage.approve_apply',
  'information.submit',
  'information.review',
  'promotion.manage_recent_public',
  'promotion.request_public_change',
  'promotion.review_public_change'
];
const capabilityQuoted = requiredCapabilities.map(value => `'${value.replaceAll("'", "''")}'`).join(',');
const capabilityRows = await query(`
  select code
  from public.platform_capabilities
  where active is true and code in (${capabilityQuoted})
`);
const actualCapabilities = new Set(capabilityRows.map(row => String(row.code)));
const missingCapabilities = requiredCapabilities.filter(code => !actualCapabilities.has(code));
if (missingCapabilities.length) {
  throw new Error(`UAR_STAGING_PARITY_MISSING_CAPABILITIES:${missingCapabilities.join(',')}`);
}

console.log(`UAR_STAGING_PARITY_PASS tables=${requiredTables.length} functions=${requiredFunctions.length} capabilities=${requiredCapabilities.length}`);
