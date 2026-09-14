import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

if (!chrome) {
  throw new Error('PROMOTION_BROWSER_GATE_CHROME_MISSING');
}
if (!existsSync(fixture)) {
  throw new Error('PROMOTION_BROWSER_GATE_FIXTURE_MISSING');
}

const result = spawnSync(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--allow-file-access-from-files',
  '--virtual-time-budget=3000',
  '--dump-dom',
  pathToFileURL(fixture).href
], {
  cwd: root,
  encoding: 'utf8',
  timeout: 20000,
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

console.log('PROMOTION_BROWSER_GATE_PASS');
