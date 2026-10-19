import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(), baseline=process.env.ADMIN_UI_BASELINE_REF;
const preview=(process.env.PREVIEW_URL||'').replace(/\/$/,'');
if(preview)assert.equal(new URL(preview).protocol,'https:');
const output=process.env.ADMIN_UI_QA_OUTPUT||path.join(os.tmpdir(),'taejang-admin-ui');
await fs.mkdir(output,{recursive:true});
const load=async file=>baseline&&/^(app|staff)\//.test(file)
  ?execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})
  :fs.readFile(path.join(root,file),'utf8');
const assetLinks=html=>html.replaceAll('../../app/assets/',(preview||'')+'/app/assets/')
 .replaceAll('../../staff/assets/',(preview||'')+'/staff/assets/');
const employee=await fs.readFile('tests/browser/employee-profile-gate.html','utf8');
const shell=employee.split('<script>')[0].replace(/<link[^>]+employee-management.css[^>]+>/,'');
const home=shell+`<script>
let reviewRole='operations_manager',reviewFail=false;const reviewCalls=[];
window.alert=()=>{};window.confirm=()=>true;
window.TaejangApp={getRoute:()=>reviewRole,hasCapabilityContract:()=>true,
can:key=>reviewRole==='operations_manager'&&key==='homepage.direct_edit',friendlyError:e=>e.message,
rpc:async(name,args)=>{reviewCalls.push({name,args});if(name==='get_homepage_live_overrides_admin')return [];
if(name==='save_homepage_live_override'){if(reviewFail)throw Error('합성 저장 실패');return {ok:true};}
throw Error('Unexpected mock RPC '+name);}};
</script><script src="../../app/assets/operations-homepage-direct.js"></script></body></html>`;
const server=http.createServer(async(req,res)=>{
 try{
 let html;
 if(req.url.startsWith('/approval'))html=await fs.readFile('tests/browser/compact-admin-form-gate.html','utf8');
 else if(req.url.startsWith('/homepage'))html=home;
 if(html){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(assetLinks(html));return;}
 const file=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'');
 const absolute=path.resolve(root,file);
 assert.ok(absolute.startsWith(root+path.sep));
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');
 res.end(await load(file));
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
try{
 for(const width of [320,390,768,1440]){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
 const fits=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow at '+width);
 const capture=async name=>{await fits();await page.screenshot({path:path.join(output,name+'-'+width+'.png'),fullPage:true});};
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/approval?capture');
 await page.getByRole('button',{name:'기존 직원 연결 후 가입 승인',exact:true}).waitFor({timeout:5000}).catch(async e=>{console.error(await page.locator('body').innerText());throw e;});
 await capture('approval-existing');
 await page.getByRole('button',{name:'가입 거절',exact:true}).scrollIntoViewIfNeeded();
 await capture('approval-actions');
 await page.getByText('승인 방식',{exact:true}).locator('..').locator('select').selectOption('new');
 const check=page.getByRole('checkbox',{name:'근태 기록 대상',exact:true});
 await check.focus();await page.keyboard.press('Space');assert.equal(await check.isChecked(),false);
 await page.keyboard.press('Space');assert.equal(await check.isChecked(),true);
 assert.ok((await check.boundingBox()).height<=24);
 await capture('approval-new');
 await page.goto(base+'/homepage');
 await page.evaluate(()=>TaejangOperationsHomepageDirect.openEditor('text'));
 const text=page.getByLabel('새 글',{exact:true});await text.waitFor();
 await text.fill('가상 검수용 홈페이지 문장입니다.');
 await capture('homepage-text');
 await page.evaluate(()=>reviewFail=true);
 await page.getByRole('button',{name:'홈페이지에 바로 반영',exact:true}).click();
 assert.equal(await text.inputValue(),'가상 검수용 홈페이지 문장입니다.','failure preserves text');
 assert.ok(await page.getByRole('button',{name:'홈페이지에 바로 반영',exact:true}).isEnabled());
 await page.evaluate(()=>TaejangOperationsHomepageDirect.openEditor('link'));
 await page.getByLabel('버튼 글자',{exact:true}).fill('가상 안내');
 await page.getByText('이동 주소',{exact:true}).locator('..').locator('input').fill('/about.html');
 await capture('homepage-link');
 await page.evaluate(()=>{reviewRole='promotion_lead';document.getElementById('dashboard-main').textContent='권한 경계';TaejangOperationsHomepageDirect.open();});
 assert.equal(await page.locator('#dashboard-main').innerText(),'권한 경계','lead cannot open direct edit');
 assert.deepEqual(errors,[]);
 console.log('ADMIN_REVIEW_BROWSER_PASS:'+width+':'+(baseline?'BASELINE':preview?'PREVIEW':'LOCAL'));
 await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
