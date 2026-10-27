import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/js/public-promotion-media.js';
import edge from '../netlify/edge-functions/public-promotion-seo.mjs';
import feed from '../netlify/functions/public-promotion-feed.mjs';
import { readFileSync } from 'node:fs';
const policy = globalThis.TAEJANG_PUBLIC_MEDIA;
const origin = 'https://public-example.supabase.co';
const photo = name => origin + '/storage/v1/object/public/promotion-media/' + name + '.jpg';
const id = '11111111-1111-4111-8111-111111111111';
const row = { content_id: id, title: '공개 소식', content_type: 'homepage_article', public_body: '보존할 본문', public_media: [] };

test('unselected imported heroes, including mislabeled none, signed and foreign URLs never become public images', () => {
  for (const link_source_type of ['none', 'external', 'taejang_blog']) {
    assert.deepEqual(policy.candidates({ ...row, link_source_type, hero_image_url: 'https://blogthumb.pstatic.net/imported.jpg' }), [policy.DEFAULT_IMAGE]);
  }
  assert.deepEqual(policy.candidates({ ...row, hero_image_url: photo('not-selected') }), [policy.DEFAULT_IMAGE]);
  for (const url of [photo('one') + '?token=secret', 'http://taejang.co.kr/images/test.jpg', 'https://public-example.supabase.co.evil.test/storage/v1/object/public/promotion-media/a.jpg']) assert.equal(policy.persistent(url), false);
});

test('selected hero precedes other approved attachments, with exactly one final default', () => {
  const item = { ...row, hero_image_url: photo('two'), public_media: [{url:photo('one')}, {url:photo('two'),alt:'대표'}, {url:photo('one')}] };
  assert.deepEqual(policy.candidates(item), [photo('two'),photo('one'),policy.DEFAULT_IMAGE]);
  assert.equal(policy.alt(item,photo('two')),'대표');
});

test('runtime fallback handles already failed SSR images, tries attachments once, and stops at default failure', () => {
  let listener;
  const image = {src:photo('broken'),complete:true,naturalWidth:0,getAttribute(){return this.src;},addEventListener(name,fn){assert.equal(name,'error');listener=fn;}};
  policy.bind(image,[photo('broken'),photo('next')]);
  assert.equal(image.src,photo('next'));
  listener(); assert.equal(image.src,policy.DEFAULT_IMAGE);
  for(let i=0;i<5;i++) listener();
  assert.equal(image.src,policy.DEFAULT_IMAGE);
});

test('feed, SSR body and crawler metadata agree on broken/photo-free/external cases without changing approved data', async () => {
  const previous = { fetch:globalThis.fetch, Netlify:globalThis.Netlify };
  let current;
  const probes=[];
  globalThis.Netlify={env:{get:name=>name==='SUPABASE_URL'?origin:'public-anon-key'}};
  globalThis.fetch=async (url, options)=>{
    if(options.method==='HEAD') {
      probes.push(String(url));
      assert.equal(options.redirect,'error');
      assert.equal(options.headers,undefined,'probe must not send auth');
      return new Response(null,{status:String(url).includes('broken')?404:200,headers:{'content-type':String(url).includes('html')?'text/html':'image/jpeg'}});
    }
    return Response.json([current]);
  };
  try {
    for (const fixture of [
      {...row,hero_image_url:'https://blogthumb.pstatic.net/imported.jpg',link_source_type:'none'},
      {...row,hero_image_url:'https://cdn.gnen.net/missing.jpg',link_source_type:'external'},
      {...row,public_media:[{url:photo('broken')},{url:photo('next')}]},
      {...row,public_media:[{url:photo('html')}]},
      row
    ]) {
      current=fixture;
      const before=JSON.stringify(current);
      const expected=fixture.public_media.length===2?photo('next'):policy.DEFAULT_IMAGE;
      const list=await (await feed(new Request('https://preview.example/.netlify/functions/public-promotion-feed?format=json'))).json();
      assert.equal(list.items[0].thumbnail,expected);
      const detail=await (await feed(new Request('https://preview.example/.netlify/functions/public-promotion-feed?id='+id))).json();
      assert.equal(detail.item.public_image.url,expected);
      const response=await edge(new Request('https://preview.example/promotion.html?id='+id),{next:async()=>new Response(readFileSync('promotion.html','utf8'))});
      assert.equal(response.status,200);
      const html=await response.text();
      assert.ok(html.includes('<meta property="og:image" content="'+expected+'">'));
      assert.ok(html.includes('<img src="'+expected+'" data-public-image-candidates='));
      assert.ok(html.includes('<meta name="twitter:image" content="'+expected+'">'));
      assert.equal(JSON.stringify(current),before,'approved revision must not be modified');
    }
    assert.ok(probes.every(url=>url.startsWith(origin)),'never fetch imported remote OG');
    current={...row,public_media:[{url:'https://foreign.supabase.co/storage/v1/object/public/promotion-media/a.jpg'}]};
    const image=await policy.resolve(current,origin);assert.equal(image.url,policy.DEFAULT_IMAGE);
  } finally {Object.assign(globalThis,previous);}
});
