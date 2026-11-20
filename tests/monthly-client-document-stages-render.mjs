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
for (const [stage,plan,count] of [['notice','three_step',1],['result','three_step',2],['result','notice_skipped',2],['result','single_bundle',3]]) {
  for (const company of companies) {
    const pair = await renderCompanyDocuments({common,company,stage,plan,settings});
    const stem = path.join(output,company.id+'-'+stage+'-'+plan);
    assert.ok(pair.filename.endsWith('_'+company.key));
    await writeFile(stem+'.docx',pair.word);
    await writeFile(stem+'.pdf',pair.pdf);
    assert.equal(Number(execFileSync('pdfinfo',[stem+'.pdf'],{encoding:'utf8'}).match(/^Pages:\s+(\d+)/m)[1]),count);
    const text = execFileSync('pdftotext',[stem+'.pdf','-'],{encoding:'utf8'}).replace(/\s/g,'');
    assert.doesNotMatch(text,/환경정비|별첨1|직인생략|{{/);
    assert.ok(text.includes(company.supply));
    assert.ok(text.includes(company.name.replace(/\s/g,'')));
    if (stage==='notice') {
      assert.match(text,/수행할예정이며/);
      assert.doesNotMatch(text,/붙임/);
    } else {
      assert.match(text,/게시할예정입니다/);
      assert.match(text,/2026년11월20일\(금\)/);
      assert.match(text,/2026\.11\.21\./);
      assert.match(text,/2026\.11\.22\./);
      if (plan==='notice_skipped') assert.ok(text.includes('관련:T2026-11-0'+company.seq+'호'));
    }
  }
  console.log(stage,plan,count+' pages');
}
