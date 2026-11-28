import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const root=process.cwd();
const files=new Set([
  '/app/assets/daily-briefing.mjs','/app/assets/daily-briefing.css','/app/assets/dashboard-shell.css',
  '/app/assets/platform-navigation-registry.js','/staff/assets/staff.css'
]);
const types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'};
const server=createServer(async (req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  if(file==='/'){
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/dashboard-shell.css"><main id="dashboard-main"></main></html>');
    return;
  }
  if(!files.has(file)){res.writeHead(404).end();return;}
  res.setHeader('content-type',types[path.extname(file)]);
  res.end(await readFile(path.join(root,file)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const host='http://127.0.0.1:'+server.address().port;
const out=process.env.BRIEFING_QA_OUTPUT||'/tmp/taejang-daily-briefing-qa';
await mkdir(out,{recursive:true});
const browser=await chromium.launch(process.env.CHROME_PATH
  ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'});
try {
  for(const width of [320,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:1000},locale:'ko-KR'});
    await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:host});
    await page.clock.setFixedTime(new Date('2026-11-29T22:30:00Z'));
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(host);
    await page.addScriptTag({url:host+'/app/assets/platform-navigation-registry.js'});
    await page.evaluate(async()=>{
      const schedule={enabled:true,generate_at:'07:30:00',review_at:'08:30:00',share_at:'08:40:00',version:1,rules:[]};
      const row={work_date:'2026-11-30',version:1,source:{is_workday:true,issues:[],sections:{
        headlines:['**외부활동 참석 인원 확인 및 안전교육 준비**'],work:['09:00 조례 및 기본 업무','오후반 — 기본 업무 진행'],
        staff:['오전반 — 근무 8명 · 연차 1명','오후반 — 근무 7명 · 연차 없음'],
        upcoming:['12/02 환경정비 활동','12/04 오후반 대청소'],rules:['출퇴근 기록','사원증 패용','인사','청결','건강관리']
      }},edits:{},hidden:[],note:'',created_at:'2026-11-29T22:30:00Z',updated_at:'2026-11-29T22:30:00Z',confirmed_at:null};
      const stored=[];
      const deliveries=[];
      window.mock={role:'operations_manager',stored,deliveries,fail:false};
      const calls=[];
      const payload=()=>structuredClone({briefing:row,schedule});
      Object.defineProperty(navigator,'share',{value:async({text})=>{mock.shared=text;}});
      Object.defineProperty(navigator,'canShare',{value:({text})=>Boolean(text)});
      window.TaejangApp={
        getRoute:()=>mock.role,
        async rpc(name,args){
          calls.push({name,args});
          if(name==='get_daily_briefing')return payload();
          if(name==='write_daily_briefing'){
            if(mock.fail)throw Error('BRIEFING_SOURCE_CHANGED');
            if(args.p_action==='revise'){row.version++;row.confirmed_at=null;return payload();}
            Object.assign(row,{edits:structuredClone(args.p_edits),hidden:[...args.p_hidden],note:args.p_note});
            if(args.p_action==='refresh'){
              row.source.issues=mock.sourceFailure?['공용 일정']:[];
              row.source.sections.work=['09:00 [변경] 조례 및 기본 업무'];
            }
            if(args.p_action==='confirm'){
              row.confirmed_at='2026-11-29T23:40:00Z';row.confirmer='운영팀장';
              stored.push(structuredClone(row));
            }
            return payload();
          }
          if(name==='record_daily_briefing_delivery'){deliveries.push(args);return null;}
          if(name==='list_daily_briefings')return stored.map(b=>({...b,author:'자동 생성',editor:'운영팀장',delivery_actions:deliveries.map(x=>x.p_action)}));
          if(name==='get_daily_briefing_version')return {...stored.find(b=>b.version===args.p_version),deliveries:[]};
          if(name==='get_daily_briefing_settings')return structuredClone(schedule);
          if(name==='save_daily_briefing_settings'){
            schedule.rules=args.p_rules;
            schedule.generate_at=args.p_generate+':00';
            return {...schedule,version:++schedule.version};
          }
          throw Error(name);
        }
      };
      const {mountDailyBriefing}=await import('/app/assets/daily-briefing.mjs');
      window.mountBriefing=()=>mountDailyBriefing(document.getElementById('dashboard-main'));
      await mountBriefing();
    });
    const element=by=>page.getByRole('button',{name:by,exact:true});
    const text=page.locator('pre.briefing-output');
    assert.match(await text.innerText(),/외부활동 참석 인원 확인/);
    if(width<=768)assert.equal(await page.locator('.briefing-tabs .button').evaluateAll(items=>
      new Set(items.map(item=>item.getBoundingClientRect().top)).size),1,'mobile tabs share one row');
    assert.equal(await page.getByRole('textbox',{name:'근무 현황'}).getAttribute('readonly'),'');
    assert.equal(await element('전문 복사').count(),0,'draft has no delivery actions');
    await page.getByLabel('오늘 특이사항').fill('> **15시 안전장비 확인**\n---');
    await page.getByRole('textbox',{name:'오늘의 업무'}).fill('## 09:00 조례\n- **오후반 업무**');
    assert.match(await text.textContent(),/01\. 오늘의 핵심\n· 외부활동 참석 인원 확인 및 안전교육 준비\n· 15시 안전장비 확인\n\n02\. 오늘의 업무\n· 09:00 조례\n· 오후반 업무/);
    assert.doesNotMatch(await text.textContent(),/\*\*|##|---/,'preview removes pasted formatting before save');
    const upcomingVisibility=page.locator('.briefing-section').filter({has:page.getByRole('heading',{name:'예정 일정'})}).getByLabel('표시');
    await upcomingVisibility.uncheck();
    assert.doesNotMatch(await text.textContent(),/04\. 예정 일정/);
    await upcomingVisibility.check();
    assert.match(await text.textContent(),/04\. 예정 일정/);
    await page.evaluate(()=>{mock.fail=true;});
    await element('브리핑 확정').click();
    await page.getByRole('alert').filter({hasText:'원본 내용이 바뀌었습니다'}).waitFor();
    assert.match(await text.innerText(),/15시 안전장비 확인/,'failed save preserves typed input');
    await page.evaluate(()=>{mock.fail=false;mock.sourceFailure=true;});
    await element('최신 자료 불러오기').click();
    await page.getByRole('alert').filter({hasText:'공용 일정'}).waitFor();
    assert.equal(await element('브리핑 확정').isEnabled(),false);
    await page.evaluate(()=>{mock.sourceFailure=false;});
    await element('최신 자료 불러오기').click();
    await element('브리핑 확정').waitFor();
    assert.match(await text.innerText(),/09:00 조례/,'refresh keeps only manually edited text');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(out,'editor-'+width+'.png'),fullPage:true});
    await element('브리핑 확정').click();
    await element('전문 복사').click();
    await page.getByText('복사했습니다. 카카오톡 업무방에 붙여넣으세요.').waitFor();
    const copied=await page.evaluate(()=>navigator.clipboard.readText());
    assert.equal(copied,await text.textContent(),'clipboard matches the live preview including line breaks');
    const paste=await page.evaluateHandle(()=>document.body.appendChild(document.createElement('textarea')));
    await paste.focus();
    await page.keyboard.press('Control+v');
    assert.equal(await paste.inputValue(),copied,'plain text paste preserves the copied message');
    await paste.evaluate(element=>element.remove());
    await element('카카오톡 공유').click();
    await page.getByText(/업무방에서 전송을 확인/).waitFor();
    await page.waitForFunction(()=>mock.deliveries.length===2);
    const result=await page.evaluate(()=>[mock.shared,mock.deliveries.map(d=>d.p_action)]);
    assert.equal(copied,result[0],'both channels use the same plain text');
    assert.deepEqual(result[1],['copied','share_requested']);
    assert.match(copied,/태장 ERP · 오전 8:40 기준/);
    if(width===390)await page.screenshot({path:path.join(out,'message-390.png'),fullPage:true});
    await element('브리핑 이력').click();
    await element('내용 보기').click();
    await page.locator('pre').getByText(/15시 안전장비 확인/).waitFor();
    await element('반복 설정').click();
    const generation=page.getByLabel('생성 시각',{exact:true});
    assert.equal(await generation.inputValue(),'07:30');
    await generation.fill('07:45');
    await element('반복 문구 추가').click();
    await page.getByLabel('반복 문구').fill('금요일 대청소');
    await page.getByLabel('반복 조건').selectOption('weekly');
    await page.getByLabel('금',{exact:true}).check();
    await page.getByLabel('대상',{exact:true}).selectOption('오후반');
    await element('설정 저장').click();
    await page.getByText('반복 설정을 저장했습니다.').waitFor();
    await element('오늘의 브리핑').click();
    await element('반복 설정').click();
    assert.equal(await generation.inputValue(),'07:45','saved time remains on reopening settings');
    const roles=await page.evaluate(()=>['operations_manager','promotion_lead','general_worker'].map(role=>
      TaejangPlatformNavigationRegistry.visibleForRole('daily_briefing.manage',role)));
    assert.deepEqual(roles,[true,true,false]);
    assert.deepEqual(pageErrors,[]);
    console.log('PASS daily briefing browser '+width+'px');
    await page.close();
  }
} finally { await browser.close();server.close(); }
