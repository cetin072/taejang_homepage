import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/browser/promotion-browser-gate.html');

function commandExists(command) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

const chrome = process.env.CHROME_PATH
  || commandExists('google-chrome')
  || commandExists('google-chrome-stable')
  || commandExists('chromium')
  || commandExists('chromium-browser');

if (!chrome) throw new Error('PROMOTION_BROWSER_GATE_CHROME_MISSING');
if (!existsSync(fixture)) throw new Error('PROMOTION_BROWSER_GATE_FIXTURE_MISSING');

let fixtureTarget = fixture;
let tempDir = null;
const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (previewUrl) {
  const parsed = new URL(previewUrl);
  if (parsed.protocol !== 'https:') throw new Error('PROMOTION_BROWSER_GATE_PREVIEW_MUST_BE_HTTPS');
  let html = readFileSync(fixture, 'utf8');
  html = html.replaceAll('src="../../app/assets/', `src="${previewUrl}/app/assets/`);
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'taejang-promotion-preview-'));
  fixtureTarget = path.join(tempDir, 'promotion-browser-gate.html');
  writeFileSync(fixtureTarget, html, 'utf8');
  console.log(`Promotion browser gate uses deployed preview assets: ${previewUrl}`);
}

try {
  const result = spawnSync(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    '--virtual-time-budget=4000',
    '--dump-dom',
    pathToFileURL(fixtureTarget).href
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 25000,
    maxBuffer: 5 * 1024 * 1024
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PROMOTION_BROWSER_GATE_CHROME_FAILED\n${result.stderr || result.stdout}`);
  }
  if (!result.stdout.includes('PROMOTION_BROWSER_GATE_PASS')) {
    const failure = result.stdout.match(/PROMOTION_BROWSER_GATE_FAIL:[^<]*/)?.[0] || 'PASS marker missing';
    throw new Error(`PROMOTION_BROWSER_GATE_FAILED: ${failure}`);
  }

  console.log(previewUrl ? 'PROMOTION_PREVIEW_BROWSER_GATE_PASS' : 'PROMOTION_BROWSER_GATE_PASS');
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
