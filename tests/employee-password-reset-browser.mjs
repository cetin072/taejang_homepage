import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const output = process.env.EMPLOYEE_RESET_QA_OUTPUT || path.join(tmpdir(),'taejang-password-reset-qa');
await fs.mkdir(output,{recursive:true});
const preview = String(process.env.EMPLOYEE_PREVIEW_URL || '').replace(/\/$/, '');
let html = await fs.readFile('tests/browser/employee-profile-gate.html', 'utf8');
html = html.replaceAll('../../app/assets/', (preview || '') + '/app/assets/').replaceAll('../../staff/assets/', (preview || '') + '/staff/assets/');
const setup = `<script>
const originalRpc=TaejangApp.rpc;
TaejangApp.rpc=async(name,args)=>name==='employee_password_reset_option'?
 {ok:true,profile_id:'synthetic-profile',employee_number:'TJ-000003',email:'synthetic@example.test',manual_allowed:true}:originalRpc(name,args);

window.reauthCalls=0;window.reauthFailure=true;
TaejangApp.reauthenticate=async password=>{reauthCalls++;if(reauthFailure)throw Error('합성 본인 확인 실패');if(password!=='synthetic-local-password')throw Error('fixture password mismatch');};
window.resetCalls=0;window.resetFailure=true;window.expiredOnce=false;window.uncertain=false;window.productionConfig=false;
const previousFetch=window.fetch;
window.fetch=async(url,options)=>{
 if(url==='/.netlify/functions/staff-config')return new Response(JSON.stringify({url:productionConfig?'https://jgsxpdflgkqroecfjzxq.supabase.co':'http://127.0.0.1:54321',publishableKey:'synthetic-only'}));
 if(String(url).includes('/functions/v1/employee-password-reset')){
   resetCalls++;
   window.lastResetBody=JSON.parse(options.body);
   if(window.expiredOnce){window.expiredOnce=false;return new Response(JSON.stringify({ok:false,code:'LOGIN_REQUIRED'}),{status:401});}
   if(window.uncertain)throw Error('synthetic dropped response');
   return new Response(JSON.stringify(resetFailure?{ok:false,code:'REAUTH_REQUIRED'}:{ok:true,temporary_password:'8135792468135792'}),{status:resetFailure?403:200});
 }
 return previousFetch(url,options);
};
</script>`;
html = html.replace('</body>', setup + '</body>');
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  const file=path.resolve(root,'.'+req.url);
  if(!file.startsWith(root+path.sep))throw Error('path');
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
const errors=[];
try{
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:960}});
  page.on('pageerror',e=>errors.push(e.message));
  const load=async(production=false)=>{
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.evaluate(production=>{window.productionConfig=production;return TaejangEmployeeManagement.openEmployeeManagement();},production);
   await page.locator('[data-employee-id="fixture-2"]').click();
   await page.getByRole('button',{name:'비밀번호 초기화',exact:true}).click();
  };
  await load();
  const dialog=page.getByRole('dialog',{name:'비밀번호 초기화 확인'});
  await dialog.waitFor();
  const bounds=await dialog.boundingBox();
  assert.ok(Math.abs(bounds.y+bounds.height/2-480)<2,'confirmation centered in viewport');
  assert.equal(await dialog.locator('input,select,textarea').count(),0,'confirmation has no input');
  assert.match(await dialog.textContent(),/직원 본인의 요청을 확인했다면/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'responsive confirmation');
  await page.screenshot({path:path.join(output,'reset-confirm-'+width+(preview?'-preview':'-local')+'.png'),fullPage:true});
  await dialog.getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await page.evaluate(()=>resetCalls),0,'cancel has no mutation');
  const open=page.getByRole('button',{name:'비밀번호 초기화',exact:true});
  await open.click();await dialog.getByRole('button',{name:'초기화',exact:true}).click();
  await page.getByText('본인 확인 시간이 지났습니다. 이 화면에서 내 로그인 비밀번호를 확인하면 계속할 수 있습니다.',{exact:true}).waitFor();
  assert.equal(await open.isEnabled(),false);
  await page.getByLabel('내 로그인 비밀번호',{exact:true}).fill('synthetic-wrong-password');
  await page.getByRole('button',{name:'본인 확인 후 계속',exact:true}).click();
  await page.getByText('합성 본인 확인 실패',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('내 로그인 비밀번호',{exact:true}).inputValue(),'');
  assert.equal(await page.evaluate(()=>resetCalls),1,'incorrect credential never retries reset');
  await page.screenshot({path:path.join(output,'reset-inline-confirmation-'+width+(preview?'-preview':'-local')+'.png'),fullPage:true});
  await page.evaluate(()=>window.reauthFailure=false);
  await page.getByLabel('내 로그인 비밀번호',{exact:true}).fill('synthetic-local-password');
  await page.getByRole('button',{name:'본인 확인 후 계속',exact:true}).click();
  await dialog.waitFor();
  assert.equal(await page.getByLabel('내 로그인 비밀번호',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>reauthCalls),2);
  assert.equal(await page.evaluate(()=>Object.values(localStorage).join('').includes('synthetic-local-password')||Object.values(sessionStorage).join('').includes('synthetic-local-password')),false);
  assert.equal(await page.evaluate(()=>resetCalls),1,'fresh confirmation still required before reset');
  await page.clock.install();
  await page.evaluate(()=>{
   window.resetFailure=false;window.copied='';
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copied=value;}},configurable:true});
  });
  await dialog.getByRole('button',{name:'초기화',exact:true}).click();
  const secret=page.getByLabel('일회 표시 임시 비밀번호');await secret.waitFor();
  assert.equal(await secret.textContent(),'8135792468135792');
  assert.equal(await open.isDisabled(),true,'duplicate button disabled');
  assert.deepEqual(await page.evaluate(()=>Object.keys(lastResetBody).sort()),['employee_uuid','request_confirmed']);
  await page.getByRole('button',{name:'비밀번호 복사',exact:true}).click();
  assert.equal(await page.evaluate(()=>copied==='8135792468135792'),true,'copy without logging secret');
  assert.equal(await page.evaluate(()=>Object.values(localStorage).join('').includes('8135792468135792')||Object.values(sessionStorage).join('').includes('8135792468135792')),false);
  await page.clock.fastForward(59000);assert.equal(await secret.textContent(),'8135792468135792');
  await page.clock.fastForward(1000);assert.equal(await page.getByLabel('일회 표시 임시 비밀번호').count(),0,'60 second expiry clears output');
  await page.screenshot({path:path.join(output,'reset-cleared-'+width+(preview?'-preview':'-local')+'.png'),fullPage:true});
  await load();
  await page.evaluate(()=>{window.resetFailure=false;window.uncertain=true;});
  await dialog.getByRole('button',{name:'초기화',exact:true}).click();
  await page.getByText('처리 결과를 확인하지 못했습니다. 다시 실행하지 말고 운영총괄에게 문의하세요.',{exact:true}).waitFor();
  assert.equal(await open.isDisabled(),true,'uncertain response cannot be retried');
  assert.equal(await page.evaluate(()=>resetCalls),1);
  await load();
  await page.evaluate(()=>{window.expiredOnce=true;window.resetFailure=false;});
  await dialog.getByRole('button',{name:'초기화',exact:true}).click();
  await page.getByLabel('일회 표시 임시 비밀번호').waitFor();
  assert.equal(await page.evaluate(()=>resetCalls),2,'explicit pre-mutation login failure retries once');
  assert.equal(await page.evaluate(()=>fixtureRefreshCount),1,'expired session renews inside employee screen');
  assert.equal(await page.getByLabel('내 로그인 비밀번호',{exact:true}).count(),0,'token renewal does not request password');
  await load();
  await page.evaluate(()=>{
   window.expiredOnce=true;window.resetFailure=false;
   let session={access_token:'synthetic-only',user:{id:'original-actor'}};
   TaejangApp.getSession=()=>session;
   TaejangApp.refreshSession=async()=>{fixtureRefreshCount++;session={access_token:'synthetic-other',user:{id:'other-actor'}};return true;};
  });
  await dialog.getByRole('button',{name:'초기화',exact:true}).click();
  await page.getByText('다시 로그인한 뒤 진행하세요.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>resetCalls),1,'account change during renewal never replays reset as another actor');
  assert.equal(await page.getByLabel('일회 표시 임시 비밀번호').count(),0);
  await load(true);
  await dialog.getByRole('button',{name:'초기화',exact:true}).click();
  await page.getByText('Preview에서는 운영 계정을 초기화할 수 없습니다.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>resetCalls),0,'production reset never sent from preview');
  await page.close();
  console.log('PASSWORD_RESET_BROWSER_PASS width='+width+' '+(preview?'PREVIEW':'LOCAL'));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
