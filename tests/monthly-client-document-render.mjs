// Real DOCX -> PDF verification with synthetic values only. Missing renderers fail the gate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),core=require('../app/assets/monthly-client-document-core.js'),docx=require('../app/assets/monthly-client-document-docx.js'),JSZip=require('../app/assets/vendor/jszip-3.10.1.min.js');
const output=path.resolve(process.env.MONTHLY_RENDER_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(),'monthly-document-render-')));
await fs.mkdir(output,{recursive:true});
const current=JSON.parse(await fs.readFile(new URL('../app/assets/monthly-client-document-template.json',import.meta.url),'utf8'));
const legacy=JSON.parse(await fs.readFile(new URL('../app/assets/monthly-client-document-template-v1.json',import.meta.url),'utf8'));
const packageBytes=await fs.readFile(new URL('../app/assets/monthly-client-document-package.zip',import.meta.url));
const companies=[['beomhan','범한메카텍',19,7,6,7],['samhyeon','삼현',19,7,'',10],['cheongwoo-bj','청우비제이',13,5,'',10],['hyundai-bng-steel','현대비앤지스틸',17.5,7,'',10]].map(([id,key,share,cap,override,pay],i)=>({id,key,name:key+' 합성검수기업',enabled:true,share,cap,override,pay,seq:i+1,note:''}));
const common={year:2026,month:10,docDate:'2026-10-30',perfDate:'2026-10-14',perfDates:['2026-10-14','2026-10-23'],workDescription:'농원 작업 구역의 잡초 제거, 주변 통행로 정돈 및 작업 도구 정리',place:'합성 검수 농원',safety:'outdoor',severe:20,mildF:0,mildM:3,base:1295000,rate:70,note:'',extras:[]};
const scenarios=[
 {id:'october-two-days-no-program',common,companies,template:current},
 {id:'long-korean-boundary',common:{...common,perfDate:'2026-10-01',perfDates:['2026-10-01','2026-10-08','2026-10-14','2026-10-23'],place:'농원작업구역'.repeat(10),workDescription:'농원작업상세내용'.repeat(20)},companies:companies.map(c=>({...c,name:'한글검수기업이름'.repeat(4)})),template:current},
 {id:'optional-program-lines',common:{...common,workDescription:'작업 구역 정돈\n통행로 정리',safety:'indoor',extras:[{name:'선택 문화활동',description:'합성 검수용 월별 활동'},{name:'시설 정리',description:'합성 공간 정돈'}]},companies:companies.map((c,i)=>i===0?{...c,override:7}:c),template:current},
 {id:'legacy-reproduction',common:Object.fromEntries(Object.entries(common).filter(([k])=>!['perfDates','workDescription'].includes(k))),companies,template:legacy}
];
const entries=[];
for(const scenario of scenarios){
 const folder=path.join(output,scenario.id);await fs.mkdir(folder,{recursive:true});
 for(const selected of scenario.companies.map(c=>[c]).concat([scenario.companies])){
  const stem=selected.length===4?'all':selected[0].id;
  const filename=path.join(folder,stem+'.docx');
  const bytes=await docx.createDocx({JSZip,template:scenario.template,packageBytes,common:scenario.common,companies:selected,type:'nodebuffer'});await fs.writeFile(filename,bytes);
  entries.push({scenario,selected,filename,pdf:filename.replace(/\.docx$/,'.pdf')});
 }
 const files=entries.filter(e=>e.scenario===scenario).map(e=>e.filename);
 execFileSync(process.env.SOFFICE_PATH || 'soffice',[`-env:UserInstallation=${pathToFileURL(path.join(output,'lo-profile')).href}`,'--headless','--convert-to','pdf','--outdir',folder,...files],{timeout:120000,stdio:'pipe'});
}
const strip=value=>value.replace(/\s/g,'');
const evidence=[];
for(const {scenario,selected,pdf} of entries){
 const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}),pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);assert.equal(pages,selected.length*3,pdf+' must contain exactly three pages per company');
 for(const [i,company] of selected.entries())for(const [j,label] of ['공문','견적서','수행 결과보고서'].entries()){
  const page=i*3+j+1,text=execFileSync('pdftotext',['-f',String(page),'-l',String(page),pdf,'-'],{encoding:'utf8'}),compact=strip(text);
  const expected=docx.filename(scenario.common,[company]);assert.ok(expected.includes(company.key));
  if(scenario.template.version || j!==1) assert.ok(compact.includes(strip(scenario.common.place)),`${pdf} page ${page} missing complete place`);
  assert.ok(compact.includes(strip(company.name)),`${pdf} page ${page} missing company name`);
  if(j===1)assert.ok(compact.includes('견적서'));if(j===2)assert.ok(compact.includes('용역수행결과보고서'));
  const calculation=core.calculate(scenario.common,company);if(j<2)assert.ok(compact.includes(core.formatAmount(calculation.supplyAmount)),`${pdf} page ${page} amount changed`);
  if(scenario.template.version){
   assert.ok(compact.includes(strip(scenario.common.workDescription)),`${pdf} page ${page} clipped work detail`);
   for(const date of scenario.common.perfDates){const [year,month,day]=date.split('-').map(Number);assert.ok(compact.includes(j===1?`${year}.${month}.${day}.`:`${year}년${month}월${day}일`),`${pdf} page ${page} missing ${date}`);}
   assert.ok(compact.includes('안전교육'));
   assert.ok(compact.includes('직인'));assert.doesNotMatch(text,/직인생략|공원·거리|주변 보행로/);
   if(!scenario.common.extras.length)assert.doesNotMatch(text,/버스킹/);
  }
 }
 evidence.push({scenario:scenario.id,file:path.relative(output,pdf),pages,companies:selected.length,completePageText:true});
}
await fs.writeFile(path.join(output,'render-evidence.json'),JSON.stringify({renderer:execFileSync(process.env.SOFFICE_PATH || 'soffice',['--version'],{encoding:'utf8'}).trim(),entries:evidence},null,2));
console.log(JSON.stringify({output,documents:entries.length,pages:evidence.map(e=>e.pages),passed:true}));
