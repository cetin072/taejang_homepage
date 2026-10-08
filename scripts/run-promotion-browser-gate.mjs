import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = [
  { file: 'operations-public-text-edit-gate.html', marker: 'OPERATIONS_PUBLIC_TEXT_EDIT_GATE_PASS' },
  { file: 'operations-owned-promotion-gate.html', marker: 'OPERATIONS_OWNED_PROMOTION_GATE_PASS' },
  { file: 'general-worker-browser-gate.html', marker: 'GENERAL_WORKER_BROWSER_GATE_PASS' },
  { file: 'promotion-browser-gate.html', marker: 'PROMOTION_BROWSER_GATE_PASS' },
  { file: 'promotion-authoring-upload-gate.html', marker: 'PROMOTION_AUTHORING_UPLOAD_GATE_PASS' },
  { file: 'promotion-archive-delete-gate.html', marker: 'PROMOTION_ARCHIVE_DELETE_GATE_PASS' },
  { file: 'promotion-public-link-rendering-gate.html', marker: 'PROMOTION_PUBLIC_LINK_RENDERING_GATE_PASS' },
  { file: 'promotion-v2-publication-gate.html', marker: 'PROMOTION_V2_PUBLICATION_GATE_PASS' },
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

function runFixture(spec, viewport) {
  const fixture = path.join(root, 'tests/browser', spec.file);
  if (!existsSync(fixture)) throw new Error(`PROMOTION_BROWSER_GATE_FIXTURE_MISSING:${spec.file}`);

  let fixtureTarget = fixture;
  let tempDir = null;
  if (previewUrl) {
    let html = readFileSync(fixture, 'utf8');
    html = html.replaceAll('src="../../app/assets/', `src="${previewUrl}/app/assets/`);
    html = html.replaceAll('href="../../app/assets/', `href="${previewUrl}/app/assets/`);
    html = html.replaceAll('src="../../assets/', `src="${previewUrl}/assets/`);
    html = html.replaceAll('href="../../assets/', `href="${previewUrl}/assets/`);
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'taejang-promotion-preview-'));
    fixtureTarget = path.join(tempDir, spec.file);
    writeFileSync(fixtureTarget, html, 'utf8');
    console.log(`Browser gate uses deployed preview assets (${spec.file}): ${previewUrl}`);
  }

  try {
    const result = spawnSync(chrome, [
      '--headless=new',
      `--window-size=${viewport.size}`,
      '--force-device-scale-factor=1',
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
    console.log(`${spec.marker}:${previewUrl ? 'PREVIEW' : 'LOCAL'}:${viewport.label}`);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

const viewports = [
  { label: 'PC', size: '1440,1000' },
  { label: 'MOBILE', size: '390,844' }
];
for (const viewport of viewports) {
  for (const fixture of fixtures) runFixture(fixture, viewport);
}
console.log(previewUrl ? 'PROMOTION_PREVIEW_BROWSER_GATE_PASS' : 'PROMOTION_BROWSER_GATE_PASS');
