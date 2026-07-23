import { execFileSync } from 'node:child_process';
import { stagingConfig, printTarget, migrations } from './shared.mjs';

try {
  const config = stagingConfig();
  printTarget(config, 'staging inspection only');
  const list = migrations();
  if (!list.length) throw new Error('No migrations found.');
  console.log(`Found ${list.length} ordered migrations:`);
  for (const migration of list) console.log(`- ${migration.name} sha256=${migration.sha256.slice(0, 12)}`);
  console.log('This command does not call Supabase and does not apply migrations.');
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
