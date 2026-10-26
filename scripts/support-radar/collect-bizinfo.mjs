// Read-only upstream collection: prints a normalized review artifact, never writes a database.
import fs from 'node:fs/promises';
import { collect, parse, mergeSnapshot } from './bizinfo.mjs';
const args = process.argv.slice(2);
const fixtureIndex = args.indexOf('--fixture');
if (args.length && !(args.length === 2 && fixtureIndex === 0)) {
  console.error('Usage: node scripts/support-radar/collect-bizinfo.mjs [--fixture file.json]'); process.exitCode = 2;
} else if (fixtureIndex === 0) {
  try {
    const merged = mergeSnapshot([], parse(JSON.parse(await fs.readFile(args[1], 'utf8'))));
    console.log(JSON.stringify({ mode: 'fixture', status: 'fixture_validated', ...merged }, null, 2));
  } catch { console.error('FIXTURE_INVALID'); process.exitCode = 1; }
} else {
  const result = await collect({ key: process.env.BIZINFO_API_KEY || process.env.BIZINFO_CRTFC_KEY });
  console.log(JSON.stringify({ mode: 'read_only_upstream', ...result }, null, 2));
  if (!result.status.startsWith('success_')) process.exitCode = 1;
}
