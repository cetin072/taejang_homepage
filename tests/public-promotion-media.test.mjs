import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {promotionMedia, promotionImageUrl, IMAGE_UNAVAILABLE} from '../assets/js/public-promotion-media.mjs';
import feed from '../netlify/functions/public-promotion-feed.mjs';
import seo from '../netlify/edge-functions/public-promotion-seo.mjs';
const naver='https://blogthumb.pstatic.net/synthetic/blocked.jpg';
const uploaded='https://owned.example.test/approved.jpg';
const id='11111111-1111-4111-8111-111111111111';
const item={content_id:id,title:'합성 공개 소식',summary:'합성 검수',public_body:'실제 사진을 대신하지 않는 본문',content_type:'homepage_article',link_source_type:'none',hero_image_url:naver,public_media:[],published_date:'2026-10-26'};
test('Naver hotlink heroes become an explicit unavailable state without replacing source data',()=>{
 const before=JSON.stringify(item),display=promotionMedia(item);
 assert.equal(display.heroUrl,'');assert.equal(display.unavailable,IMAGE_UNAVAILABLE);assert.equal(JSON.stringify(item),before);
 for(const url of [naver,'https://postfiles.pstatic.net/test.jpg','https://blogfiles.pstatic.net/test.jpg','javascript:alert(1)','https://user:password@example.test/a.jpg'])assert.equal(promotionImageUrl(url),'');
 assert.equal(promotionImageUrl(uploaded),uploaded);
});
test('selected normal photos remain authoritative and external reference-only heroes stay excluded',()=>{
 assert.equal(promotionMedia({...item,link_source_type:'taejang_blog',public_media:[{url:uploaded,alt:'승인된 사진'}]}).heroUrl,uploaded);
 const reference=promotionMedia({...item,link_source_type:'external',hero_image_url:'https://other.example.test/reference.jpg'});
 assert.equal(reference.heroUrl,'');assert.equal(reference.unavailable,'');
 const ordered=promotionMedia({...item,public_media:[{url:naver},{url:uploaded}]});assert.equal(ordered.heroUrl,'');assert.equal(ordered.gallery[0].displayUrl,uploaded,'do not silently substitute a different selected photo as hero');
});
async function withRpc(callback){
 const previous={netlify:globalThis.Netlify,fetch:globalThis.fetch};let rows=[item];const calls=[];
 globalThis.Netlify={env:{get:key=>key==='SUPABASE_URL'?'https://public-example.supabase.co':key==='SUPABASE_PUBLISHABLE_KEY'?'synthetic-public-key':undefined}};
 globalThis.fetch=async(url,options)=>{assert.ok(String(url).includes('/rest/v1/rpc/'),'no image fetch or proxy');assert.equal(options.method,'POST');calls.push(url);return new Response(JSON.stringify(rows));};
 try{await callback({calls,setRows:value=>{rows=value;}});}finally{globalThis.Netlify=previous.netlify;globalThis.fetch=previous.fetch;}
}
test('live feed uses the same unavailable/normal policy without copying or fetching external images',async()=>withRpc(async({setRows,calls})=>{
 let r=await feed(new Request('https://preview.example/.netlify/functions/public-promotion-feed?format=json'));let data=await r.json();assert.equal(data.items[0].thumbnail,'');assert.equal(data.items[0].thumbnailUnavailable,IMAGE_UNAVAILABLE);
 setRows([{...item,public_media:[{url:uploaded}]}]);r=await feed(new Request('https://preview.example/.netlify/functions/public-promotion-feed?format=json'));data=await r.json();assert.equal(data.items[0].thumbnail,uploaded);assert.equal(data.items[0].thumbnailUnavailable,'');assert.equal(calls.length,2);
}));
test('initial server HTML is usable without JS, omits the blocked image and keeps approved images',async()=>withRpc(async({setRows})=>{
 const context={next:async()=>new Response(readFileSync('promotion.html','utf8'),{headers:{'content-type':'text/html'}})};
 let r=await seo(new Request('https://preview.example/promotion.html?id='+id),context);let html=await r.text();assert.ok(html.includes(IMAGE_UNAVAILABLE));assert.match(html,/실제 사진을 대신하지 않는 본문/);assert.doesNotMatch(html,/<img[^>]+src="https:\/\/blogthumb/);assert.match(html,/og:image" content="https:\/\/taejang.co.kr\/images\/og-taejang.png/);
 setRows([{...item,public_media:[{url:uploaded,alt:'승인된 사진'}]}]);r=await seo(new Request('https://preview.example/promotion.html?id='+id),context);html=await r.text();assert.ok(html.includes('src="'+uploaded+'"'));assert.ok(!html.includes(IMAGE_UNAVAILABLE));
}));
