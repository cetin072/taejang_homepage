import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, stagingConfig, printTarget } from './shared.mjs';
import { classifyOwnedMigrations, localMigrationInventory } from './owned-migration-status.mjs';

const apply = process.argv.includes('--apply');

const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for owner-aware staging migration management.`);
  return value;
};

async function managementQuery(config, query, readOnly) {
  const accessToken = required('SUPABASE_ACCESS_TOKEN');
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${config.ref}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, read_only: readOnly })
    }
  );

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    throw new Error(`Management query failed (${response.status}): ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data)}`);
  }
  return data;
}

function rowsFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

async function remoteHistory(config) {
  const result = await managementQuery(
    config,
    'select version, name from supabase_migrations.schema_migrations order by version;',
    true
  );
  return rowsFromResponse(result);
}

async function recordApplied(config, migration) {
  const version = migration.version.replaceAll("'", "''");
  const name = migration.name.replaceAll("'", "''");
  await managementQuery(
    config,
    `insert into supabase_migrations.schema_migrations(version,name,statements)
     values ('${version}','${name}',array[]::text[])
     on conflict (version) do nothing;`,
    false
  );
}

async function main() {
  const config = stagingConfig({ mutation: apply });
  printTarget(config, apply ? 'owned migration apply requested' : 'owned migration dry-run requested');

  const local = localMigrationInventory(ROOT);
  const before = classifyOwnedMigrations(await remoteHistory(config), local);

  if (before.versionNameMismatch.length) {
    throw new Error(`Owned migration version/name mismatch: ${JSON.stringify(before.versionNameMismatch)}`);
  }

  console.log(`Owned migration status: ${JSON.stringify(before.counts)}`);
  console.log(`Remote-only rows preserved: ${JSON.stringify(before.remoteUnmatched)}`);

  if (!before.localUnmatched.length) {
    console.log('No repository-owned staging migrations are pending.');
    return;
  }

  console.log('Pending repository-owned migrations:');
  for (const migration of before.localUnmatched) console.log(`- ${migration.file}`);

  if (!apply) {
    console.log('Dry-run completed. No remote mutation was performed.');
    return;
  }

  for (const migration of before.localUnmatched) {
    const filePath = resolve(ROOT, 'supabase/migrations', migration.file);
    const sql = readFileSync(filePath, 'utf8');

    console.log(`Applying repository-owned migration: ${migration.file}`);
    await managementQuery(config, sql, false);
    await recordApplied(config, migration);
  }

  const after = classifyOwnedMigrations(await remoteHistory(config), local);
  if (after.versionNameMismatch.length || after.localUnmatched.length) {
    throw new Error(`Owned migration post-check failed: ${JSON.stringify({
      versionNameMismatch: after.versionNameMismatch,
      localUnmatched: after.localUnmatched
    })}`);
  }

  console.log(`Owned migration post-check: ${JSON.stringify(after.counts)}`);
  console.log(`Remote-only rows preserved: ${JSON.stringify(after.remoteUnmatched)}`);
  console.log('Repository-owned staging migrations are fully accounted for.');
}

main().catch(error => {
  console.error(`STOP: ${error.message}`);
  process.exitCode = 2;
});
