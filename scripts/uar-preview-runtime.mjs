const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
const stagingRef = String(process.env.STAGING_PROJECT_REF || '').trim();
if (!previewUrl) throw new Error('UAR_PREVIEW_RUNTIME_URL_MISSING');
if (!stagingRef) throw new Error('UAR_PREVIEW_RUNTIME_STAGING_REF_MISSING');

const base = new URL(previewUrl);
if (base.protocol !== 'https:') throw new Error('UAR_PREVIEW_RUNTIME_HTTPS_REQUIRED');

async function get(pathname, expectJson = false) {
  const url = new URL(pathname, `${previewUrl}/`).toString();
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  const body = expectJson ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    throw new Error(`UAR_PREVIEW_RUNTIME_HTTP_${response.status}:${url}`);
  }
  return { url, body, response };
}

// /staff/ is the authentication entry surface; /app/ is the protected work shell.
const staff = await get('staff/');
if (!staff.body.includes('login-form') || !staff.body.includes('임직원 로그인')) {
  throw new Error('UAR_PREVIEW_RUNTIME_LOGIN_SURFACE_MISSING');
}

const appShell = await get('app/');
if (!appShell.body.includes('desktop-app-shell') || !appShell.body.includes('dashboard-main') || !appShell.body.includes('app-nav')) {
  throw new Error('UAR_PREVIEW_RUNTIME_APP_SHELL_MISSING');
}

for (const asset of [
  'app/assets/phase-c-workspace-v2.js',
  'app/assets/phase-c-publication-admin.js',
  'app/assets/issue-207-promotion-information-ux.js'
]) {
  const result = await get(asset);
  if (!result.body.trim()) throw new Error(`UAR_PREVIEW_RUNTIME_EMPTY_ASSET:${asset}`);
}

const config = await get('.netlify/functions/staff-config', true);
if (!config.body || typeof config.body !== 'object') {
  throw new Error('UAR_PREVIEW_RUNTIME_STAFF_CONFIG_INVALID');
}
const supabaseUrl = String(config.body.url || '');
if (!supabaseUrl.includes(stagingRef)) {
  throw new Error(`UAR_PREVIEW_RUNTIME_WRONG_STAGING:${supabaseUrl}`);
}
if (!String(config.body.publishableKey || '').trim()) {
  throw new Error('UAR_PREVIEW_RUNTIME_PUBLISHABLE_KEY_MISSING');
}

console.log(`UAR_PREVIEW_RUNTIME_PASS ${previewUrl} -> ${stagingRef}`);
