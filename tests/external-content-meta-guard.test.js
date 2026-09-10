import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = readFileSync('netlify/functions/external-content-meta.mjs', 'utf8');

test('external metadata function uses capability-backed durable quota instead of legacy role list', () => {
  assert.match(source, /rpc\/consume_external_content_meta_quota/);
  assert.doesNotMatch(source, /rpc\/get_my_access_context/);
  assert.doesNotMatch(source, /promotion_staff['"],\s*['"]promotion_lead/);
});

test('external metadata function fails closed and distinguishes forbidden from rate limiting', () => {
  assert.match(source, /AUTHORIZATION_UNAVAILABLE/);
  assert.match(source, /status:\s*503/);
  assert.match(source, /RATE_LIMITED/);
  assert.match(source, /status:\s*429/);
  assert.match(source, /retry_after_seconds/);
  assert.match(source, /FORBIDDEN/);
});

test('existing SSRF and response-size defenses remain in place', () => {
  assert.match(source, /dns\.lookup/);
  assert.match(source, /BLOCKED_HOST/);
  assert.match(source, /redirect:\s*['"]manual['"]/);
  assert.match(source, /redirectCount\s*<=\s*3/);
  assert.match(source, /7000/);
  assert.match(source, /1_000_000/);
  assert.match(source, /text\/html/);
});

test('external metadata function remains syntactically valid', () => {
  const result = spawnSync(process.execPath, ['--check', 'netlify/functions/external-content-meta.mjs'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
