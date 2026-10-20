import assert from 'node:assert/strict';

const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.UAR_HEAD_SHA;
let preview = process.env.PREVIEW_URL;
assert.match(sha || '', /^[a-f0-9]{40}$/);
if (!preview) {
  const result = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/status`, {
    headers: { Authorization:`Bearer ${process.env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json' }, signal:AbortSignal.timeout(10000),
  });
  assert.equal(result.status,200);
  const status = (await result.json()).statuses.find(x => x.context === 'netlify/taejang-homepage/deploy-preview');
  assert.equal(status?.state,'success', 'exact-head Preview must be ready');
  preview = status.target_url;
}
const origin = new URL(preview);
assert.match(origin.hostname, /^deploy-preview-\d+--taejang-homepage\.netlify\.app$/);
const response = await fetch(new URL('/.netlify/functions/staff-config', origin), { signal:AbortSignal.timeout(15000), cache:'no-store' });
assert.equal(response.status,200);
assert.match(response.headers.get('cache-control') || '', /no-store/);
const config = await response.json();
assert.equal(typeof config.url, 'string'); assert.equal(typeof config.publishableKey, 'string');
assert.equal(new URL(config.url).hostname, 'jgsxpdflgkqroecfjzxq.supabase.co');
assert.equal(config.mobileRelease.force_update,false);
assert.equal(config.mobileRelease.minimum_version,null);
assert.equal(config.mobileRelease.minimum_version_code,null);
const latest = config.mobileRelease.latest_version_code;
assert.ok(latest === null ? config.mobileRelease.latest_version === null : Number.isSafeInteger(latest) && latest > 0 && /^\d+\.\d+\.\d+$/.test(config.mobileRelease.latest_version));
assert.ok(!config.mobileRelease.store_url || config.mobileRelease.store_url === 'https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff');
// Do not log public credentials, staff information or unrelated API payloads.
console.log('OPTIONAL_RELEASE_PREVIEW_PASS', JSON.stringify({ head:sha, preview:origin.origin, status:response.status, mobileRelease:config.mobileRelease }));
