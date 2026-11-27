import {erpDocumentName, printErpPdf} from './erp-pdf.mjs';

const roles=['department_lead','promotion_lead','operations_manager','ceo'];
const supervisors=['operations_manager','ceo'];
const key='daily_work.manage';
const specs=[['work_done','① 오늘의 업무 내용'],['staff_notes','② 근로자 특이사항'],['other_notes','③ 기타 · 보고가 필요한 내용']];
const safety='긴급상황(사고·부상·무단결근·근로자 갈등·장비 고장)은 기록과 별도로 즉시 이사·대표에게 연락하세요.';
const heading='태장 일일 작업기록지';
let active, stopPrint;
const element=(tag,text='',className='')=>Object.assign(document.createElement(tag),{textContent:text,className});
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cleanPrint=()=>document.getElementById('daily-work-print')?.remove();
const actor=()=>{
 const app=window.TaejangApp, context=app?.getAccessContext?.();
 const actual=app?.getActualRoles?.()||[], effective=app?.getEffectiveRoles?.()||[];
 if(!context?.id||context.account_status!=='active'||context.role_simulation?.active||
    !roles.some(r=>actual.includes(r))||!roles.some(r=>effective.includes(r))||
    window.TaejangMenuAuthority?.allowed(key,true)===false)return null;
 return {token:context.id+'|'+actual.slice().sort().join(',')+'|'+effective.slice().sort().join(','),
  readAll:supervisors.some(r=>actual.includes(r))&&supervisors.some(r=>effective.includes(r))};
};

