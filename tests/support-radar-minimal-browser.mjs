import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||process.env.CHROME_PATH;
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{channel:'chrome'})});
const output=process.env.SUPPORT_FINDER_QA_OUTPUT||'/tmp/taejang-support-radar-qa';await fs.mkdir(output,{recursive:true});
const preview=process.env.PREVIEW_URL;
const assets=new Map();
async function asset(file) {
  if(assets.has(file))return assets.get(file);
  const local=await fs.readFile(file,'utf8');
  if(preview){
    const response=await fetch(new URL('/'+file,preview));
    assert.ok(response.ok,'Preview asset '+file+' status '+response.status);
    const hosted=await response.text();assert.equal(hosted,local,'Preview must serve current source '+file);
    assets.set(file,hosted);return hosted;
  }
  assets.set(file,local);return local;
}
try {
  for (const width of [1440,768,390,320]) {
    const page=await browser.newPage({viewport:{width,height:950}});
    await page.setContent('<div id="desktop-app-shell"><main id="dashboard-main" class="dashboard-main" tabindex="-1"></main></div>');
    for (const file of ['staff/assets/staff.css','app/assets/dashboard-shell.css','app/assets/admin-authoring.css','app/assets/support-radar.css']) await page.addStyleTag({content:(await asset(file)).replace(/@import[^;]+;/g,'')});
    await page.evaluate(()=>{
      window.edit=true;window.sourceFailure=false;window.reviewFailure=false;window.calls=[];window.migrationAvailable=true;window.interests={one:{interested:false,revision:0},two:{interested:false,revision:0}};
      window.TaejangSupportRadarAccess={canManagementView:()=>true,canManagementEdit:()=>window.edit,canUse:()=>true,canReview:()=>window.edit};
      window.TaejangSupportRadarLifecycle={emit:(surface,detail)=>document.dispatchEvent(new CustomEvent('taejang-support-radar-rendered',{detail:{surface,...detail}}))};
      window.TaejangApp={friendlyError:()=> '검수 오류',rpc:async(name,args)=>{
        window.calls.push({name,args});
        if(['support_list_finder_notices','support_get_finder_notice_detail','support_get_collection_state'].includes(name)&&!window.migrationAvailable)throw {code:'PGRST202'};
        if(name==='support_list_finder_notices'&&window.forbidden)throw {code:'42501'};
        if(name==='support_list_finder_notices'&&window.pauseList)await new Promise(resolve=>{window.releaseList=resolve;});
        if(['support_list_notices','support_list_finder_notices'].includes(name))return [{id:'one',title:'합성 지역 공고',organization:'검수기관',deadline_at:null,decision:'hold',target_regions:['경남']},{id:'two',title:'합성 신청 공고',decision:'apply',deadline_at:'2099-10-31T23:59:59+09:00'}].map(item=>name==='support_list_finder_notices'?{...item,canonical_url:'https://www.bizinfo.go.kr/example',interested:window.interests[item.id].interested,interest_revision:window.interests[item.id].revision}:item);
        if(name==='support_get_collection_state'){if(window.sourceFailure)throw Error('failure');return {source:{code:'bizinfo',automation_status:'manual_only',last_success_at:'2026-10-26T00:00:00Z'},latest_run:window.latestRun||null};}
        if(name==='support_set_notice_interest'){if(window.interestFailure)throw Error('save failed');const value=window.interests[args.p_notice_id];if(value.revision!==args.p_expected_revision)throw Error('REVISION_CONFLICT');value.interested=args.p_interested;value.revision++;return {...value};}
        if(name==='support_list_sources'){if(window.sourceFailure)throw Error('failure');return [{code:'bizinfo',automation_status:'manual_only'}];}
        if(['support_get_notice_detail','support_get_finder_notice_detail'].includes(name))return {interest:{...window.interests[args.p_notice_id]},notice:{id:args.p_notice_id,title:'합성 지역 공고',canonical_url:'https://www.bizinfo.go.kr/example',eligibility_summary:'중소기업'},decision:{decision:'apply',decision_reason:'기존 판단'},application:{status:'reviewing',next_action:'자료 준비'},assignments:[]};
        if(name==='support_list_assignable_profiles')return [{profile_id:'person',display_name:'합성 담당자'}];
        if(name==='support_get_notice_review_status')return {review_count:0};
        if(name==='support_mark_notice_reviewed')throw Error('save failed');
        throw Error('Unexpected RPC '+name);
      }};
    });
    for(const file of ['support-radar-notices.js','support-radar-assignment.js','support-radar-review.js'])await page.addScriptTag({content:await asset('app/assets/'+file)});
    await page.addScriptTag({content:await asset('app/assets/platform-navigation-registry.js')});
    assert.equal(await page.evaluate(()=>window.TaejangPlatformNavigationRegistry.itemForLabel('지원사업 레이더').key),'support.radar');
    await page.evaluate(()=>{const nav=document.createElement('nav');nav.className='app-nav';nav.style.width='180px';nav.id='test-narrow-nav';const button=document.createElement('button');button.textContent='태장 지원사업 찾기';nav.append(button);document.body.append(nav);});
    assert.ok(await page.locator('#test-narrow-nav button').evaluate(node=>node.scrollWidth<=node.clientWidth));
    await page.locator('#test-narrow-nav').evaluate(node=>node.remove());
    await page.evaluate(()=>{window.pauseList=true;window.pendingList=window.TaejangSupportRadarNotices.renderList();});
    await page.getByText('지원사업 공고를 불러오고 있습니다.',{exact:true}).waitFor();
    await page.evaluate(async()=>{window.pauseList=false;window.releaseList();await window.pendingList;});
    await page.getByRole('heading',{name:'태장 지원사업 찾기',exact:true}).waitFor();
    await page.getByText('자동수집 미연결 · 수동 등록 자료입니다.').waitFor();
    await page.getByRole('searchbox').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'판단 필터');
    await page.getByRole('combobox',{name:'판단 필터'}).selectOption('hold');
    await page.getByRole('combobox',{name:'마감 필터'}).selectOption('unknown');
    await page.getByRole('searchbox').fill('경남');
    assert.equal(await page.getByRole('button',{name:'상세·원문 확인'}).count(),1);
    await page.getByRole('button',{name:'관심 보관',exact:true}).click();
    await page.getByRole('button',{name:'관심 해제',exact:true}).waitFor();
    await page.getByRole('combobox',{name:'판단 필터'}).selectOption('interest');
    assert.equal(await page.getByRole('button',{name:'상세·원문 확인'}).count(),1);
    await page.getByRole('combobox',{name:'판단 필터'}).selectOption('hold');
    await page.getByRole('button',{name:'상세·원문 확인'}).click();
    await page.getByRole('button',{name:'담당자로 배정'}).waitFor();
    assert.equal(await page.getByRole('link',{name:'원문 열기'}).getAttribute('href'),'https://www.bizinfo.go.kr/example');
    // Labels can change without detaching secondary modules from their owned sections.
    await page.locator('[data-support-section="facts"] h3').evaluate(node=>node.textContent='다른 제목');
    await page.locator('[data-support-review-panel]').waitFor({state:'attached'});
    await page.getByText('검토 기록·메모',{exact:true}).click();
    await page.getByPlaceholder('검토 메모(선택)').fill('보존할 메모');
    page.on('dialog',dialog=>dialog.dismiss());
    await page.getByRole('button',{name:'관심 해제',exact:true}).click();
    await page.getByRole('button',{name:'관심 보관',exact:true}).waitFor();
    assert.equal(await page.getByPlaceholder('검토 메모(선택)').inputValue(),'보존할 메모');
    await page.evaluate(()=>window.interestFailure=true);
    await page.getByRole('button',{name:'관심 보관',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'관심 보관',exact:true}).getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>window.interestFailure=false);
    await page.getByRole('button',{name:'검토 완료 표시'}).click();
    assert.equal(await page.getByPlaceholder('검토 메모(선택)').inputValue(),'보존할 메모');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
    await page.screenshot({path:output+`/detail-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'전체 공고',exact:true}).click();
    assert.equal(await page.getByRole('searchbox').inputValue(),'경남');
    assert.equal(await page.getByRole('combobox',{name:'판단 필터'}).inputValue(),'hold');
    assert.equal(await page.getByRole('combobox',{name:'마감 필터'}).inputValue(),'unknown');
    await page.screenshot({path:output+`/list-${width}.png`,fullPage:true});
    await page.evaluate(()=>{window.edit=false;window.sourceFailure=true;});
    await page.evaluate(()=>window.TaejangSupportRadarNotices.renderList());
    await page.getByText('수집 상태를 조회하지 못했습니다. 공고 목록은 계속 확인할 수 있습니다.').waitFor();
    assert.equal(await page.getByRole('button',{name:'공고 직접 등록'}).count(),0);
    await page.getByRole('button',{name:'상세·원문 확인'}).click();
    await page.locator('[data-support-section="facts"]').waitFor();
    assert.equal(await page.getByRole('button',{name:'신청',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'담당자로 배정'}).count(),0);
    await page.evaluate(()=>{window.edit=true;window.sourceFailure=false;window.latestRun={status:'success_no_new',added:0,updated:1};});
    await page.evaluate(()=>window.TaejangSupportRadarNotices.renderList());
    await page.getByText('새 공고 없음 · 변경 1건',{exact:true}).waitFor();
    await page.evaluate(()=>window.latestRun={status:'authentication_failed'});
    await page.evaluate(()=>window.TaejangSupportRadarNotices.renderList());
    await page.getByText('기업마당 인증 실패',{exact:true}).waitFor();
    await page.evaluate(()=>window.migrationAvailable=false);
    await page.evaluate(()=>window.TaejangSupportRadarNotices.renderList());
    await page.getByRole('button',{name:'상세·원문 확인'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'관심 보관',exact:true}).count(),0);
    await page.evaluate(()=>{window.migrationAvailable=true;window.forbidden=true;window.calls=[];});
    await page.evaluate(()=>window.TaejangSupportRadarNotices.renderList());
    assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name==='support_list_notices')),false);
    await page.close();
  }
  console.log('PASS: '+(preview?'exact-head Preview assets':'local assets')+'; synthetic RPC; 1440/768/390/320px list/detail, search restoration, source failure, memo preservation, read-only controls');
} finally {await browser.close();}
