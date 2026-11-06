// Browser-only fixtures; never calls Google or any hosted Supabase project.
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),args:['--no-sandbox']});
const key='taejang-staff-session-v1';
try {
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({key})=>{if(location.origin==='https://fixture.test'&&!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({access_token:'old-fixture',user:{id:'owner'}}));},{key});
  let redirect,enabled=true,apiCalls=0;const trace=[];
  page.on('requestfailed',r=>trace.push({failed:r.url(),error:r.failure()?.errorText}));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin==='https://fixture.supabase.co'){
    apiCalls++;trace.push({path:url.pathname,method:request.method(),authenticated:Boolean(request.headers().authorization)});
    const headers={'access-control-allow-origin':'https://fixture.test','access-control-allow-headers':'apikey,authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.pathname==='/auth/v1/user')return route.fulfill({headers,json:{id:'owner',identities:request.headers().authorization==='Bearer fresh-fixture'?[{provider:'google'}]:[]}});
    if(url.pathname.endsWith('/get_my_access_context'))return route.fulfill({headers,json:{id:'owner',account_status:'active'}});
    if(url.pathname.endsWith('/identities/authorize')){redirect=url.searchParams.get('redirect_to');assert.equal(url.searchParams.get('code_challenge_method'),'s256');return route.fulfill({headers,json:{url:'https://accounts.google.com/fixture'}});}
    if(url.pathname==='/auth/v1/token'){assert.equal(request.postDataJSON().auth_code,'fixture-code');return route.fulfill({headers,json:{access_token:'fresh-fixture',refresh_token:'fresh-refresh'}});}
    throw Error('Unexpected fixture request '+url.pathname);
   }
   if(url.origin==='https://accounts.google.com')return route.fulfill({contentType:'text/html',body:'<h1>Synthetic Google redirect</h1>'});
   if(url.pathname==='/.netlify/functions/staff-config')return route.fulfill({json:{url:'https://fixture.supabase.co',publishableKey:'public-fixture',googleIdentityEnabled:enabled}});
   if(url.pathname==='/app/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><h1>대시보드 복귀</h1>'});
   const path=url.pathname==='/staff/google-link'?'/staff/google-link.html':url.pathname;
   if(path.startsWith('/staff/'))return route.fulfill({contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(new URL('..'+path,import.meta.url),'utf8')});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test/staff/google-link.html');
  await page.getByRole('button',{name:'Google 계정 연결',exact:true}).waitFor();
  await page.getByText('본인의 Google 계정을 선택해 주세요.').waitFor();
  assert.equal(apiCalls,0,'linking starts only on explicit click');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Google 계정 연결',exact:true}).click();
  await page.waitForURL('https://accounts.google.com/fixture');
  assert.ok(redirect);
  await page.goto(redirect+'&code=fixture-code');
  try{await page.getByRole('heading',{name:'대시보드 복귀'}).waitFor({timeout:10000});}
  catch(error){throw Error(JSON.stringify({url:page.url(),body:await page.locator('body').innerText(),errors,trace,pending:await page.evaluate(()=>sessionStorage.getItem('taejang-google-link-v1'))}));}
  assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).access_token,key),'fresh-fixture');
  assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).user.id,key),'owner');
  enabled=false;const before=apiCalls;
  await page.goto('https://fixture.test/staff/google-link');
  await page.getByText(/Google 로그인 연결을 준비 중/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Google 계정 연결',exact:true}).isDisabled(),true);
  assert.equal(apiCalls,before);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,synthetic:true,sameActor:true,pkce:true,defaultOff:true}));
  await page.close();
 }
}finally{await browser.close();}
