import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getTestGroup } from './test-manifest.mjs';

const groupName = process.argv[2];
if (!groupName) {
  console.error('Usage: node scripts/run-test-group.mjs <group>');
  process.exit(2);
}

const files = getTestGroup(groupName);
const missing = files.filter(file => !existsSync(file));
if (missing.length) {
  console.error(`Missing test files in ${groupName}:`);
  for (const file of missing) console.error(`- ${file}`);
  process.exit(2);
}

console.log(`Running ${groupName}: ${files.length} test files`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
