import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import handler, { config } from '../netlify/edge-functions/public-promotion-seo.mjs';

const base = readFileSync('promotion.html', 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const full = {
  content_id: id,
  content_type: 'homepage_article',
  title: '태장 <환경> 활동 & 기록',
  summary: '함께하는 태장 & 지역사회',
  published_date: '2026-10-08',
  public_body: '첫 번째 현장을 소개합니다.\n\n두 번째 현장도 기록합니다.',
  byline: '태장 홍보팀',
  public_media: [{ url: 'https://example.org/approved-photo.webp', alt: '공개 승인된 현장' }],
  link_source_type: 'none',
  external_url: ''
};

function setup({ detail = [full], feed = [full], error = false } = {}) {
  const previous = { netlify: globalThis.Netlify, fetch: globalThis.fetch };
  const rpcNames = [];
  globalThis.Netlify = { env: { get(name) {
    return name === 'SUPABASE_URL' ? 'https://public-example.supabase.co'
      : name === 'SUPABASE_PUBLISHABLE_KEY' ? 'public-anon-only' : undefined;
  } } };
  globalThis.fetch = async (url, request) => {
    const rpc = new URL(url).pathname.split('/').pop();
    rpcNames.push(rpc);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.apikey, 'public-anon-only');
    assert.equal(request.headers.Authorization, 'Bearer public-anon-only');
    const status = error ? 503 : 200;
    return new Response(JSON.stringify(rpc === 'get_public_promotion_content' ? detail : feed), { status });
  };
  return {
    rpcNames,
    restore() { globalThis.Netlify = previous.netlify; globalThis.fetch = previous.fetch; }
  };
}

const context = { next: async () => new Response(base, { status: 200, headers: { 'content-type': 'text/html' } }) };

test('approved promotion detail provides unique bot-readable head and body', async () => {
  const env = setup();
  try {
    const response = await handler(new Request('https://preview.example/promotion.html?id=' + id), context);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const html = await response.text();
    assert.match(html, /<title>태장 &lt;환경&gt; 활동 &amp; 기록 \| 농업회사법인 태장 주식회사<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/taejang.co.kr\/promotion.html\?id=11111111/);
    assert.match(html, /<meta property="og:image" content="https:\/\/example.org\/approved-photo.webp">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/taejang.co.kr\/promotion.html\?id=/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /"@type":"Article"/);
    assert.match(html, /"datePublished":"2026-10-08"/);
    assert.match(html, /<article class="article" data-seo-promotion-id="/);
    assert.match(html, /<h1>태장 &lt;환경&gt; 활동 &amp; 기록<\/h1>/);
    assert.match(html, /첫 번째 현장을 소개합니다\./);
    assert.match(html, /두 번째 현장도 기록합니다\./);
    assert.doesNotMatch(html, /<h1>글을 불러오고 있습니다<\/h1>/);
    assert.deepEqual(env.rpcNames, ['get_public_promotion_content']);
    const client = readFileSync('assets/js/promotion-detail.js', 'utf8');
    assert.match(client, /data-seo-promotion-id/, 'Keep SSR fallback intact when JS fails');
  } finally { env.restore(); }
});

test('invalid/unpublished promotion URLs are not indexed or revealed', async () => {
  const env = setup({ detail: [] });
  try {
    let response = await handler(new Request('https://preview.example/promotion.html?id=not-a-uuid'), context);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    assert.equal(env.rpcNames.length, 0, 'invalid ID does not query RPC');
    response = await handler(new Request('https://preview.example/promotion.html?id=' + id), context);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(env.rpcNames, ['get_public_promotion_content']);
  } finally { env.restore(); }
});

test('unparameterized template preserves original static behavior', async () => {
  const env = setup();
  try {
    const response = await handler(new Request('https://preview.example/promotion.html'), context);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /글을 불러오고 있습니다/);
    assert.deepEqual(env.rpcNames, []);
  } finally { env.restore(); }
});

test('dynamic sitemap lists only internally published public promotion URLs', async () => {
  const env = setup({ feed: [
    full,
    { content_id: other, content_type: 'press_release', title: '보도자료' },
    { content_id: '33333333-3333-4333-8333-333333333333', content_type: 'external_content', title: '외부 원문' },
    { content_id: 'bad-id', content_type: 'homepage_article' },
    full
  ] });
  try {
    const response = await handler(new Request('https://preview.example/sitemap-promotions.xml'), context);
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.match(xml, /<loc>https:\/\/taejang.co.kr\/promotion.html\?id=11111111/);
    assert.match(xml, /<loc>https:\/\/taejang.co.kr\/promotion.html\?id=22222222/);
    assert.equal((xml.match(/<url>/g) || []).length, 2);
    assert.doesNotMatch(xml, /33333333|bad-id|example.org/);
    assert.deepEqual(env.rpcNames, ['list_public_promotion_feed']);
    assert.deepEqual(config.path, ['/promotion.html', '/sitemap-promotions.xml']);
    assert.match(readFileSync('robots.txt', 'utf8'), /sitemap-promotions\.xml/);
  } finally { env.restore(); }
});

test('public RPC outage fails closed without disclosing content', async () => {
  const env = setup({ error: true });
  try {
    for (const route of ['/promotion.html?id=' + id, '/sitemap-promotions.xml']) {
      const response = await handler(new Request('https://preview.example' + route), context);
      assert.equal(response.status, 503);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
    }
  } finally { env.restore(); }
});
