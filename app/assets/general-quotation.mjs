import {printErpPdf, erpDocumentName} from './erp-pdf.mjs';
import {calculateQuotation, quotationHtml, TAX_MODES, MAX_QUOTE_ITEMS} from './general-quotation-document.mjs';

const money=new Intl.NumberFormat('ko-KR');
const dayInSeoul=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
const defaultSupplier={
  supplier:'농업회사법인 태장 주식회사',businessNumber:'157-86-03535',representative:'이영희',
  address:'경남 창원시 의창구 평산로 33, 신화 더 플렉스시티 422·423호'
};
const allowed=()=>{
  const app=window.TaejangApp;
  const sales=app?.hasCapabilityContract?.() && app.can?.('erp_sales.read')===true;
  return !!sales && (window.TaejangMenuAuthority?.allowed('erp_sales.manage',sales) ?? sales);
};

function el(tag,text='',className=''){
  const node=document.createElement(tag);
  node.textContent=text;
  if(className)node.className=className;
  return node;
}
function button(label,action,primary=false){
  const node=el('button',label,primary?'button primary':'button secondary');
  node.type='button';
  node.addEventListener('click',action);
  return node;
}
function field(parent,label,key,{type='text',value='',maxLength=120,min,max,step,options,required=false}={}){
  const entry=el(options?'select':type==='textarea'?'textarea':'input');
  entry.name=key;
  entry.required=required;
  if(options)for(const [code,name] of Object.entries(options))entry.append(new Option(name,code));
  else if(type!=='textarea')entry.type=type;
  if(type==='text'||type==='textarea')entry.maxLength=maxLength;
  if(type==='number'){
    entry.min=String(min);
    entry.max=String(max);
    entry.step=String(step);
  }
  if(type==='textarea')entry.rows=3;
  entry.value=value;
  const wrap=el('label',label,'gq-field');
  wrap.append(entry);parent.append(wrap);
  return entry;
}
function card(title,parent){
  const section=el('section','','platform-settings-card gq-card');
  const grid=el('div','','gq-fields');
  section.append(el('h3',title),grid);
  parent.append(section);
  return grid;
}
function style(){
  if(document.querySelector('link[data-general-quotation]'))return;
  const link=el('link');
  link.rel='stylesheet';
  link.href=new URL('./general-quotation.css',import.meta.url).href;
  link.dataset.generalQuotation='1';
  document.head.append(link);
}
async function downloadExcel(quote){
  const [{quotationXlsx}]=await Promise.all([
    import('./general-quotation-xlsx.mjs'),
    window.JSZip ? Promise.resolve() : import('./vendor/jszip-3.10.1.min.js')
  ]);
  if(!allowed())throw new Error('견적서를 출력할 권한을 확인해 주세요.');
  const data=await quotationXlsx(quote,window.JSZip);
  if(!allowed())throw new Error('견적서를 출력할 권한을 확인해 주세요.');
  const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor=el('a');
  anchor.href=url;
  anchor.download=erpDocumentName(quote.customer,quote.date)+'.xlsx';
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function mountGeneralQuotation(host){
  if(!allowed())throw new Error('GENERAL_QUOTATION_FORBIDDEN');
  style();
  const form=el('form','','app-authoring general-quotation');
  const heading=el('h2','공용 견적서');
  const meta=card('견적 정보',form);
  const customer=field(meta,'거래처','customer',{required:true});
  field(meta,'건명','subject');
  field(meta,'견적일','date',{type:'date',value:dayInSeoul(),required:true});
  field(meta,'유효기간','validity',{value:'견적일로부터 30일'});
  field(meta,'결제 조건','payment');
  field(meta,'부가세 기준','taxMode',{options:TAX_MODES,value:'included'});
  const itemCard=el('section','','platform-settings-card gq-card');
  const items=el('div','','gq-items');
  const add=button('+ 품목 추가',()=>addItem(true));
  add.classList.add('gq-add-item');
  itemCard.append(el('h3','품목'),items,add);
  form.append(itemCard);
  const details=el('details','','platform-settings-card gq-card');
  details.append(el('summary','공급자 정보 · 배송·입금 안내'));
  const supplierFields=el('div','','gq-fields');
  field(supplierFields,'공급자 상호','supplier',{value:defaultSupplier.supplier,required:true});
  field(supplierFields,'사업자등록번호','businessNumber',{value:defaultSupplier.businessNumber});
  field(supplierFields,'대표자','representative',{value:defaultSupplier.representative});
  field(supplierFields,'담당자·연락처','contact');
  field(supplierFields,'주소','address',{value:defaultSupplier.address,maxLength:200});
  field(supplierFields,'입금 계좌','bank',{maxLength:180});
  field(supplierFields,'배송·기타사항','notes',{type:'textarea',maxLength:500}).parentElement.classList.add('gq-full');
  details.append(supplierFields);form.append(details);
  const amountFields=card('견적 금액',form);
  const discount=field(amountFields,'할인·절사 (원)','discount',{type:'number',value:'0',min:0,max:1000000000000,step:1});
  discount.parentElement.classList.add('gq-discount');
  const amounts=el('dl','','gq-totals');
  const totals={};
  for(const [key,label] of [['subtotal','품목 합계'],['supply','공급가액'],['vat','부가세'],['total','합계금액']]){
    const block=el('div');
    totals[key]=el('dd','—');
    block.append(el('dt',label),totals[key]);
    amounts.append(block);
  }
  amountFields.append(amounts);
  const status=el('p','','message');
  status.setAttribute('role','status');
  status.hidden=true;
  function report(message){
    status.textContent=message;
    status.hidden=!message;
  }
  function snapshot(){
    const data=Object.fromEntries(new FormData(form));
    data.items=Array.from(items.children, row=>Object.fromEntries(
      Array.from(row.querySelectorAll('[data-item-field]'),input=>[input.dataset.itemField,input.value.trim()])));
    return calculateQuotation(data);
  }
  function refresh(){
    add.disabled=items.childElementCount>=MAX_QUOTE_ITEMS;
    report('');
    let quote;
    try{quote=snapshot();}catch{}
    for(const [key,output] of Object.entries(totals))output.textContent=quote?money.format(quote[key])+'원':'—';
  }
  function addItem(focus=false){
    if(items.childElementCount>=MAX_QUOTE_ITEMS)return;
    const row=el('div','','gq-item');
    const name=field(row,'품명','name');
    field(row,'규격·모델','spec');
    field(row,'단위','unit',{maxLength:12});
    field(row,'수량','quantity',{type:'number',value:'1',min:0.001,max:1000000,step:0.001});
    field(row,'단가 (원)','unitPrice',{type:'number',min:0,max:1000000000,step:1});
    field(row,'비고','memo');
    for(const input of row.querySelectorAll('input')){
      input.dataset.itemField=input.name;
      input.removeAttribute('name');
    }
    const remove=button('삭제',()=>{
      const next=row.nextElementSibling||row.previousElementSibling;
      row.remove();
      if(!items.childElementCount)addItem(true);
      else next.querySelector('input')?.focus();
      refresh();
    });
    remove.setAttribute('aria-label','품목 행 삭제');
    row.append(remove);items.append(row);
    if(focus)name.focus();
    refresh();
  }
  function exportFromForm(action){
    if(!allowed()){report('견적서를 출력할 권한을 확인해 주세요.');return;}
    if(!form.checkValidity()){
      const invalid=form.querySelector(':invalid');
      const collapsed=invalid?.closest('details');
      if(collapsed)collapsed.open=true;
      form.reportValidity();
      return;
    }
    let quote;
    try{quote=snapshot();}catch(error){report(error.message);return;}
    report('');
    action(quote);
  }
  function excel(quote,control,onError=report){
    control.disabled=true;
    void downloadExcel(quote).catch(()=>onError('엑셀 파일을 만들지 못했습니다. 입력은 유지했습니다. 다시 시도해 주세요.'))
      .finally(()=>{control.disabled=false;});
  }
  function preview(quote){
    const opener=document.activeElement;
    const modal=el('dialog','','gq-preview');
    const title=el('h3','견적서 미리보기');
    title.id='gq-preview-title';modal.setAttribute('aria-labelledby',title.id);
    const frame=el('iframe');
    frame.title='견적서 인쇄 미리보기';
    frame.setAttribute('sandbox','allow-same-origin allow-modals');
    const actions=el('div','','gq-actions');
    const feedback=el('p','','message');
    feedback.setAttribute('role','status');
    feedback.hidden=true;
    const show=message=>{feedback.textContent=message;feedback.hidden=false;};
    const print=button('인쇄 · PDF로 저장',()=>{
      if(!allowed()){show('견적서를 출력할 권한을 확인해 주세요.');return;}
      try{printErpPdf(quote.customer,quote.date,undefined,frame.contentWindow);}
      catch{show('인쇄창을 열지 못했습니다. 다시 시도해 주세요.');}
    },true);
    print.disabled=true;
    frame.addEventListener('load',()=>{print.disabled=!frame.contentDocument?.querySelector('table');});
    frame.srcdoc=quotationHtml(quote);
    const download=button('엑셀 다운로드',()=>excel(quote,download,show));
    actions.append(print,download,button('닫기',()=>modal.close()));
    modal.append(title,actions,feedback,frame);form.append(modal);
    modal.addEventListener('close',()=>{modal.remove();opener?.focus();},{once:true});
    modal.showModal();
  }
  const actions=el('div','','gq-actions');
  const download=button('엑셀 다운로드',()=>exportFromForm(quote=>excel(quote,download)));
  actions.append(button('견적서 미리보기',()=>exportFromForm(preview),true),download,
    button('새 견적서',()=>{if(window.confirm('현재 입력을 비우고 새 견적서를 작성할까요?'))mountGeneralQuotation(host);}));
  form.append(status,actions);
  form.addEventListener('input',refresh);
  form.addEventListener('submit',event=>{event.preventDefault();exportFromForm(preview);});
  host.replaceChildren(heading,form);
  addItem();
  customer.focus();
}
