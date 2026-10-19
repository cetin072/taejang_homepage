import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root=process.cwd(),baseline=process.env.NOTICE_BASELINE_REF;
const preview=(process.env.PREVIEW_URL||'').replace(/\/$/,'');
const output=process.env.NOTICE_HISTORY_QA_OUTPUT||path.join(os.tmpdir(),'taejang-notice-history');
await fs.mkdir(output,{recursive:true});
const server=http.createServer(async(req,res)=>{
 try {
  const file=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,''),absolute=path.resolve(root,file);
  assert.ok(absolute.startsWith(root+path.sep));
  let body=baseline&&/^(app|staff)\//.test(file)
   ?execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})
   :await fs.readFile(absolute,'utf8');
  if(file.endsWith('.html')&&preview)body=body.replaceAll('src="../../app/assets/',`src="${preview}/app/assets/`)
   .replaceAll('href="../../app/assets/',`href="${preview}/app/assets/`).replaceAll('href="../../staff/assets/',`href="${preview}/staff/assets/`);
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'application/javascript');res.end(body);
 } catch { res.statusCode=404;res.end('Missing test asset'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base+'/tests/browser/notice-authoring-ux-gate.html?capture');
  await page.waitForFunction(()=>document.getElementById('result').textContent==='NOTICE_CAPTURE_READY');
  await page.addScriptTag({url:(preview||base)+'/app/assets/operations-delete-controls.js'});
  await page.evaluate(()=>{
   const iso=offset=>new Date(Date.now()+offset).toISOString(),hour=3600000;
   const make=(id,title,extra={})=>({id,title,body_easy:'합성 공지 본문\n둘째 문단',notice_kind:'general',importance:'normal',
    status:'published',target_scope:'company',target_department_id:null,target_work_group_id:null,target_profile_id:null,
    publish_start_at:iso(-hour),publish_end_at:iso(hour*24),published_at:iso(-hour),created_at:iso(-hour*24),updated_at:iso(-hour),
    requires_acknowledgement:false,media:[],version_no:1,created_route:'operations_manager',creator_display_name:'합성 운영총괄',...extra});
   rows.splice(0,rows.length,
    make('pub-b','같은 시각 B'),make('pub-a','같은 시각 A'),
    make('scheduled','다음 주 교육 안내',{publish_start_at:iso(hour*24),publish_end_at:iso(hour*48)}),
    make('review','안전 안내 검토 대기',{status:'draft',review_state:'submitted'}),
    make('draft','행사 안내 비공개 초안',{status:'draft'}),
    make('expired','지난달 공지 이력',{publish_start_at:iso(-hour*48),publish_end_at:iso(-hour)}),
    make('inactive','사용 중지 공지',{status:'inactive'}),
    make('archived','보관된 교육 안내',{status:'inactive',archived_at:iso(-hour),archive_reason:'합성 보관 검증',archive_previous_status:'published'}));
   rows[1].published_at=rows[0].published_at;
   window.historyFixture={make,failRead:false,loseSave:false,staleRead:false};
   const original=TaejangApp.rpc;
   TaejangApp.rpc=async(name,args={})=>{
    if(name==='get_manageable_notice'){
     calls.push({name,args});if(historyFixture.failRead)throw Error('synthetic read failure');
     const row=rows.find(item=>item.id===args.p_notice_id);if(!row)throw Error('NOTICE_READ_FORBIDDEN');
     const item=structuredClone(row),editable=!row.archived_at&&(role==='operations_manager'||row.created_route===role&&row.review_state!=='submitted');
     return {...item,...(historyFixture.staleRead?{body_easy:'stale body'}:{}),can_edit:editable,can_lead_edit:editable,can_archive:role==='operations_manager'&&!row.archived_at,can_restore:role==='operations_manager'&&!!row.archived_at};
    }
    if(name==='list_manageable_notices_page'){
     calls.push({name,args});
     const state=row=>row.archived_at?'archived':['inactive','cancelled'].includes(row.status)?row.status:row.review_state==='submitted'?'review':row.status==='draft'?'draft':Date.parse(row.publish_end_at)<=Date.now()?'expired':Date.parse(row.publish_start_at)>Date.now()?'scheduled':'active';
     const rank=row=>args.p_archive?0:state(row)==='active'?0:state(row)==='expired'?2:1;
     const timestamp=row=>Date.parse(args.p_archive?row.archived_at||row.updated_at:state(row)==='expired'?row.publish_end_at:row.published_at||row.publish_start_at||row.created_at);
     const found=rows.filter(row=>(!!row.archived_at||['inactive','cancelled'].includes(row.status))===args.p_archive
      &&(!args.p_search||row.title.includes(args.p_search))&&(!args.p_status||state(row)===args.p_status)
      &&(!args.p_from||Date.parse(row.archived_at||row.published_at||row.publish_start_at)>=Date.parse(args.p_from))
      &&(!args.p_until||Date.parse(row.archived_at||row.published_at||row.publish_start_at)<Date.parse(args.p_until)))
      .sort((a,b)=>rank(a)-rank(b)||timestamp(b)-timestamp(a)||a.id.localeCompare(b.id,'en'));
     return {items:await Promise.all(found.slice(args.p_offset,args.p_offset+args.p_limit).map(row=>TaejangApp.rpc('get_manageable_notice',{p_notice_id:row.id}))),total:found.length,has_more:args.p_offset+args.p_limit<found.length};
    }
    if(name==='get_target_audit_trail')return [];
    if(name==='archive_notice'){
     calls.push({name,args});Object.assign(rows.find(row=>row.id===args.p_notice_id),{archived_at:new Date().toISOString(),status:'inactive',archive_previous_status:'published'});return {ok:true};
    }
    if(name==='restore_notice'){
     calls.push({name,args});Object.assign(rows.find(row=>row.id===args.p_notice_id),{archived_at:null,status:'published'});return {ok:true};
    }
    const result=await original(name,args);
    if(name==='save_notice'&&historyFixture.loseSave){historyFixture.loseSave=false;throw Error('committed response lost');}
    return result;
   };
   TaejangNoticeAdmin.setView('manage');
  });
  const capture=async name=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),name+' fits viewport');
   await page.screenshot({path:path.join(output,`${baseline?'before':'after'}-${name}-${width}.png`),fullPage:true});
  };
  await page.locator('[data-notice-id="pub-a"]').waitFor();
  await capture('manage');
  if(baseline){await context.close();continue;}
  assert.deepEqual((await page.locator('#notice-admin-list article').evaluateAll(nodes=>nodes.map(node=>node.dataset.noticeId))).slice(0,2),['pub-a','pub-b']);
  assert.equal(await page.locator('#notice-admin-list article').last().getAttribute('data-notice-id'),'expired');
  assert.equal(await page.locator('[data-ops-archive-notice]').count(),0,'no second archive owner');
  await page.locator('[data-notice-id="pub-a"]').getByRole('button',{name:'공지 수정',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('notice-id').value==='pub-a');
  await page.locator('#notice-body').fill('운영총괄 공개 공지 본문 정정');
  await page.locator('#notice-link-url').fill('https://example.com/notice');await page.locator('#notice-link-label').fill('자료 보기');
  await page.locator('#notice-save-existing').click();
  await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.startsWith('저장 완료'));
  assert.equal(await page.locator('#notice-id').inputValue(),'pub-a');
  assert.deepEqual(await page.evaluate(()=>[rows.filter(r=>r.id==='pub-a').length,rows.find(r=>r.id==='pub-a').status,rows.find(r=>r.id==='pub-a').body_easy]),[1,'published','운영총괄 공개 공지 본문 정정']);
  await capture('published-edit');
  // A stale read must not be reported as a confirmed save.
  await page.locator('#notice-body').fill('서버 재조회 대조');await page.evaluate(()=>{historyFixture.staleRead=true});
  await page.locator('#notice-save-existing').click();
  await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.startsWith('저장 결과 확인이 필요'));
  assert.equal(await page.locator('#notice-body').inputValue(),'서버 재조회 대조');await page.evaluate(()=>{historyFixture.staleRead=false});
  // Lost committed edit response reconciles by exact ID, no duplicate body write.
  await page.locator('#notice-body').fill('응답 유실 정정');await page.evaluate(()=>{historyFixture.loseSave=true});
  await page.locator('#notice-save-existing').click();
  await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.startsWith('저장 결과 확인이 필요'));
  const writes=await page.evaluate(()=>calls.filter(call=>call.name==='save_notice').length);
  await page.locator('#notice-save-existing').click();
  await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.startsWith('저장 완료'));
  assert.equal(await page.evaluate(()=>calls.filter(call=>call.name==='save_notice').length),writes,'reconcile must not resend saved body');
  await page.locator('#archive-notice-admin').click();await page.locator('[data-notice-id="archived"]').waitFor();
  assert.equal(await page.locator('[data-notice-id="expired"]').count(),0,'expiration is not archive');
  await capture('archive');
  await page.locator('[data-notice-id="archived"] h3 a').click();
  await page.waitForFunction(()=>document.getElementById('notice-id').value==='archived');
  assert.equal(await page.locator('#notice-save-existing').isVisible(),false);
  assert.equal(await page.locator('#notice-body').isDisabled(),true);
  await page.locator('#back-notice-admin').click();await page.locator('[data-notice-id="expired"]').waitFor();
  await page.evaluate(()=>{role='promotion_lead';TaejangNoticeAdmin.setView('manage')});
  await page.locator('[data-notice-id="pub-a"]').getByRole('button',{name:'공지 보기 (검토·게시 이력)',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('notice-id').value==='pub-a');
  assert.equal(await page.locator('#notice-save-existing').isVisible(),false);
  await capture('lead-readonly');
  await page.evaluate(()=>{role='operations_manager';rows.splice(0,rows.length,...Array.from({length:205},(_,i)=>historyFixture.make('page-'+String(i).padStart(3,'0'),'과거 공지 '+String(i).padStart(3,'0'),{status:'draft'})));TaejangNoticeAdmin.setView('manage')});
  await page.waitForFunction(()=>document.getElementById('notice-list-summary').textContent.includes('50 / 205'));
  for(const count of [100,150,200,205]){
   await page.locator('#notice-list-more').click();await page.waitForFunction(count=>document.querySelectorAll('#notice-admin-list article').length===count,count);
  }
  assert.equal(await page.locator('#notice-list-more').isVisible(),false);
  await page.locator('#notice-list-search').fill('과거 공지 204');await page.locator('#notice-list-filters').getByRole('button',{name:'검색',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#notice-admin-list article').length===1);
  assert.equal(await page.locator('#notice-admin-list article').getAttribute('data-notice-id'),'page-204');
  await page.locator('#new-notice-admin').click();await page.locator('#notice-title-input').fill('최초 응답 유실 합성 공지');
  await page.locator('#notice-body').fill('입력과 사진을 보존하고 중복 생성하지 않습니다.');
  await page.evaluate(()=>{historyFixture.loseSave=true});
  await page.locator('#notice-save-draft').click();
  await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.startsWith('새 공지 저장 응답을 확인하지 못했습니다'));
  const createWrites=await page.evaluate(()=>calls.filter(call=>call.name==='save_notice').length);
  await page.locator('#notice-save-draft').click();
  assert.equal(await page.evaluate(()=>calls.filter(call=>call.name==='save_notice').length),createWrites,'unknown initial ID must never cause duplicate create');
  assert.equal(await page.locator('#notice-title-input').inputValue(),'최초 응답 유실 합성 공지');
  assert.deepEqual(errors,[]);
  console.log(`NOTICE_HISTORY_BROWSER_PASS:${width}${preview?':PREVIEW':':LOCAL'}`);
  await context.close();
 }
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
