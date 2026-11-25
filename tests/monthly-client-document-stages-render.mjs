import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderCompanyDocuments } from '../scripts/render-monthly-client-document.mjs';

const output = process.env.MONTHLY_RENDER_OUTPUT ? path.resolve(process.env.MONTHLY_RENDER_OUTPUT,'stages') : await mkdtemp(path.join(tmpdir(), 'monthly-stage-'));
await mkdir(output,{recursive:true});
const companies = [
  ['beomhan',19,7,6,7,'5,439,000'], ['samhyeon',19,7,'',10,'6,345,500'],
  ['cheongwoo-bj',13,5,'',10,'4,532,500'], ['hyundai-bng-steel',17.5,7,'',10,'6,345,500']
].map(([id,share,cap,override,pay,supply],i)=>({id,key:id,name:'합성 검수기업 '+(i+1),enabled:true,share,cap,override,pay,seq:i+1,note:'',supply}));
const common = {year:2026,month:11,noticeDate:'2026-11-13',quoteDate:'2026-11-21',reportDate:'2026-11-22',
  perfDates:['2026-11-19'],actualPerfDates:['2026-11-20'],workDescription:'보행로 청소',place:'검수 공원 일원',
  note:'',severe:20,mildF:0,mildM:2,base:1295000,rate:70,extras:[],serviceType:'env',
  safety:{mode:'indoor_hq'},promotion:{status:'planned'},photoSets:['safety','site','group']};
const settings = {contract_basis_text:'계약 별첨2(용역 제공 기준)',service_types:{env:{item:'지역사회 환경정화 용역',report:'{N}월 지역사회 환경정화 용역',work:['{장소} 청소']}}};
const afterWork = {common,company:companies[0],stage:'result',plan:'single_bundle',settings};
await assert.rejects(renderCompanyDocuments(afterWork),/INVALID_BUNDLE_ISSUE_DATE/);
for(const [stage,plan] of [['report','three_step'],['result','three_step'],['result','notice_skipped'],['result','single_bundle']]){
  await assert.rejects(renderCompanyDocuments({...afterWork,stage,plan,common:{...common,actualPerfDates:[],bundleIssueDate:'2026-11-23'}}),/REQUIRED_ACTUAL_PERFORMANCE_DATES/);
}
await assert.rejects(renderCompanyDocuments({...afterWork,common:{...common,bundleIssueDate:common.noticeDate}}),/BUNDLE_ISSUE_BEFORE_PERFORMANCE/);
await assert.rejects(renderCompanyDocuments({...afterWork,common:{...common,bundleIssueDate:'2026-11-21',actualPerfDates:['2026-11-23','2026-11-20']}}),/BUNDLE_ISSUE_BEFORE_PERFORMANCE/);
for (const [stage,plan,count] of [['notice','three_step',1],['quote','three_step',1],['report','three_step',1],['result','three_step',2],['result','notice_skipped',2],['result','single_bundle',3]]) {
  for (const company of companies) {
    const withEvent={...common,extras:[{name:'추가 행사',description:'참여기업과 함께한 환경 캠페인'}]};
    const includeEvent=company.id==='samhyeon' && ['notice','report'].includes(stage);
    const input = plan==='single_bundle'?{...common,bundleIssueDate:'2026-11-23'}:includeEvent?withEvent:common;
    const pair = await renderCompanyDocuments({common:input,company,stage,plan,settings});
    const stem = path.join(output,company.id+'-'+stage+'-'+plan);
    assert.ok(pair.filename.endsWith('_'+company.key));
    await writeFile(stem+'.docx',pair.word);
    await writeFile(stem+'.pdf',pair.pdf);
    assert.equal(Number(execFileSync('pdfinfo',[stem+'.pdf'],{encoding:'utf8'}).match(/^Pages:\s+(\d+)/m)[1]),count);
    const text = execFileSync('pdftotext',[stem+'.pdf','-'],{encoding:'utf8'}).replace(/\s/g,'');
    if(includeEvent)assert.match(text,/추가행사—참여기업과함께한환경캠페인/);
    assert.doesNotMatch(text,/환경정비|별첨1|직인생략|{{/);
    if(stage!=='report')assert.ok(text.includes(company.supply));
    assert.ok(text.includes(company.name.replace(/\s/g,'')));
    if (stage==='notice') {
      assert.match(text,/2026\.11\.13\./);
      assert.match(text,/2026년11월19일\(목\).*수행할예정이며/);
      assert.doesNotMatch(text,/2026\.11\.23\./);
      assert.doesNotMatch(text,/붙임/);
      assert.match(text,/가\.실내안전교육—작업전태장본사/);
      if (company.id==='beomhan') assert.match(text,/22명\(중증20명,경증2명\)/);
    } else if(stage==='quote'){
      assert.match(text,/견적내역/);
      assert.doesNotMatch(text,/용역수행결과보고서/);
      assert.match(text,/2026\.11\.21\./);
    } else {
      const report = execFileSync('pdftotext',['-f',String(count),'-l',String(count),stem+'.pdf','-'],{encoding:'utf8'}).replace(/\s/g,'');
      assert.match(report,/2026년11월지역사회환경정화/);
      assert.doesNotMatch(report,/근로자수|중증20명|산입인원/);
      assert.match(report,/압축파일1건/);
      assert.match(report,/공식유튜브채널/);
      assert.match(text,/게시할예정입니다/);
      assert.match(text,/2026년11월20일\(금\)/);
      if(stage!=='report')assert.match(text,/2026\.11\.21\./);
      assert.match(text,/2026\.11\.22\./);
      if(plan==='single_bundle'){
        const cover=execFileSync('pdftotext',['-f','1','-l','1',stem+'.pdf','-'],{encoding:'utf8'}).replace(/\s/g,'');
        const quote=execFileSync('pdftotext',['-f','2','-l','2',stem+'.pdf','-'],{encoding:'utf8'}).replace(/\s/g,'');
        assert.match(cover,/2026\.11\.23\./);
        assert.match(cover,/2026년11월20일\(금\).*수행하였으며/);
        assert.doesNotMatch(cover,/2026\.11\.13\./);
        assert.match(quote,/2026\.11\.21\./);
        assert.match(report,/2026\.11\.22\./);
      }
      if (plan==='notice_skipped') assert.ok(text.includes('관련:T2026-11-0'+company.seq+'호'));
    }
  }
  console.log(stage,plan,count+' pages');
}
