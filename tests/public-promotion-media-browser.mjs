// Synthetic public data only; no Hosted DB reads/writes or foreign photo downloads.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {promotionMedia} from '../assets/js/public-promotion-media.mjs';
const root=path.resolve('.'),output='/tmp/public-promotion-media-qa';await fs.mkdir(output,{recursive:true});
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/content-hub-polish.css"><link rel="stylesheet" href="/assets/css/site-polish.css"><main><section class="section"><div class="container" data-promotion-detail></div></section><section class="section"><div class="container"><div class="article-list" data-hub-list id="hub-fixture"></div></div></section></main><script src="/assets/js/promotion-detail.js"></script><script>window.TAEJANG_CONTENT={hub:[],activities:[]}</script><script src="/assets/js/content-hub.js"></script></html>';
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://fixture.test').pathname);if(file!==root&&!file.startsWith(root+path.sep))throw Error('path');const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':/\.(m?js)$/.test(file)?'text/javascript':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync),args:['--no-sandbox']});
const id='11111111-1111-4111-8111-111111111111',naver='https://blogthumb.pstatic.net/synthetic/blocked.jpg',good='https://owned.example.test/approved.jpg',broken='https://owned.example.test/unavailable.jpg';
const common={content_id:id,title:'합성 공개 소식',summary:'사진 상태 검수',public_body:'사진과 별개로 남아야 하는 본문',content_type:'homepage_article',published_date:'2026-10-26',link_source_type:'none',public_media:[]};
const cases=[['naver',{...common,hero_image_url:naver}],['normal',{...common,public_media:[{url:good,alt:'승인된 합성 사진'}]}],['failed-upload',{...common,public_media:[{url:broken,alt:'합성 실패 사진'}]}],['ssr-failed-upload',{...common,public_media:[{url:broken,alt:'합성 서버 사진'}]}],['external-reference',{...common,link_source_type:'external',hero_image_url:'https://other.example.test/reference.jpg',external_url:'https://other.example.test/source'}]];
try{for(const width of [1440,390])for(const [name,item] of cases){
 const page=await browser.newPage({viewport:{width,height:900}});const foreign=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(base+'/fixture'))return route.fulfill({contentType:'text/html',body:name==='ssr-failed-upload'?html.replace('data-promotion-detail></div>',`data-promotion-detail><article data-seo-promotion-id="${id}"><h1>${common.title}</h1><figure class="article-representative-media"><img src="${broken}" alt="합성 서버 사진"></figure><p>${common.public_body}</p></article></div>`):html});if(url.includes('/.netlify/functions/public-promotion-feed'))return route.fulfill({json:{item}});if(url===good)return route.fulfill({contentType:'image/png',body:await fs.readFile('images/favicon.png')});if(url===broken)return route.fulfill({status:500,body:'synthetic unavailable photo'});if(url.startsWith(base))return route.continue();foreign.push(url);return route.abort();});
 await page.goto(base+'/fixture?id='+id);await page.getByRole('heading',{name:common.title,exact:true}).waitFor();
 await page.waitForFunction(()=>!!window.TAEJANG_CONTENT_HUB);
 const display=promotionMedia(item);await page.evaluate(({item,display})=>{const card=document.createElement('article');card.className='card card--hub';card.append(window.TAEJANG_CONTENT_HUB.createMedia({id:'promotion-'+item.content_id,type:'internal',source:'homepage',title:item.title,thumbnail:display.heroUrl,thumbnailUnavailable:display.unavailable}));document.getElementById('hub-fixture').append(card);},{item,display});
 assert.equal(await page.getByText(common.public_body,{exact:true}).count(),1);
 if(name==='normal'){await page.waitForFunction(()=>[...document.images].length===2&&[...document.images].every(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('img[src="'+good+'"]').count(),2);assert.equal(await page.locator('.promotion-image-unavailable').count(),0);}
 if(name==='naver'||name==='failed-upload'||name==='ssr-failed-upload'){await page.locator('.promotion-image-unavailable').waitFor();assert.equal(await page.locator('[data-promotion-detail] img').count(),0);await page.getByText('대표사진을 표시할 수 없습니다',{exact:true}).waitFor();}
 if(name==='external-reference'){assert.equal(await page.locator('[data-promotion-detail] figure').count(),0);assert.equal(await page.getByRole('link',{name:'원문 보기 ↗',exact:true}).getAttribute('href'),item.external_url);}
 assert.deepEqual(foreign,[],'Naver/other reference images must never be requested');assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile/PC overflow');
 await page.screenshot({path:path.join(output,name+'-'+width+'.png'),fullPage:true});console.log(JSON.stringify({width,case:name,passed:true}));await page.close();
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