export function workReportFilename(report){
 return erpDocumentName(report.work_date+'_'+report.author_name);
}
const shift=r=>[r.morning?'오전':'',r.afternoon?'오후':''].filter(Boolean).join(' · ');
const xmlEsc=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
export async function makeWorkReportWord(report,JSZip,type='blob'){
 const zip=new JSZip();
 const p=(value,opts={})=>'<w:p><w:pPr><w:spacing w:after="'+(opts.bold?'110':'140')+'"/>'+(opts.center?'<w:jc w:val="center"/>':'')+(opts.bold?'<w:keepNext/>':'')+'</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic"/>'+(opts.bold?'<w:b/>':'')+'<w:sz w:val="'+(opts.size||22)+'"/></w:rPr><w:t xml:space="preserve">'+xmlEsc(value)+'</w:t></w:r></w:p>';
 const approvals='<w:tbl><w:tblPr><w:tblW w:w="3900" w:type="dxa"/><w:jc w:val="right"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(edge=>'<w:'+edge+' w:val="single" w:sz="6" w:color="9BA4AF"/>').join('')+'</w:tblBorders></w:tblPr><w:tblGrid>'+Array(3).fill('<w:gridCol w:w="1300"/>').join('')+'</w:tblGrid><w:tr>'+['작성자','이사','대표'].map(label=>'<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/></w:tcPr>'+p(label,{center:true})+'</w:tc>').join('')+'</w:tr><w:tr>'+[report.author_name,'',''].map(value=>'<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/></w:tcPr>'+p(value,{center:true})+'</w:tc>').join('')+'</w:tr></w:tbl>';
 const meta='작성일 '+report.work_date+'    작성자 '+report.author_name+'    근무 '+shift(report);
 const body=p(heading,{bold:true,center:true,size:36})+p('기록 No. '+report.id)+p(meta)+approvals+
  specs.map(([name,label])=>p(label,{bold:true,size:24})+String(report[name]||'—').split(/\r?\n/).map(x=>p(x)).join('')).join('')+p(safety);
 zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="992" w:right="992" w:bottom="992" w:left="992"/></w:sectPr></w:body></w:document>');
 return zip.generateAsync({type,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
function reportDocument(report){
 const doc=element('article','','dwl-document');
 doc.append(element('h1',heading),element('p','기록 No. '+report.id,'dwl-ref'),
  element('p','작성일 '+report.work_date+'  ·  작성자 '+report.author_name+'  ·  근무 '+shift(report),'dwl-meta'));
 const approval=element('table','','dwl-approval'),headers=element('tr'),names=element('tr');
 for(const label of ['작성자','이사','대표'])headers.append(element('th',label));
 for(const value of [report.author_name,'',''])names.append(element('td',value));
 const rows=element('tbody');rows.append(headers,names);approval.append(rows);doc.append(approval);
 for(const [name,label] of specs){
  const part=element('section');part.append(element('h2',label),element('p',report[name]||'—','dwl-text'));doc.append(part);
 }
 doc.append(element('p',safety,'dwl-safety'));return doc;
}
function labeled(parent,label,tag='input',type='text'){
 const box=element('label',label,'dwl-field'),control=element(tag);if(tag==='input')control.type=type;
 control.setAttribute('aria-label',label);box.append(control);parent.append(box);return control;
}
function btn(parent,label,fn,primary=false){
 const b=element('button',label,'button'+(primary?' primary':''));b.type='button';
 b.addEventListener('click',fn);parent.append(b);return b;
}
function loadStyle(){
 if(document.querySelector('link[data-daily-work-style]'))return;
 const l=element('link');l.rel='stylesheet';l.href=new URL('./daily-work-log.css',import.meta.url).href;l.dataset.dailyWorkStyle='1';document.head.append(l);
}
export function allowedDailyWork(){return !!actor();}
export function dailyWorkDirty(){return !!(active?.root.isConnected&&(active.dirty||active.scheduleEdits));}
export function mountDailyWork(container){
 const session=actor();if(!container||!session)throw Error('DAILY_WORK_FORBIDDEN');
 loadStyle();
 const root=element('section','','dwl dashboard-section');
 container.replaceChildren(root);
 const state={root,dirty:false,scheduleEdits:false,token:session.token};
 active=state;
 let current=null,revision=0,page=0,searchSeq=0,saving=false;
 const valid=()=>root.isConnected&&active===state&&actor()?.token===session.token;
 const status=element('p','','dwl-status');status.setAttribute('role','status');
 function report(text,error=false){if(valid()){status.textContent=text;status.classList.toggle('error',error);}}
 root.append(element('h2','일일 업무일지'),element('p',session.readAll?'전체 일지를 검색할 수 있습니다. 다른 사람의 일지는 열람과 다운로드만 가능합니다.':'본인이 작성한 일지만 조회할 수 있습니다.','dwl-help'),status);
 const form=element('form','','dwl-panel');
 const filters=element('form','','dwl-panel');const list=element('div','','dwl-results');
 const filterBar=element('div','','dwl-fields');
 filters.append(element('h3','저장한 일지 찾기'),filterBar,list);
 const from=labeled(filterBar,'시작일','input','date'),to=labeled(filterBar,'종료일','input','date'),query=labeled(filterBar,'작성자 또는 내용');
 query.maxLength=120;
 const searchButton=element('button','검색','button');searchButton.type='submit';filterBar.append(searchButton);
 const formBar=element('div','','dwl-fields');
 form.append(element('h3','일지 작성'),formBar);
 const date=labeled(formBar,'작성일','input','date');date.value=today();date.required=true;date.min='2000-01-01';date.max='2100-12-31';
 const shifts=element('fieldset','','dwl-shifts');shifts.append(element('legend','근무 시간대'));formBar.append(shifts);
 const morning=labeled(shifts,'오전','input','checkbox'),afternoon=labeled(shifts,'오후','input','checkbox');
 const fields=Object.fromEntries(specs.map(([k,label])=>{const n=labeled(form,label,'textarea');n.rows=k==='work_done'?5:3;n.maxLength=8000;return [k,n];}));
 const schedulePanel=element('fieldset','','dwl-import');schedulePanel.hidden=true;
 const schedulesButton=btn(form,'업무수첩 일정 가져오기',()=>void loadSchedules());
 form.append(schedulePanel);
 let scheduleSeq=0,candidates=[],selected=new Set(),confirmed=[],loadingSchedules=false;
 const timeFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'2-digit'});
 function resetSchedules(){
  scheduleSeq++;candidates=[];selected.clear();confirmed=[];loadingSchedules=false;state.scheduleEdits=false;
  schedulePanel.hidden=true;schedulePanel.replaceChildren();
 }
 function renderSchedules(preview=false){
  schedulePanel.replaceChildren(element('legend',preview?'업무 내용에 추가할 일정':'수행한 일정 선택'));
  const actions=element('div','','dwl-actions');
  if(preview){
   const items=element('ul');
   for(const row of candidates.filter(row=>selected.has(row.id)))items.append(element('li',row.title));
   schedulePanel.append(items,element('p','아래에서 일지를 저장하면 기존 업무 내용 끝에 추가됩니다.','dwl-help'));
   btn(actions,'선택 변경',()=>{confirmed=[];renderSchedules();});
  }else{
   schedulePanel.append(element('p','실제로 수행한 업무만 선택하세요.','dwl-help'));
   if(!candidates.length)schedulePanel.append(element('p','가져올 일정이 없습니다.','dwl-help'));
   for(const row of candidates){
    const label=element('label','','dwl-import-option'),checkbox=element('input');
    checkbox.type='checkbox';checkbox.checked=selected.has(row.id);
    checkbox.addEventListener('change',()=>{
     if(checkbox.checked&&selected.size>=100){checkbox.checked=false;report('한 번에 일정 100개까지 선택할 수 있습니다.',true);return;}
     if(checkbox.checked)selected.add(row.id);else selected.delete(row.id);
     state.scheduleEdits=!!selected.size;previewButton.disabled=!selected.size;update();
    });
    label.append(checkbox,element('span',(row.all_day?'종일':timeFormat.format(new Date(row.starts_at)))+' · '+row.title));schedulePanel.append(label);
   }
   const previewButton=btn(actions,'선택 일정 미리보기',()=>{
    confirmed=candidates.filter(row=>selected.has(row.id));
    renderSchedules(true);
   });
   previewButton.disabled=!selected.size;
  }
  btn(actions,'일정 선택 취소',()=>{resetSchedules();update();});
  schedulePanel.append(actions);schedulePanel.hidden=false;
 }
 async function loadSchedules(){
  if(!valid()||saving||loadingSchedules||current?.can_edit===false)return;
  if(!date.checkValidity()){date.reportValidity();return;}
  resetSchedules();const seq=scheduleSeq;loadingSchedules=true;update();
  try{
   const rows=await window.TaejangApp.rpc('list_daily_work_report_schedules',{p_date:date.value});
   if(!valid()||seq!==scheduleSeq)return;
   candidates=rows;renderSchedules();
  }catch(error){
   if(valid()&&seq===scheduleSeq)report(/PGRST202/.test(String(error?.code??error?.message??error))?'일정 가져오기를 준비 중입니다.':'일정을 불러오지 못했습니다. 다시 시도해 주세요.',true);
  }finally{if(valid()&&seq===scheduleSeq){loadingSchedules=false;update();}}
 }
 form.append(element('p',safety,'dwl-safety'));
 const controls=element('div','','dwl-actions');
 const save=element('button','일지 저장','button primary');save.type='submit';controls.append(save);
 const clear=btn(controls,'새 일지',()=>{if(!saving&&valid()&&canLeave())show(null);});
 const word=btn(controls,'Word 다운로드',async()=>{
  if(!valid()||!current||state.dirty||state.scheduleEdits)return;
  const saved=current;
  try {
   if(!window.JSZip)await import('./vendor/jszip-3.10.1.min.js');
   const blob=await makeWorkReportWord(saved,window.JSZip);
   if(!valid()||saved!==current||state.dirty||state.scheduleEdits)return;
   const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=workReportFilename(saved)+'.docx';
   document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch{report('Word 파일을 만들지 못했습니다. 다시 시도해 주세요.',true);}
 });
 function printCurrent(){
  if(!valid()||!current||state.dirty||state.scheduleEdits)return;stopPrint?.();cleanPrint();
  const view=element('div','','dwl');view.id='daily-work-print';view.append(reportDocument(current));document.body.append(view);
  try {stopPrint=printErpPdf(workReportFilename(current),undefined,()=>{cleanPrint();stopPrint=null;});}
  catch{cleanPrint();report('PDF 인쇄창을 열지 못했습니다.',true);}
 }
 const pdf=btn(controls,'PDF 저장 / 인쇄',printCurrent);
 const saveAndPrint=element('button','저장 후 인쇄','button');saveAndPrint.type='submit';controls.append(saveAndPrint);
 form.append(controls);root.append(form,filters);
 function canLeave(){return (!state.dirty&&!state.scheduleEdits)||window.confirm('저장하지 않은 수정 내용을 버릴까요?');}
 function update(){
  const edit=!current||current.can_edit===true;
  for(const n of [date,morning,afternoon,...Object.values(fields)])n.disabled=saving||!edit||(n===date&&revision>0);
  schedulesButton.disabled=saving||loadingSchedules||!edit;schedulePanel.disabled=saving;
  save.disabled=saving||loadingSchedules||!edit;saveAndPrint.disabled=save.disabled;clear.disabled=saving;word.disabled=!current||state.dirty||state.scheduleEdits||saving;pdf.disabled=word.disabled;
 }
 function show(row){
  resetSchedules();current=row;revision=row?.revision??0;date.value=row?.work_date??today();
  morning.checked=!!row?.morning;afternoon.checked=!!row?.afternoon;
  for(const [k,n] of Object.entries(fields))n.value=row?.[k]??'';
  state.dirty=false;update();
  report(row?'기록 No. '+row.id+' · '+row.author_name+(row.can_edit?'':' · 읽기 전용'):'');
 }
 date.addEventListener('input',resetSchedules);
 form.addEventListener('input',e=>{if(!schedulePanel.contains(e.target)){state.dirty=true;update();}});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(!valid()||saving||loadingSchedules||current?.can_edit===false)return;
  if(!morning.checked&&!afternoon.checked){report('오전 또는 오후를 하나 이상 선택하세요.',true);morning.focus();return;}
  if(selected.size&&!confirmed.length){report('선택한 일정을 미리보기에서 확인해 주세요.',true);return;}
  if(!fields.work_done.value.trim()&&!confirmed.length){report('오늘의 업무 내용을 입력하세요.',true);fields.work_done.focus();return;}
  const payload={p_date:date.value,p_morning:morning.checked,p_afternoon:afternoon.checked,p_work:fields.work_done.value,p_staff:fields.staff_notes.value,p_other:fields.other_notes.value,p_revision:revision};
  const afterSavePrint=e.submitter===saveAndPrint;
  saving=true;update();
  try{
   const saved=confirmed.length
    ?await window.TaejangApp.rpc('save_daily_work_report_with_schedules',{
      ...payload,p_schedules:confirmed.map(({id,updated_at})=>({id,updated_at}))})
    :await window.TaejangApp.rpc('save_daily_work_report',payload);
   if(!valid())return;show(saved);report('일지를 저장했습니다. 기록 No. '+saved.id);
   if(afterSavePrint)printCurrent();
   void search(0,false);
  }catch(error){
   if(!valid())return;
   const message=String(error?.message??error);
   if(message.includes('DAILY_WORK_SCHEDULE_CHANGED')){
    resetSchedules();report('선택한 일정이 변경됐습니다. 일정을 다시 불러와 확인해 주세요.',true);
   }else if(message.includes('DAILY_WORK_CONFLICT')){
    report('같은 날짜에 저장된 일지가 있거나 내용이 바뀌었습니다. 입력 내용을 복사한 뒤 검색에서 저장된 일지를 확인하세요.',true);
   }else if(message.includes('DAILY_WORK_INVALID')){
    report('날짜와 근무 시간대, 내용 길이를 확인해 주세요. 각 내용란은 8,000자까지 저장할 수 있습니다.',true);
   }else report('일지를 저장하지 못했습니다. 입력은 그대로 두었습니다.',true);
  }
  finally{if(valid()){saving=false;update();}}
 });
 async function search(next,announce=true){
  if(!valid())return;
  if(from.value&&to.value&&from.value>to.value){report('종료일은 시작일 이후로 선택하세요.',true);return;}
  const seq=++searchSeq;list.setAttribute('aria-busy','true');
  try {
   const rows=await window.TaejangApp.rpc('search_daily_work_reports',{p_from:from.value||null,p_to:to.value||null,p_query:query.value.trim(),p_page:next});
   if(!valid()||seq!==searchSeq)return;
   page=next;list.replaceChildren();
   if(!rows.length)list.append(element('p','조회된 일지가 없습니다.','dwl-help'));
   for(const row of rows.slice(0,50)){
    const line=element('div','','dwl-result'),match=element('div');
    match.append(element('strong',row.work_date+' · '+row.author_name),element('p',row.work_done.slice(0,110),'dwl-help'));
    const open=btn(line,row.can_edit?'열기 / 수정':'보기',()=>{if(!saving&&valid()&&canLeave()){show(row);date.scrollIntoView({block:'nearest'});}});
    open.setAttribute('aria-label',(row.can_edit?'열기 / 수정 ':'보기 ')+row.work_date+' '+row.author_name);line.prepend(match);list.append(line);
   }
   const pages=element('div','','dwl-actions');list.append(pages);
   if(page)btn(pages,'이전',()=>void search(page-1));
   if(rows.length>50&&page<1000)btn(pages,'다음',()=>void search(page+1));
   if(announce)report('조회했습니다.');
  }catch{if(valid()&&seq===searchSeq){list.replaceChildren();list.append(element('p','일지 목록을 가져오지 못했습니다. 다시 검색해 주세요.','dwl-help'));}}
  finally{if(valid()&&seq===searchSeq)list.removeAttribute('aria-busy');}
 }
 filters.addEventListener('submit',e=>{e.preventDefault();void search(0);});
 update();void search(0,false);
}
function revoke(){
 if(active?.root.isConnected){
  if(!actor()||actor()?.token!==active.token){
   active.root.replaceChildren(element('p','업무일지 접근 권한이 변경되었습니다. 메뉴를 다시 열어 주세요.'));active=null;
   stopPrint?.();cleanPrint();
  }
 }else if(!actor()){stopPrint?.();cleanPrint();}
}
if(typeof document!=='undefined')for(const event of ['taejang-app-ready','taejang-capabilities-changed','taejang-menu-authority-changed'])document.addEventListener(event,revoke);
