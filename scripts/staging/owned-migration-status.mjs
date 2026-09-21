#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const [remotePath, outputPath] = process.argv.slice(2);
if (!remotePath || !outputPath) {
  console.error('usage: node scripts/staging/owned-migration-status.mjs <remote.json> <output.json>');
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(remotePath, 'utf8'));
const remote = Array.isArray(raw) ? raw : (Array.isArray(raw.result) ? raw.result : []);
const migrationDir = path.resolve('supabase/migrations');
const local = fs.readdirSync(migrationDir)
  .filter(name => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .map(file => {
    const match = file.match(/^(\d{14})_(.+)\.sql$/);
    return { version: match[1], name: match[2], file };
  });

const specialAliases = new Map([
  [
    'phase_c_homepage_text_photo_requests',
    '20260903154500_phase_c_homepage_change_requests.sql'
  ]
]);

const localByVersion = new Map(local.map(item => [item.version, item]));
const localByFile = new Map(local.map(item => [item.file, item]));
const localByName = new Map();
for (const item of local) {
  if (!localByName.has(item.name)) localByName.set(item.name, []);
  localByName.get(item.name).push(item);
}

const mappedLocal = new Set();
const exact = [];
const uniqueNameMapped = [];
const embeddedFilenameMapped = [];
const aliasMapped = [];
const versionNameMismatch = [];
const remoteUnmatched = [];

for (const row of remote) {
  const version = String(row.version || '');
  const name = String(row.name || '');
  const byVersion = localByVersion.get(version);

  if (byVersion) {
    if (byVersion.name === name) {
      exact.push({ remote: { version, name }, local: byVersion, proof: 'exact_version_and_name' });
      mappedLocal.add(byVersion.file);
    } else {
      versionNameMismatch.push({ remote: { version, name }, local: byVersion });
    }
    continue;
  }

  const byName = localByName.get(name) || [];
  if (byName.length === 1 && !mappedLocal.has(byName[0].file)) {
    uniqueNameMapped.push({
      remote: { version, name },
      local: byName[0],
      proof: 'unique_logical_name'
    });
    mappedLocal.add(byName[0].file);
    continue;
  }

  const embedded = name.match(/^(\d{14})_(.+)$/);
  if (embedded) {
    const candidate = localByVersion.get(embedded[1]);
    if (
      candidate &&
      candidate.name === embedded[2] &&
      !mappedLocal.has(candidate.file)
    ) {
      embeddedFilenameMapped.push({
        remote: { version, name },
        local: candidate,
        proof: 'remote_name_embeds_exact_local_filename'
      });
      mappedLocal.add(candidate.file);
      continue;
    }
  }

  const aliasFile = specialAliases.get(name);
  if (aliasFile) {
    const candidate = localByFile.get(aliasFile);
    if (candidate && !mappedLocal.has(candidate.file)) {
      aliasMapped.push({
        remote: { version, name },
        local: candidate,
        proof: 'explicit_repo_owned_alias'
      });
      mappedLocal.add(candidate.file);
      continue;
    }
  }

  // Important shared-project rule:
  // A remote-only row is NOT considered broken. This staging Supabase project
  // is intentionally shared by multiple Taejang repositories. Unknown remote
  // migrations are preserved and never repaired/deleted by this repository.
  remoteUnmatched.push({ version, name });
}

const localUnmatched = local.filter(item => !mappedLocal.has(item.file));

const result = {
  counts: {
    remote: remote.length,
    local: local.length,
    exact: exact.length,
    uniqueNameMapped: uniqueNameMapped.length,
    embeddedFilenameMapped: embeddedFilenameMapped.length,
    aliasMapped: aliasMapped.length,
    versionNameMismatch: versionNameMismatch.length,
    remoteUnmatched: remoteUnmatched.length,
    localUnmatched: localUnmatched.length
  },
  exact,
  uniqueNameMapped,
  embeddedFilenameMapped,
  aliasMapped,
  versionNameMismatch,
  remoteUnmatched,
  localUnmatched
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');

console.log('OWNED_MIGRATION_COUNTS=' + JSON.stringify(result.counts));
console.log('OWNED_ALIAS_MAPPED=' + JSON.stringify(aliasMapped));
console.log('REMOTE_ONLY_PRESERVED=' + JSON.stringify(remoteUnmatched));
console.log('LOCAL_OWNED_UNMATCHED=' + JSON.stringify(localUnmatched));

if (versionNameMismatch.length) {
  console.error('STOP_OWNED_VERSION_NAME_MISMATCH');
  console.error(JSON.stringify(versionNameMismatch));
  process.exit(1);
}
