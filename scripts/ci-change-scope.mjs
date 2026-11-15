import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Only reviewed public presentation files may avoid platform integration.
// Unknown files, shared JS, build/dependency/CI changes always require full QA.
const publicPages = new Set(`404 about account-deletion activities archive business certifications community-esg-records community-esg employee-app-privacy employee-app farm greeting history index location minhwa-gallery new-zealand-salt partnership privacy promotion resources terms terrarium thanks why-minhwa worklog workplace`.split(' ').map(name => `${name}.html`));
const publicStyles = new Set(`certifications community-esg content-hub-polish employee-app engagement-polish farm featured-article featured-stories home-partners-contact listing-polish location minhwa-gallery mobile-layout-fixes new-zealand-salt partnership-compact partnership-dialog photo-mode product-inquiry public-share resources site-polish story-pages styles terrarium visual-hierarchy worklog workplace`.split(' ').map(name => `assets/css/${name}.css`));
const publicTests = new Set([
  'tests/business-section-hierarchy.test.js',
  'tests/public-homepage-main-simplification.test.js',
  'tests/hero-article-browser.mjs',
  'tests/public-seo-content-browser.mjs',
  'tests/terrarium-hub.test.js',
  'tests/helpers/public-header-checks.mjs',
  'tests/helpers/public-page-ready-checks.mjs',
  'tests/employee-app-landing.test.js',
  'tests/worklog-landing.test.js',
  'tests/new-zealand-salt.test.cjs',
  'tests/public-buttons-browser.mjs',
  'tests/employee-app-browser.mjs',
  'tests/partnership-browser.mjs',
  'tests/location-browser.mjs',
  'tests/certifications-browser.mjs',
]);
const isDocument = file => /^(?:docs\/.*|[^/]+)\.md$/.test(file);
const isPublic = file => publicPages.has(file) || publicStyles.has(file) || publicTests.has(file) || /^assets\/images\/.*\.(?:png|jpe?g|webp|gif|avif)$/.test(file);

export function classifyChanges(files) {
  if (!files.length) return 'full';
  if (files.every(isDocument)) return 'docs';
  if (files.every(file => isDocument(file) || isPublic(file))) return 'public';
  return 'full';
}

export function changedFiles(eventName, event) {
  let range;
  if (eventName === 'pull_request') {
    range = `${event.pull_request.base.sha}...${event.pull_request.head.sha}`;
  } else if (eventName === 'push' && event.before && !/^0+$/.test(event.before)) {
    range = `${event.before}..${event.after}`;
  } else return [];
  // NUL delimiters preserve renamed/deleted paths and unusual filenames.
  return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', range], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let scope = 'full';
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    scope = classifyChanges(changedFiles(process.env.GITHUB_EVENT_NAME, event));
  } catch (error) {
    console.warn(`Cannot establish change scope; running full checks: ${error.message}`);
  }
  console.log(`Validation scope: ${scope}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\nrun_full=${scope === 'full'}\n`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `VALIDATION_SCOPE=${scope}\n`);
}
