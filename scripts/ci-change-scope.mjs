import { createHash } from 'node:crypto';
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

// A reviewed file may have several consumers. Add the consumer tests in the
// same change as its registration. Unregistered paths keep the broad suite.
const owners = new Map();
function register(groups, paths) {
  for (const file of paths.split(/\s+/).filter(Boolean)) owners.set(file, groups.split(' '));
}
register('notice', `
  app/assets/notice-admin.js app/assets/notice-worker.js app/assets/notice-media.js
  tests/browser/notice-authoring-ux-gate.html tests/notice-authoring-browser.mjs
  tests/notice-management-browser.mjs tests/notice-initialization-browser.mjs
  tests/goal-331-dashboard-card-notice-management.test.js tests/notice-ops-review-photo.test.js
  tests/notice-management-history.test.js tests/helpers/notice-browser-flow.mjs
  tests/notice-review-media-auth-integration.mjs tests/staff-schedules-notices-auth-integration.mjs
`);
register('notice calendar', 'app/assets/employee-calendar.js');
register('calendar', 'tests/employee-calendar-auth-integration.mjs tests/helpers/employee-calendar-browser-flow.mjs');
register('notice editor', `
  src/promotion/editor.js app/assets/promotion-visual-editor.js
  app/assets/issue-207-promotion-information-ux.js tests/browser/promotion-browser-gate.html
`);
register('notice editor article', 'assets/js/promotion-document.js');
register('editor', 'tests/promotion-document.test.mjs tests/promotion-visual-editor-browser.mjs');
register('mobile', `
  mobile/app/notices/[id].tsx mobile/src/features/notices/notice-body.tsx
  mobile/src/features/notices/notice-api.ts mobile/src/features/settings/patch-notes.ts
  tests/mobile-notices.test.mjs tests/mobile-notice-read-state.test.mjs tests/mobile-notice-cache.test.mjs
`);
register('sales', `
  app/assets/erp-sales.js app/assets/erp-sales.css tests/erp-sales-auth-integration.mjs
  tests/erp-sales-isolated.mjs tests/erp-sales-amount-adjustments.mjs
  tests/erp-product-automation-isolated.mjs tests/erp-product-automation-browser.mjs
  tests/erp-sales-browser.mjs tests/erp-sales-usability.mjs tests/erp-sales-workflow-browser.mjs
`);
register('monthly', `
  app/assets/monthly-client-documents.js app/assets/monthly-client-documents.css
  app/assets/erp-single-service-documents.mjs
  app/assets/monthly-client-document-core.js app/assets/monthly-client-document-docx.js
  app/assets/monthly-client-document-email.js app/assets/monthly-client-document-preview.mjs
  app/assets/monthly-client-document-template.json app/assets/monthly-client-document-template-v1.json
  app/assets/monthly-client-document-template-stages.json app/assets/monthly-client-document-package.zip
  tests/monthly-client-documents-browser.mjs tests/monthly-client-documents-auth-integration.mjs
  tests/monthly-client-document-core.test.js tests/monthly-client-document-access.test.js
  tests/monthly-client-document-email.test.js tests/monthly-client-document-render.mjs
  tests/monthly-client-document-stages-render.mjs scripts/render-monthly-client-document.mjs
`);

const noticeMigration = 'supabase/migrations/20261123150000_notice_visual_body.sql';
function groupsFor(file) {
  if (isDocument(file)) return [];
  if (isPublic(file)) return ['public'];
  if (file === noticeMigration) {
    // The audited SQL is notice-only. Editing or deleting it needs fresh review.
    try {
      const hash = createHash('sha256').update(readFileSync(new URL('../' + file, import.meta.url))).digest('hex');
      if (hash === '3c376defa160239a901c9b90f52c4b608f9657189e4dd9403ee9715b25918cfa') return ['notice','database','mobileReader'];
    } catch { /* deleted file */ }
  }
  return owners.get(file);
}

export function validationPlan(files) {
  const groups = new Set();
  const unknown = [];
  for (const file of files) {
    const matches = groupsFor(file);
    if (!matches) unknown.push(file);
    else for (const group of matches) groups.add(group);
  }
  const full = !files.length || unknown.length > 0;
  const scope = full ? 'full' : !groups.size ? 'docs' :
    groups.size === 1 && groups.has('public') ? 'public' : 'targeted';
  const needs = group => full || groups.has(group);
  const platform = ['notice','calendar','editor','monthly','sales','database','mobileReader'].some(needs);
  const db = ['notice','calendar','monthly','sales','database'].some(needs);
  return {scope, groups:[...groups].sort(), unknown, flags:{
    platform, db, notice:needs('notice'), calendar:needs('calendar'), editor:needs('editor'),
    monthly:needs('monthly'), sales:needs('sales'), article:needs('article'), mobile:needs('mobile'),
    public_static:needs('public') || needs('article'),
    landing:full || files.some(file => isPublic(file) && !pageChecks[file]),
    reader_contract:!full && groups.has('mobileReader') && !groups.has('mobile'),
    promotion_setup:needs('notice') || needs('editor'),
  }};
}
export const classifyChanges = files => validationPlan(files).scope;

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
  const relevant = files.filter(isPublic);
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
    if (process.argv[2] === '--files') files = process.argv.slice(3);
    else {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      files = changedFiles(process.env.GITHUB_EVENT_NAME, event);
    }
    scope = classifyChanges(files);
  } catch (error) {
    console.warn(`Cannot establish change scope; running full checks: ${error.message}`);
  }
  const checks = selectBrowserChecks(files);
  const plan = validationPlan(files);
  const reason = plan.unknown.length ? 'Unmapped paths: ' + plan.unknown.join(', ') :
    !files.length ? 'No reliable diff' : plan.groups.join(', ') || 'Documentation only';
  const flags = Object.entries(plan.flags);
  const summary = `Validation: ${scope} (${reason})\nRun: ${flags.filter(([,on])=>on).map(([name])=>name).join(', ') || 'none'}\nSkip: ${flags.filter(([,on])=>!on).map(([name])=>name).join(', ') || 'none'}\nPublic browser checks: ${checks.join(', ') || 'none'}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (process.env.GITHUB_OUTPUT) {
    const outputs = {...plan.flags, scope, run_full:scope === 'full', public_browser:checks.length > 0};
    for (const check of browserChecks) outputs['browser_' + check] = checks.includes(check);
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k,v])=>`${k}=${v}\n`).join(''));
  }
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `VALIDATION_SCOPE=${scope}\nVALIDATION_GROUPS=${plan.groups.join(',')}\n`);
}
