import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, stagingConfig, printTarget, migrations } from './shared.mjs';

const apply = process.argv.includes('--apply');
try {
  const config = stagingConfig({ mutation: apply });
  printTarget(config, apply ? 'migration apply requested' : 'migration dry-run requested');
  console.log(migrations().map(item => `- ${item.name}`).join('\n'));
  const args = ['db', 'push', '--project-ref', config.ref, ...(apply ? [] : ['--dry-run'])];
  const localCli = resolve(ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js');
  if (existsSync(localCli)) {
    execFileSync(process.execPath, [localCli, ...args], { stdio: 'inherit' });
  } else {
    execFileSync('supabase', args, { stdio: 'inherit' });
  }
  console.log(apply ? 'Migration command completed. Run verify-phase1 next.' : 'Dry-run completed. No migration was applied.');
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
