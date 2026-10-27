import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import handler from '../netlify/functions/external-content-meta.mjs';
const page = 'https://blog.naver.com/taejang-official/224446512548';
const image = 'https://blogthumb.pstatic.net/test/photo.jpg?type=w2';
const bytes = Buffer.alloc(40); bytes.set([255,216,255]);
async function request(t, {url=page, imageUrl=image, data=bytes, status=200, quota=true, include=true, mime='image/jpeg'}={}) {
  t.mock.method(dns, 'lookup', async () => [{address:'8.8.8.8',family:4}]);
  let images=0;
  process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';
  t.mock.method(globalThis,'fetch',async (url, options) => {
    if (String(url).includes('/rpc/')) return Response.json({allowed:quota,retry_after_seconds:60});
    if (String(url).includes('m.blog.naver.com')) return new Response(`<meta property="og:title" content="공식 글"><meta property="og:image" content="${imageUrl}">`,{headers:{'content-type':'text/html'}});
    images++; assert.equal(options.redirect,'error'); assert.equal(options.headers.Authorization,undefined);
    return new Response(data,{status,headers:{'content-type':mime}});
  });
  const response=await handler(new Request('https://local.test/.netlify/functions/external-content-meta',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({url,include_official_image:include})}));
  return {response,payload:await response.json(),images};
}
test('official page image bytes returned only after auth/quota with bounded existing downloader',async t=>{const r=await request(t);assert.equal(r.response.status,200);assert.equal(r.payload.imported_image.type,'image/jpeg');assert.deepEqual(Buffer.from(r.payload.imported_image.base64,'base64'),bytes);assert.equal(r.images,1);});
test('other blog and credential URLs rejected',async t=>{for(const url of ['https://blog.naver.com/other/123','https://evil@blog.naver.com/taejang-official/123','https://blog.naver.com/taejang-official/123/extra']) {const r=await request(t,{url});assert.equal(r.response.status,400);assert.equal(r.images,0);}});
test('quota denial prevents page/image download',async t=>{const r=await request(t,{quota:false});assert.equal(r.response.status,429);assert.equal(r.images,0);});
test('arbitrary OG origin is never downloaded',async t=>{const r=await request(t,{imageUrl:'https://127.0.0.1/photo.jpg'});assert.equal(r.images,0);assert.equal(r.payload.imported_image,null);});
test('redirect, HTML masquerade and oversize fail without losing metadata',async t=>{for(const options of [{status:302},{data:Buffer.from('<html>not a photo</html>')},{data:Buffer.alloc(1500001)},{mime:'text/html'}]) {const r=await request(t,options);assert.equal(r.payload.imported_image,null);assert.equal(r.payload.title,'공식 글');assert.equal(r.payload.image_error,'IMAGE_UNAVAILABLE');}});
test('ordinary metadata keeps existing external-site behavior without downloading image',async t=>{const r=await request(t,{include:false});assert.equal(r.payload.image,image);assert.equal(r.images,0);assert.equal(r.payload.imported_image,undefined);});
