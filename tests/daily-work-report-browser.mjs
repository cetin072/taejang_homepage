import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium,expect} from 'playwright/test';
import {createERPDatabase,OPS,WORKER} from './helpers/erp-sales-isolated-db.mjs';
import {workReportFilename} from '../app/assets/daily-work-log.mjs';

const zipLib=createRequire(import.meta.url)('../app/assets/vendor/jszip-3.10.1.min.js');
const lead='10000000-0000-4000-8000-000000000033';
const db=await createERPDatabase({amountAdjustments:false});
const literal=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
const schema='supabase/migrations/20261127032500_daily_work_reports.sql';
const names={search_daily_work_reports:['p_from','p_to','p_query','p_page'],save_daily_work_report:['p_date','p_morning','p_afternoon','p_work','p_staff','p_other','p_revision']};
function rpc(name,args,actor=OPS,role='authenticated'){
 if(!Object.hasOwn(names,name))throw Error('Unexpected RPC');
 const values=names[name].map(k=>literal(args[k])).join(',');
 return JSON.parse(db.sql('select public.'+name+'('+values+');',{actor,role}).split('\n').at(-1));
}
const lookup=(actor=OPS,query='',from=null,to=null)=>rpc('search_daily_work_reports',{p_from:from,p_to:to,p_query:query,p_page:0},actor);
const sample={p_date:'2026-11-25',p_morning:true,p_afternoon:false,p_work:'포장 & <기록>\n두 번째 작업',p_staff:'특이사항 예시',p_other:'공유 메모',p_revision:0};
let browser;
try {
 db.raw(readFileSync(schema,'utf8'));
 db.raw("insert into public.profiles values ('"+lead+"','Synthetic Lead','active');insert into public.profile_roles select '"+lead+"',id,null from public.roles where code='promotion_lead';");
 assert.throws(()=>lookup(WORKER),/DAILY_WORK_FORBIDDEN/);
 assert.throws(()=>rpc('save_daily_work_report',sample,WORKER),/DAILY_WORK_FORBIDDEN/);
 assert.throws(()=>rpc('search_daily_work_reports',{p_from:null,p_to:null,p_query:'',p_page:0},null,'anon'),/permission denied/);
 assert.throws(()=>db.sql('select * from daily_work_private.reports;',{actor:lead}),/permission denied/);
 const own=rpc('save_daily_work_report',sample,lead);
 assert.equal(own.can_edit,true);
 assert.throws(()=>rpc('save_daily_work_report',sample,lead),/DAILY_WORK_CONFLICT/);
 const ops=rpc('save_daily_work_report',{...sample,p_work:'총괄 업무'},OPS);
 assert.equal(lookup(lead).length,1);
 assert.equal(lookup(lead,'총괄').length,0);
 assert.equal(lookup(OPS).length,2);
 assert.equal(lookup(OPS,'특이사항 예시','2026-11-25','2026-11-25').length,2);
 assert.equal(lookup(OPS,'','2026-11-26').length,0);
 assert.equal(lookup(OPS,'포장')[0].can_edit,false);
 assert.equal(lookup(OPS,'%').length,0,'search is literal');
 assert.throws(()=>rpc('save_daily_work_report',{...sample,p_work:'',p_revision:1},lead),/DAILY_WORK_INVALID/);
 assert.throws(()=>rpc('save_daily_work_report',{...sample,p_work:'다른 기록',p_revision:9},lead),/DAILY_WORK_CONFLICT/);
 assert.equal(rpc('save_daily_work_report',{...sample,p_work:'기존 수정',p_revision:1},lead).id,own.id);
 assert.equal(lookup(OPS,'총괄')[0].id,ops.id,'same day does not edit someone else');
 db.raw("insert into public.role_simulation_modes(profile_id,role_code,expires_at) values('"+OPS+"','promotion_lead',now()+interval '1 hour');");
 assert.throws(()=>lookup(OPS),/DAILY_WORK_FORBIDDEN/);
 db.raw("delete from public.role_simulation_modes where profile_id='"+OPS+"';");
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{channel:'chrome'})});
 for(const width of [1440,390]){
  const p=await browser.newPage({viewport:{width,height:900},acceptDownloads:true}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  const date=width===1440?'2026-11-26':'2026-11-27';
  await p.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!=='https://fixture.test')return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main><script type="module">import {mountDailyWork} from "/app/assets/daily-work-log.mjs";window.role="promotion_lead";window.print=()=>{window.printed=true;};window.TaejangApp={getAccessContext:()=>({id:"'+lead+'",account_status:"active"}),getActualRoles:()=>[role],getEffectiveRoles:()=>[role],rpc:async(name,args)=>{const r=await fetch("/rpc",{method:"POST",body:JSON.stringify({name,args})}),v=await r.json();if(!r.ok)throw Error(v.message);return v;}};mountDailyWork(document.querySelector("main"));</script></html>'});
   if(u.pathname==='/rpc'){const {name,args}=route.request().postDataJSON();try{return route.fulfill({json:rpc(name,args,lead)});}catch(e){return route.fulfill({status:400,json:{message:String(e.stderr||e.message)}});}}
   if(!['/app/assets/daily-work-log.mjs','/app/assets/daily-work-log.css','/app/assets/erp-pdf.mjs','/app/assets/vendor/jszip-3.10.1.min.js'].includes(u.pathname))return route.abort();
   return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync('.'+u.pathname,'utf8')});
  });
  await p.goto('https://fixture.test/');
  await p.getByLabel('작성일',{exact:true}).fill(date);
  await p.getByRole('checkbox',{name:'오전',exact:true}).check();
  await p.getByRole('checkbox',{name:'오후',exact:true}).check();
  await p.getByLabel('① 오늘의 업무 내용').fill('검수용 업무 & <포장>\n둘째 줄');
  await p.getByLabel('② 근로자 특이사항').fill('검수 검색어 '+width);
  await p.getByRole('button',{name:'일지 저장',exact:true}).click();
  await expect(p.getByRole('status')).toContainText('일지를 저장했습니다.');
  await p.reload();
  await p.getByLabel('작성자 또는 내용').fill('검수 검색어 '+width);
  await p.getByLabel('시작일').fill(date);
  await p.getByLabel('종료일').fill(date);
  await p.getByRole('button',{name:'검색',exact:true}).click();
  await expect(p.locator('.dwl-result')).toHaveCount(1);
  await p.getByRole('button',{name:'열기 / 수정 '+date+' Synthetic Lead',exact:true}).click();
  await expect(p.getByLabel('① 오늘의 업무 내용')).toHaveValue('검수용 업무 & <포장>\n둘째 줄');
  const pending=p.waitForEvent('download');
  await p.getByRole('button',{name:'Word 다운로드',exact:true}).click();
  const download=await pending;
  assert.equal(download.suggestedFilename(),workReportFilename({work_date:date,author_name:'Synthetic Lead'})+'.docx');
  const file=await zipLib.loadAsync(readFileSync(await download.path()));
  const xml=await file.file('word/document.xml').async('string');
  assert.match(xml,/검수용 업무 &amp; &lt;포장&gt;/);assert.match(xml,/둘째 줄/);assert.match(xml,/오전 · 오후/);
  await p.getByRole('button',{name:'PDF 저장 / 인쇄',exact:true}).click();
  await expect(p.locator('#daily-work-print')).toHaveText(/검수용 업무 & <포장>/);
  const pdf=await p.pdf({preferCSSPageSize:true});
  assert.equal(pdf.toString('ascii',0,4),'%PDF');
  await p.evaluate(()=>dispatchEvent(new Event('afterprint')));
  await expect(p.locator('#daily-work-print')).toHaveCount(0);
  await p.evaluate(()=>{window.role='general_worker';document.dispatchEvent(new Event('taejang-capabilities-changed'));});
  await expect(p.getByLabel('① 오늘의 업무 내용')).toHaveCount(0);
  assert.deepEqual(errors,[]);
  await p.close();
 }
 console.log('PASS role boundaries, date search, revision, desktop/mobile creation, DOCX and PDF');
} finally {await browser?.close();db.stop();}
