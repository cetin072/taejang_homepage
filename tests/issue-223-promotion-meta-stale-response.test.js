'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const guardSource = fs.readFileSync(path.join(root, 'app/assets/issue-223-promotion-meta-stale-guard.js'), 'utf8');
const appUiSource = fs.readFileSync(path.join(root, 'app/assets/app-ui.js'), 'utf8');
const appIndex = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(root, 'app/assets/phase-c-workspace-v2.js'), 'utf8');

function loadGuard({ currentUrl, responseStatus = 200 } = {}) {
  const input = { value: currentUrl ?? '' };
  let calls = 0;
  const originalFetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ url: 'https://blog.naver.com/example/123' }), {
      status: responseStatus,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const window = {
    fetch: originalFetch,
    location: { href: 'https://preview.example/app/' }
  };
  const document = {
    querySelector(selector) {
      assert.equal(selector, '#dashboard-main .phase-c-board-composer .phase-c-link-tools input[type="url"]');
      return input;
    }
  };
  const context = vm.createContext({ window, document, Response, URL, JSON, Object, String });
  vm.runInContext(guardSource, context);
  return { window, input, calls: () => calls };
}

test('Issue #223 stale guard is Core-static before official metadata observer and Branch composer', () => {
  const guardIndex = appIndex.indexOf('assets/issue-223-promotion-meta-stale-guard.js');
  const officialIndex = appIndex.indexOf('assets/official-channel-config.js');
  const workspaceIndex = appUiSource.indexOf("['assets/phase-c-workspace-v2.js', 'phase-c-workspace-v2']");
  assert.ok(guardIndex >= 0, 'Issue #223 stale-response guard must be Core-loaded');
  assert.ok(officialIndex > guardIndex, 'stale guard must wrap fetch before the official metadata observer');
  assert.ok(workspaceIndex >= 0, 'active promotion composer remains a Branch module');
  assert.doesNotMatch(appUiSource, /issue-223-promotion-meta-stale-guard/);
  assert.doesNotMatch(appUiSource, /official-channel-config/);
});

test('one metadata request remains one network call when URL is unchanged', async () => {
  const requestedUrl = 'https://blog.naver.com/example/123';
  const { window, calls } = loadGuard({ currentUrl: requestedUrl });
  const response = await window.fetch('/.netlify/functions/external-content-meta', {
    method: 'POST',
    body: JSON.stringify({ url: requestedUrl })
  });
  assert.equal(response.status, 200);
  assert.equal(calls(), 1);
  const payload = await response.json();
  assert.equal(payload.url, requestedUrl);

  const activeFetchCalls = (workspaceSource.match(/fetchExternalMeta\(external\.value\.trim\(\)\)/g) || []).length;
  assert.equal(activeFetchCalls, 1, 'active composer should keep exactly one metadata fetch owner');
});

test('late Naver metadata response is rejected after user changes the URL', async () => {
  const requestedUrl = 'https://blog.naver.com/example/123';
  const { window, input, calls } = loadGuard({ currentUrl: requestedUrl });

  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const wrappedFetch = window.fetch;
  const originalGuardedFetch = async (inputArg, initArg) => {
    const task = wrappedFetch(inputArg, initArg);
    input.value = 'https://blog.naver.com/example/456';
    release();
    await pending;
    return task;
  };

  const response = await originalGuardedFetch('/.netlify/functions/external-content-meta', {
    method: 'POST',
    body: JSON.stringify({ url: requestedUrl })
  });
  assert.equal(calls(), 1);
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.error, 'STALE_LINK_METADATA');
  assert.match(payload.message, /주소가 바뀌어 이전 링크 결과는 반영하지 않았습니다/);
});

test('non-metadata requests pass through untouched', async () => {
  const { window, calls } = loadGuard({ currentUrl: 'https://blog.naver.com/example/123' });
  const response = await window.fetch('/.netlify/functions/staff-config', { method: 'GET' });
  assert.equal(response.status, 200);
  assert.equal(calls(), 1);
});
