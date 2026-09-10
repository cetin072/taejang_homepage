import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, stagingConfig, printTarget, migrations } from './shared.mjs';

const apply = process.argv.includes('--apply');
const localCli = resolve(ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js');

function runSupabase(args) {
  if (existsSync(localCli)) {
    execFileSync(process.execPath, [localCli, ...args], { stdio: 'inherit' });
  } else {
    execFileSync('supabase', args, { stdio: 'inherit' });
  }
}

try {
  const config = stagingConfig({ mutation: apply });
  printTarget(config, apply ? 'migration apply requested' : 'migration dry-run requested');
  console.log(migrations().map(item => `- ${item.name}`).join('\n'));

  // Current Supabase CLI expects the remote project to be linked first.
  // Keep the explicit allow-listed project ref from stagingConfig as the link target,
  // then let `db push` operate only against that linked project.
  runSupabase(['link', '--project-ref', config.ref]);
  runSupabase(['db', 'push', ...(apply ? [] : ['--dry-run'])]);

  console.log(apply ? 'Migration command completed. Run verify-phase1 next.' : 'Dry-run completed. No migration was applied.');
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
