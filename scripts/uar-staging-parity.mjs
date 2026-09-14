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
const missingMigrations = localMigrations.filter(item => !remoteNames.has(item.name));
if (missingMigrations.length) {
  throw new Error(`UAR_STAGING_PARITY_MISSING_MIGRATIONS:${missingMigrations.map(item => item.file).join(',')}`);
}

const requiredFunctions = [
  'list_information_publication_requests',
  'save_information_publication_request',
  'review_information_publication_request',
  'list_public_content_change_requests',
  'review_public_content_change_request',
  'lead_update_recent_promotion_content',
  'lead_archive_recent_promotion_content'
];
const quoted = requiredFunctions.map(value => `'${value.replaceAll("'", "''")}'`).join(',');
const functionRows = await query(`
  select p.proname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (${quoted})
`);
const actualFunctions = new Set(functionRows.map(row => String(row.proname)));
const missingFunctions = requiredFunctions.filter(name => !actualFunctions.has(name));
if (missingFunctions.length) {
  throw new Error(`UAR_STAGING_PARITY_MISSING_FUNCTIONS:${missingFunctions.join(',')}`);
}

console.log(`UAR_STAGING_PARITY_PASS migrations=${localMigrations.length} required_functions=${requiredFunctions.length}`);
