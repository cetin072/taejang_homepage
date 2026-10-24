// Synthetic API boundary, real app HTML/transport/controllers in Chromium.
// Never sends requests to Supabase or creates real accounts/employee records.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=process.cwd(), preview=(process.env.PREVIEW_URL||'').replace(/\/$/,'');
const baseline=process.env.STABILITY_BASELINE_REF;
if(preview)assert.equal(new URL(preview).protocol,'https:');
const output=process.env.STABILITY_QA_OUTPUT||path.join(os.tmpdir(),'taejang-backend-stability');
await fs.mkdir(output,{recursive:true});
const cache=new Map();
async function load(file){
  if(!cache.has(file))cache.set(file,(async()=>{
    if(baseline&&/^(app|staff)\//.test(file))return execFileSync('git',['show',baseline+':'+file]);
    if(preview&&/^(app|staff)\//.test(file)){
      const res=await fetch(preview+'/'+file);assert.equal(res.status,200,'Preview asset '+file);
      return Buffer.from(await res.arrayBuffer());
    }
    return fs.readFile(path.join(root,file));
  })());
  return cache.get(file);
}
const server=http.createServer(async(req,res)=>{
  try{
    const file=new URL(req.url,'http://localhost').pathname.slice(1)||'app/index.html';
    assert.ok(path.resolve(root,file).startsWith(root+path.sep));
    let body=await load(file);
    if(file==='app/index.html'){
      // Exercise this controller and its real manager modules independently of
      // unrelated dashboard/promotion enhancements. The full shell has its own gate.
      body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>',[
        '../staff/assets/auth-routing.js','assets/today-board.js',
        'assets/staff-information-ui.js','assets/app.js'
      ].map(src=>`<script src="${src}"></script>`).join('')+'</body>');
    }
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8');
    res.end(body);
  }catch(error){res.statusCode=404;res.end(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
const options={company_allowed:true,departments:[{id:'d1',name:'합성 부서 1'},{id:'d2',name:'합성 부서 2'}],
  profiles:[{id:'p1',name:'합성 담당자'}],work_groups:[],work_guides:[{id:'g1',title:'합성 게시 자료',status:'published'}]};

async function boot(width,role='operations_manager'){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
  const calls=[],errors=[],records={tasks:[],information:[]},guides=[];
  const control={readFail:false,writeFail:false,detailFail:false,guideListFail:false,removedDepartment:false};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({role})=>{
    // Same early-pageshow guard as app-ui.js; this harness omits that loader.
    window.addEventListener('pageshow',event=>{if(!window.TaejangApp)event.stopImmediatePropagation();},true);
    localStorage.setItem('taejang-staff-session-v1',JSON.stringify({access_token:'synthetic',user:{id:'synthetic'}}));
    window.TaejangAppUi={element:id=>document.getElementById(id),text:(tag,value,cls)=>{
      const n=document.createElement(tag);n.textContent=value||'';if(cls)n.className=cls;return n;
    },message:(id,value,error=false)=>{
      const n=document.getElementById(id);n.textContent=value;n.hidden=!value;n.classList.toggle('error',error);
    },imageOrNotice:()=>document.createElement('span')};
    window.TaejangCapabilityAccess={refresh:async()=>{
      window.TaejangApp.hasCapabilityContract=()=>true;
      window.TaejangApp.can=code=>role==='operations_manager'&&['task.manage','guidance.manage'].includes(code);
    }};
  },{role});
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    assert.equal(url.origin,origin,'no hosted requests allowed');
    const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/.netlify/functions/staff-config')return send({url:origin,publishableKey:'synthetic'});
    if(url.pathname==='/staff/change-password.html')return route.fulfill({status:404,body:''});
    if(!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();
    const name=url.pathname.split('/').pop(),args=req.postDataJSON();calls.push({name,args});
    if(name==='get_my_access_context')return send({authenticated:true,account_status:'active',display_name:'합성 검수',roles:[{code:role,name:role}]});
    if(name==='get_today_board_admin_options')return send(control.removedDepartment?{...options,departments:options.departments.filter(d=>d.id!=='d2')}:options);
    if(name==='list_manageable_today_records')return control.readFail?send({message:'synthetic read failure'},503):send(records);
    if(name==='list_manageable_work_guides')return control.guideListFail?send({message:'synthetic list failure'},503):send(guides);
    if(name==='get_manageable_work_guide_detail')return control.detailFail?send({message:'synthetic detail failure'},503):send({guide:guides.find(g=>g.id===args.p_work_guide_id),steps:[]});
    if(['list_manageable_staff_guidance','list_manageable_schedules'].includes(name))return send([]);
    if(name==='save_daily_work_assignment'){
      if(control.writeFail)return send({ok:false,code:'FORBIDDEN'});
      const id=args.p_assignment_id||'saved-task';records.tasks=[{id,work_date:args.p_work_date,title:args.p_title,status:args.p_status,target_scope:args.p_target_scope,target_department_id:args.p_target_department_id}];
      return send({ok:true,id});
    }
    if(name==='save_work_guide'){
      if(control.writeFail)return send({ok:false,code:'FORBIDDEN'});
      const id=args.p_work_guide_id||'saved-guide',guide={id,title:args.p_title,department_id:args.p_department_id,
        category:args.p_category,guide_format:args.p_guide_format,audience_scope:args.p_audience_scope,status:args.p_status,step_count:0,published_step_count:0};
      guides.splice(0,guides.length,guide);return send({ok:true,id});
    }
    if(name==='save_work_guide_step')return send({ok:true,id:args.p_step_id||'saved-step'});
    errors.push('Unexpected RPC '+name);return send({message:'Unexpected RPC '+name},500);
  });
  await page.goto(origin+'/app/index.html');
  await page.waitForFunction(()=>window.TaejangApp?.hasCapabilityContract?.(),null,{timeout:10000}).catch(async error=>{
    console.error({url:page.url(),errors,calls});throw error;
  });
  if(role==='operations_manager'){
    await page.waitForFunction(()=>document.getElementById('task-scope').options.length>0&&document.getElementById('guide-manage-list'));
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('taejang-open-app-panel',{detail:{id:'today-admin-panel'}})));
    await page.evaluate(()=>document.querySelectorAll('#today-admin-panel details').forEach(n=>n.open=true));
  }
  return {context,page,calls,errors,control};
}
try{
  for(const width of [1440,768,390,320]){
    const {context,page,calls,errors,control}=await boot(width);
    const value=id=>page.locator('#'+id).inputValue();
    const submit=async id=>{await page.locator('#'+id+' button[type="submit"]').click();await page.waitForFunction(id=>!document.querySelector('#'+id+' button[type="submit"]').disabled,id);};
    await page.locator('#task-title-input').fill('합성 부서 한정 업무');
    await page.locator('#task-reason').fill('합성 대상 범위 검수');
    await page.locator('#task-location').fill('합성 작업장');
    await page.locator('#task-scope').selectOption('department');
    await page.locator('#task-target').selectOption('d2');
    await page.locator('#task-lead').selectOption('p1');
    await page.locator('#task-guide').selectOption('g1');
    await page.locator('#guide-department').selectOption('d2');
    await page.locator('#reset-information-form').click();
    await page.locator('#refresh-admin').click();
    await page.waitForFunction(()=>!document.getElementById('refresh-admin').disabled);
    assert.equal(await value('task-scope'),'department','refresh/reset another form must not broaden audience');
    assert.equal(await value('task-target'),'d2');assert.equal(await value('task-lead'),'p1');
    assert.equal(await value('task-guide'),'g1');assert.equal(await value('guide-department'),'d2');
    // An option removed during refresh must require a new explicit choice.
    control.removedDepartment=true;
    await page.locator('#refresh-admin').click();
    await page.waitForFunction(()=>!document.getElementById('refresh-admin').disabled);
    assert.equal(await value('task-scope'),'department');
    assert.equal(await value('task-target'),'');
    const writesBefore=calls.filter(c=>c.name==='save_daily_work_assignment').length;
    await submit('task-form');
    assert.equal(calls.filter(c=>c.name==='save_daily_work_assignment').length,writesBefore);
    control.removedDepartment=false;
    await page.locator('#refresh-admin').click();
    await page.waitForFunction(()=>!document.getElementById('refresh-admin').disabled);
    await page.locator('#task-target').selectOption('d2');
    await page.locator('#guide-department').selectOption('d2');
    // A rejected write retains all input and sends the chosen target, not company.
    control.writeFail=true;await submit('task-form');
    assert.equal(await value('task-title-input'),'합성 부서 한정 업무');
    assert.equal(calls.findLast(c=>c.name==='save_daily_work_assignment')?.args.p_target_department_id,'d2',
      'write uses the selected department; invalid fields: '+await page.locator('#task-form :invalid').evaluateAll(nodes=>nodes.map(n=>n.id).join(',')));
    assert.equal(await page.locator('#admin-message').isVisible(),true);
    // Accepted write + failed readback preserves its ID and input for safe recovery.
    control.writeFail=false;control.readFail=true;await submit('task-form');
    assert.equal(await value('task-id'),'saved-task');
    assert.equal(await value('task-title-input'),'합성 부서 한정 업무');
    assert.match(await page.locator('#admin-message').innerText(),/저장.*불러오지/);
    control.readFail=false;await submit('task-form');
    assert.equal(calls.filter(c=>c.name==='save_daily_work_assignment').at(-1).args.p_assignment_id,'saved-task');
    assert.match(await page.locator('#admin-record-list').innerText(),/합성 부서 한정 업무/);
    assert.equal(await value('task-id'),'');
    assert.equal(await page.locator('#admin-message').isVisible(),true);
    // Saving the same new work guide twice must update its accepted ID.
    await page.locator('#guide-title-input').fill('합성 작업방법');
    await page.locator('#guide-reason').fill('합성 검수 사유');
    control.writeFail=true;await submit('guide-form');
    assert.equal(await value('guide-id'),'');
    assert.equal(await value('guide-title-input'),'합성 작업방법');
    assert.equal(await page.locator('#admin-message').isVisible(),true);
    control.writeFail=false;control.readFail=true;await submit('guide-form');
    assert.equal(await value('guide-id'),'saved-guide');
    assert.equal(await value('guide-title-input'),'합성 작업방법');
    assert.match(await page.locator('#admin-message').innerText(),/저장.*불러오지/);
    control.readFail=false;await submit('guide-form');
    assert.equal(calls.filter(c=>c.name==='save_work_guide').at(-1).args.p_work_guide_id,'saved-guide');
    await page.waitForFunction(()=>document.querySelector('#guide-manage-list button'));
    control.detailFail=true;
    await page.locator('#guide-manage-list button').click();
    await page.waitForFunction(()=>document.getElementById('admin-message').textContent.includes('작업방법'));
    assert.equal(await page.locator('#admin-message').isVisible(),true,'detail failure must be visible');
    assert.equal(await value('guide-title-input'),'합성 작업방법');
    control.detailFail=false;await page.locator('#guide-manage-list button').click();
    await page.waitForFunction(()=>document.getElementById('guide-step-guide-id').value==='saved-guide');
    await page.locator('#guide-step-title').fill('합성 단계');
    await page.locator('#guide-step-easy-text').fill('합성 설명');
    await page.locator('#guide-step-reason').fill('합성 단계 검수');
    control.detailFail=true;await submit('guide-step-form');
    assert.equal(await value('guide-step-id'),'saved-step');
    assert.equal(await value('guide-step-title'),'합성 단계');
    assert.match(await page.locator('#admin-message').innerText(),/저장.*불러오지/);
    await page.locator('#guide-step-form').screenshot({path:path.join(output,'work-guide-recovery-'+width+'.png')});
    control.guideListFail=true;control.detailFail=false;
    await submit('guide-step-form');
    assert.equal(calls.filter(c=>c.name==='save_work_guide_step').at(-1).args.p_step_id,'saved-step');
    assert.equal(await page.locator('#admin-message').isVisible(),true);
    await page.locator('#guide-manage-list').getByRole('button',{name:'다시 불러오기'}).waitFor();
    control.guideListFail=false;
    await page.locator('#guide-manage-list').getByRole('button',{name:'다시 불러오기'}).click();
    await page.locator('#guide-manage-list').getByRole('button',{name:'열기·수정'}).waitFor();
    assert.deepEqual(errors,[],'no hidden page errors or unknown API calls');
    console.log('BACKEND_STABILITY_BROWSER_PASS:'+width);await context.close();
  }
  const {context,page,calls,errors}=await boot(390,'promotion_staff');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('taejang-open-app-panel',{detail:{id:'today-admin-panel'}})));
  assert.equal(await page.locator('#today-admin-panel').isVisible(),false);
  assert.equal(calls.some(c=>c.name.startsWith('save_')||c.name==='get_today_board_admin_options'),false);
  assert.deepEqual(errors,[]);await context.close();
  console.log('BACKEND_STABILITY_ROLE_DENIAL_PASS:synthetic');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
