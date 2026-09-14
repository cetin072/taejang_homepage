import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = [
  { file: 'promotion-browser-gate.html', marker: 'PROMOTION_BROWSER_GATE_PASS' },
  { file: 'sidebar-runtime-gate.html', marker: 'SIDEBAR_RUNTIME_GATE_PASS' }
];

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

const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (previewUrl) {
  const parsed = new URL(previewUrl);
  if (parsed.protocol !== 'https:') throw new Error('PROMOTION_BROWSER_GATE_PREVIEW_MUST_BE_HTTPS');
}

function runFixture(spec) {
  const fixture = path.join(root, 'tests/browser', spec.file);
  if (!existsSync(fixture)) throw new Error(`PROMOTION_BROWSER_GATE_FIXTURE_MISSING:${spec.file}`);

  let fixtureTarget = fixture;
  let tempDir = null;
  if (previewUrl) {
    let html = readFileSync(fixture, 'utf8');
    html = html.replaceAll('src="../../app/assets/', `src="${previewUrl}/app/assets/`);
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'taejang-promotion-preview-'));
    fixtureTarget = path.join(tempDir, spec.file);
    writeFileSync(fixtureTarget, html, 'utf8');
    console.log(`Browser gate uses deployed preview assets (${spec.file}): ${previewUrl}`);
  }

  try {
    const result = spawnSync(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--allow-file-access-from-files',
      '--virtual-time-budget=5000',
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
      throw new Error(`PROMOTION_BROWSER_GATE_CHROME_FAILED:${spec.file}\n${result.stderr || result.stdout}`);
    }
    if (!result.stdout.includes(spec.marker)) {
      const failure = result.stdout.match(/[A-Z_]+_GATE_FAIL:[^<]*/)?.[0] || `${spec.marker} missing`;
      throw new Error(`PROMOTION_BROWSER_GATE_FAILED:${spec.file}: ${failure}`);
    }
    console.log(`${spec.marker}:${previewUrl ? 'PREVIEW' : 'LOCAL'}`);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

for (const fixture of fixtures) runFixture(fixture);
console.log(previewUrl ? 'PROMOTION_PREVIEW_BROWSER_GATE_PASS' : 'PROMOTION_BROWSER_GATE_PASS');
