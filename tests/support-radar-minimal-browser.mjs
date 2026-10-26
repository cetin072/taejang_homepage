import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
const output='/tmp/taejang-support-radar-qa';await fs.mkdir(output,{recursive:true});
try {
  for (const width of [1440,768,390,320]) {
    const page=await browser.newPage({viewport:{width,height:950}});
    await page.setContent('<div id="desktop-app-shell"><main id="dashboard-main" class="dashboard-main" tabindex="-1"></main></div>');
    for (const file of ['staff/assets/staff.css','app/assets/dashboard-shell.css','app/assets/admin-authoring.css','app/assets/support-radar.css']) await page.addStyleTag({content:(await fs.readFile(file,'utf8')).replace(/@import[^;]+;/g,'')});
    await page.evaluate(()=>{
      window.edit=true;window.sourceFailure=false;window.reviewFailure=false;window.calls=[];
      window.TaejangSupportRadarAccess={canManagementView:()=>true,canManagementEdit:()=>window.edit,canUse:()=>true,canReview:()=>window.edit};
      window.TaejangSupportRadarLifecycle={emit:(surface,detail)=>document.dispatchEvent(new CustomEvent('taejang-support-radar-rendered',{detail:{surface,...detail}}))};
      window.TaejangApp={friendlyError:()=> '검수 오류',rpc:async(name,args)=>{
        window.calls.push({name,args});
        if(name==='support_list_notices')return [{id:'one',title:'합성 지역 공고',organization:'검수기관',deadline_at:null,decision:'hold',target_regions:['경남']},{id:'two',title:'합성 신청 공고',decision:'apply',deadline_at:'2099-10-31T23:59:59+09:00'}];
        if(name==='support_list_sources'){if(window.sourceFailure)throw Error('failure');return [{code:'bizinfo',automation_status:'manual_only'}];}
        if(name==='support_get_notice_detail')return {notice:{id:args.p_notice_id,title:'합성 지역 공고',canonical_url:'https://www.bizinfo.go.kr/example',eligibility_summary:'중소기업'},decision:{decision:'apply',decision_reason:'기존 판단'},application:{status:'reviewing',next_action:'자료 준비'},assignments:[]};
        if(name==='support_list_assignable_profiles')return [{profile_id:'person',display_name:'합성 담당자'}];
        if(name==='support_get_notice_review_status')return {review_count:0};
        if(name==='support_mark_notice_reviewed')throw Error('save failed');
        throw Error('Unexpected RPC '+name);
      }};
    });
    for(const file of ['support-radar-notices.js','support-radar-assignment.js','support-radar-review.js'])await page.addScriptTag({path:'app/assets/'+file});
    await page.evaluate(()=>window.TaejangSupportRadarNotices.renderList());
    await page.getByText('자동수집 미연결 · 수동 등록 자료입니다.').waitFor();
    await page.getByRole('searchbox').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'판단 필터');
    await page.getByRole('combobox',{name:'판단 필터'}).selectOption('hold');
    await page.getByRole('combobox',{name:'마감 필터'}).selectOption('unknown');
    await page.getByRole('searchbox').fill('경남');
    assert.equal(await page.getByRole('button',{name:'상세·원문 확인'}).count(),1);
    await page.getByRole('button',{name:'상세·원문 확인'}).click();
    await page.getByRole('button',{name:'담당자로 배정'}).waitFor();
    assert.equal(await page.getByRole('link',{name:'원문 열기'}).getAttribute('href'),'https://www.bizinfo.go.kr/example');
    // Labels can change without detaching secondary modules from their owned sections.
    await page.locator('[data-support-section="facts"] h3').evaluate(node=>node.textContent='다른 제목');
    await page.locator('[data-support-review-panel]').waitFor({state:'attached'});
    await page.getByText('검토 기록·메모',{exact:true}).click();
    await page.getByPlaceholder('검토 메모(선택)').fill('보존할 메모');
    page.on('dialog',dialog=>dialog.dismiss());
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
    await page.close();
  }
  console.log('PASS: 1440/768/390/320px isolated list/detail, search restoration, source failure, review input preservation, read-only role controls');
} finally {await browser.close();}
