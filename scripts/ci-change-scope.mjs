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

// A small, explicit map for isolated pages. Shared/unmapped files retain all
// public checks. Keep dependency decisions here, not in workflow expressions.
const pageChecks = {
  'index.html': ['hero', 'navigation', 'seo'],
  'certifications.html': ['certifications', 'navigation', 'seo'],
  'assets/css/certifications.css': ['certifications'],
  'location.html': ['location', 'navigation', 'seo'],
  'assets/css/location.css': ['location'],
  'archive.html': ['archive', 'navigation', 'seo'],
  'new-zealand-salt.html': ['salt', 'navigation', 'seo'],
};
const browserChecks = ['hero', 'salt', 'archive', 'navigation', 'certifications', 'location', 'seo'];
export function selectBrowserChecks(files) {
  const scope = classifyChanges(files);
  if (scope === 'docs') return [];
  const relevant = files.filter(file => !isDocument(file));
  if (scope === 'full' || relevant.some(file => !pageChecks[file])) return browserChecks;
  return browserChecks.filter(check => relevant.some(file => pageChecks[file].includes(check)));
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
  let files = [];
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    files = changedFiles(process.env.GITHUB_EVENT_NAME, event);
    scope = classifyChanges(files);
  } catch (error) {
    console.warn(`Cannot establish change scope; running full checks: ${error.message}`);
  }
  const checks = selectBrowserChecks(files);
  const reason = scope === 'full' ? 'Shared, unknown or validation configuration change' : scope === 'docs' ? 'Documentation only' : 'Public changes; isolate mapped pages, otherwise cover shared public dependencies';
  console.log(`Validation scope: ${scope}; ${reason}; browser: ${checks.join(', ') || 'none'}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Validation: ${scope}\n\n${reason}\n\nBrowser: ${checks.join(', ') || 'none'}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, browserChecks.map(check => `browser_${check}=${checks.includes(check)}`).join('\n') + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\nrun_full=${scope === 'full'}\n`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `VALIDATION_SCOPE=${scope}\n`);
}
