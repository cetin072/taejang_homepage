import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeBizinfoPayload } from './support-radar-bizinfo-normalizer.mjs';
import { createSupportRadarIngestionBatch } from './support-radar-ingestion-contract.mjs';

export function buildBizinfoDryRun(payload, { fetched_at, cursor = null } = {}) {
  const normalized = normalizeBizinfoPayload(payload);
  return createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at,
    normalized,
    cursor
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--input') options.input = argv[++index];
    else if (token === '--fetched-at') options.fetched_at = argv[++index];
    else if (token === '--page-index') options.page_index = argv[++index];
    else if (token === '--help') options.help = true;
    else throw new Error(`UNKNOWN_ARGUMENT:${token}`);
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/support-radar-bizinfo-dry-run.mjs --input <fixture.json> --fetched-at <ISO timestamp> [--page-index <n>]',
    '',
    'This command is offline-only. It performs no network call and writes no database rows.'
  ].join('\n');
}

function positivePageIndex(value) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('PAGE_INDEX_INVALID');
  return parsed;
}

export function runBizinfoDryRunCli(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!options.input) throw new Error('INPUT_REQUIRED');
    if (!options.fetched_at) throw new Error('FETCHED_AT_REQUIRED');

    const inputPath = path.resolve(options.input);
    const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const pageIndex = positivePageIndex(options.page_index);
    const batch = buildBizinfoDryRun(payload, {
      fetched_at: options.fetched_at,
      cursor: pageIndex === null ? null : { page_index: pageIndex }
    });

    stdout.write(`${JSON.stringify(batch, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`BIZINFO_DRY_RUN_ERROR:${error?.message || 'UNKNOWN'}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath && import.meta.url === invokedPath) {
  process.exitCode = runBizinfoDryRunCli(process.argv.slice(2));
}
