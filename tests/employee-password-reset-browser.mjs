import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const preview = String(process.env.EMPLOYEE_PREVIEW_URL || '').replace(/\/$/, '');
let html = await fs.readFile('tests/browser/employee-profile-gate.html', 'utf8');
html = html.replaceAll('../../app/assets/', (preview || '') + '/app/assets/').replaceAll('../../staff/assets/', (preview || '') + '/staff/assets/');
const setup = `<script>
const originalRpc=TaejangApp.rpc;
TaejangApp.rpc=async(name,args)=>name==='employee_password_reset_option'?
 {ok:true,profile_id:'synthetic-profile',employee_number:'TJ-000003',email:'synthetic@example.test',manual_allowed:true}:originalRpc(name,args);
window.confirm=()=>true;
window.resetCalls=0;window.resetFailure=true;window.productionConfig=false;
const previousFetch=window.fetch;
window.fetch=async(url,options)=>{
 if(url==='/.netlify/functions/staff-config')return new Response(JSON.stringify({url:productionConfig?'https://jgsxpdflgkqroecfjzxq.supabase.co':'http://127.0.0.1:54321',publishableKey:'synthetic-only'}));
 if(String(url).includes('/functions/v1/employee-password-reset')){
   resetCalls++;
   return new Response(JSON.stringify(resetFailure?{ok:false,code:'REAUTH_FAILED'}:{ok:true,temporary_password:'8135792468135792'}),{status:resetFailure?403:200});
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
  const reason=page.getByLabel('초기화 사유 (5자 이상)',{exact:true});
  await page.getByLabel('직원번호 다시 입력').fill('TJ-000003');
  await page.getByLabel('직원 신원 직접 확인 완료').check();
  await reason.fill('현장 신원 확인 후 복구');
  await page.getByLabel('관리자 본인 현재 비밀번호').fill('synthetic-only');
  await page.getByRole('button',{name:'대상 확인 후 초기화'}).click();
  await page.getByText('관리자 본인 비밀번호를 다시 확인하세요.',{exact:true}).waitFor();
  assert.equal(await reason.inputValue(),'현장 신원 확인 후 복구');
  assert.equal(await page.getByLabel('관리자 본인 현재 비밀번호').inputValue(),'');
  assert.equal(await page.getByLabel('직원번호 다시 입력').inputValue(),'TJ-000003');
  await page.getByLabel('발급 방식').selectOption('manual');
  await page.getByLabel('확정된 임시 비밀번호').fill('8135792468135792');
  await page.getByLabel('관리자 본인 현재 비밀번호').fill('synthetic-only');
  await page.evaluate(()=>{window.resetFailure=false;});
  await page.getByRole('button',{name:'대상 확인 후 초기화'}).click();
  const secret=page.getByLabel('일회 표시 임시 비밀번호');await secret.waitFor();
  assert.equal(await secret.textContent(),'8135792468135792');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'responsive form');
  assert.equal(await page.evaluate(()=>Object.values(localStorage).join('').includes('8135792468135792')||Object.values(sessionStorage).join('').includes('8135792468135792')),false);
  await page.getByRole('button',{name:'전달 완료 · 비밀번호 지우기'}).click();
  assert.equal(await page.getByLabel('일회 표시 임시 비밀번호').count(),0);
  await load(true);
  await page.getByLabel('직원번호 다시 입력').fill('TJ-000003');await page.getByLabel('직원 신원 직접 확인 완료').check();
  await reason.fill('현장 신원 확인 후 복구');await page.getByLabel('관리자 본인 현재 비밀번호').fill('synthetic-only');
  await page.getByRole('button',{name:'대상 확인 후 초기화'}).click();
  await page.getByText('Preview에서는 운영 계정을 초기화할 수 없습니다.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>resetCalls),0,'production reset never sent from preview');
  await page.close();
  console.log('PASSWORD_RESET_BROWSER_PASS width='+width+' '+(preview?'PREVIEW':'LOCAL'));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
