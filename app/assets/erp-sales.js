/* ERP V1 uses the existing shell, authoring styles and server-owned RPC permissions. */
(() => {
 'use strict';
 const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
 const money=v=>Number(v||0).toLocaleString('ko-KR')+'원';
 const taxChoices=[['taxable','과세 (세액 직접 입력)'],['exempt','면세'],['zero_rated','영세율']];
 const kinds={product:'상품',service:'용역',material:'원재료',packaging:'포장재',company:'기업',individual:'개인',draft:'작성 중',confirmed:'확정',active:'진행 중',ended:'종료',preparing:'배송 준비',shipped:'발송',delivered:'배송 완료',acquisition:'확보',management:'담당',support:'지원'};
 const allowed=()=>{const a=window.TaejangApp;return a?.hasCapabilityContract?.()&&a.can?.('erp_sales.read')&&a.getActualRoles?.().includes('operations_manager')&&a.getEffectiveRoles?.().includes('operations_manager')&&!a.getAccessContext?.()?.role_simulation?.active;};
 let root,status,body,editor,state,phase2=false,phase3=false,phase4=false,payoutQueue=false,adjustmentQueue=false,contractMonthLookup=false,tab='parties',busy=false,epoch=0;
 let contractPeriod='all',adjustmentKind='';
 const payoutFilters={kind:'',overdue:false};
 const receivableFilters={party:'',from:'',to:''};
 const purchaseRange={from:today().slice(0,7)+'-01',to:today()};
 let closeMonth=today().slice(0,7);
 const filters={from:today().slice(0,7)+'-01',to:today(),party:'',kind:'',status:'',agent:''};
 const report=(message,error=false)=>{if(!root?.isConnected)return;status.textContent=message;status.className=error?'message error':'message';status.hidden=!message;};
 function errorText(error){const m=String(error?.message||error);if(/PGRST202|does not exist|404/.test(m))return '이 환경은 매출 기능의 데이터 준비가 완료되지 않았습니다. 담당자에게 확인해 주세요.';
  if(/23505|duplicate|unique/.test(m))return '이미 등록된 정보입니다. 기존 거래처·품목 또는 계약 월 매출을 확인해 주세요.';
  const codes={ERP_INVALID_MONTH:'조회할 매출 월을 확인해 주세요.',ERP_ADJUSTMENT_CANCELLED_PAYOUT:'취소가 승인된 거래에서는 새 지급을 승인하거나 완료할 수 없습니다.',ERP_PERIOD_CLOSED:'마감된 월입니다. 다른 기록일을 선택하거나 마감 상태를 확인해 주세요.',ERP_ADJUSTMENT_INVALID_INPUT:'조정 사유와 입력값을 확인해 주세요.',ERP_ADJUSTMENT_SHIPPING_STATE:'현재 배송 상태에서는 이 취소·반품을 처리할 수 없습니다.',ERP_ADJUSTMENT_DUPLICATE:'같은 거래에서 이미 처리한 취소·반품 또는 결정이 있습니다.',ERP_ADJUSTMENT_CREDIT_LIMIT:'반품 승인액은 남은 매출액 이내의 원 단위 금액으로 입력해 주세요.',ERP_RECEIPT_REVERSAL_REFUNDED:'환불 처리 후 남은 순수금보다 큰 입금은 취소할 수 없습니다.',ERP_ADJUSTMENT_QUANTITY:'반품 수량이 남은 주문 수량을 초과합니다.',ERP_ADJUSTMENT_REFUND_LIMIT:'환불 금액이 승인액이나 실제 입금액을 초과합니다.',ERP_ADJUSTMENT_APPROVAL_REQUIRED:'운영총괄 승인 후 실제 처리 내역을 기록해 주세요.',ERP_SUPPORT_INVALID_INPUT:'거래 날짜, 금액과 입력값을 확인해 주세요.',ERP_STOCK_ITEM_REQUIRED:'사용 중인 재고관리 품목을 선택해 주세요.',ERP_STOCK_INSUFFICIENT:'입력한 날짜부터 재고가 부족해지는 날이 있습니다. 수량과 날짜를 확인해 주세요.',ERP_PAYOUT_INVALID_INPUT:'지급 금액, 날짜와 증빙 확인 내용을 검토해 주세요.',ERP_PAYOUT_BASIS_REQUIRED:'거래의 전체 지급액을 먼저 입력해 주세요.',ERP_PAYOUT_BASIS_CONFLICT:'이미 승인한 전체 지급액 또는 지급 주기와 일치해야 합니다.',ERP_PAYOUT_OVER_LIMIT:'고객 수금액과 기존 지급·승인을 확인해 주세요. 현재 지급 가능액을 초과합니다.',ERP_PAYOUT_ALREADY_FINISHED:'이미 처리한 지급 건입니다.',ERP_RECEIPT_INVALID_RULE:'당월 또는 익월과 수금일 1~31일을 선택해 주세요.',ERP_CONTRACT_NOT_FOUND:'용역 계약을 찾을 수 없습니다.',ERP_RECEIPT_INVALID_DUE_ON:'수금 예정일을 확인해 주세요.',ERP_RECEIPT_INVALID_DUE_RANGE:'예정일의 시작일과 종료일을 확인해 주세요.',ERP_RECEIPT_CONFIRMED_REQUIRED:'확정 매출에만 수금을 기록할 수 있습니다.',ERP_RECEIPT_INVALID_INPUT:'입금일·정정일, 원 단위 금액, 취소 사유를 확인해 주세요.',ERP_RECEIPT_INVALID_REVERSAL:'취소할 입금과 정정일을 확인해 주세요.',ERP_RECEIPT_ALREADY_REVERSED:'이미 취소된 입금입니다. 수금 내역을 다시 열어 주세요.',ERP_RECEIPT_OVER_BALANCE:'입금액이 미수 잔액을 초과합니다. 수금 내역을 다시 열어 잔액을 확인해 주세요.',ERP_FORBIDDEN:'이 기능을 사용할 권한이 없습니다.',ERP_REVISION_CONFLICT:'다른 화면에서 변경되었습니다. 입력을 보존했습니다. 새로 조회한 뒤 비교해 주세요.',ERP_SALE_CONFIRMED:'이미 확정된 거래는 원본을 수정할 수 없습니다.',ERP_AGENT_RELATION_REQUIRED:'매출일에 유효한 거래처·영업자 관계를 먼저 등록해 주세요.',ERP_INVALID_COMMISSION:'영업자와 거래별 영업비 조건을 확인해 주세요.',ERP_INVALID_CONTRACT_MONTH:'계약 기간과 매출 월을 확인해 주세요.',ERP_CONTRACT_NOT_ACTIVE:'진행 중인 계약과 해당 월을 확인해 주세요.',ERP_REQUEST_REUSE:'같은 저장 요청으로 이미 다른 내용이 저장되었습니다. 입력은 보존되니 매출 목록에서 기존 거래를 먼저 확인해 주세요.',ERP_INVALID_PERIOD:'조회 기간은 1년 이내로 지정해 주세요.'};
  return Object.entries(codes).find(([c])=>m.includes(c))?.[1]||'저장하지 못했습니다. 입력값과 연결 정보를 확인한 뒤 다시 시도해 주세요.';
 }
 async function rpc(name,data={}){const generation=epoch;if(!allowed())throw new Error('ERP_FORBIDDEN');const result=await window.TaejangApp.rpc(name,data);if(generation!==epoch||!allowed()||!root?.isConnected)throw new Error('ERP_FORBIDDEN');return result;}
 async function run(action){if(busy)return;busy=true;const focused=document.activeElement;root.inert=true;const controls=[...root.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);root.setAttribute('aria-busy','true');try{await action();}catch(e){report(errorText(e),true);}finally{busy=false;if(root)root.inert=false;root?.removeAttribute('aria-busy');controls.forEach(([n,d])=>{if(n.isConnected)n.disabled=d;});if(allowed()&&root?.isConnected){const next=focused?.isConnected?focused:status;if(next?.isConnected)next.focus({preventScroll:true});}}}
 const btn=(text,fn,primary=false)=>{const n=el('button',text,'button'+(primary?' primary':''));n.type='button';n.addEventListener('click',()=>{if(!busy)fn();});return n;};
 function field(form,name,label,type='text',value='',choices=[],required=false){const wrap=el('label');wrap.append(el('span',label));const n=el(type==='select'?'select':type==='textarea'?'textarea':'input');n.name=name;if(n.tagName==='INPUT')n.type=type;
  if(type==='select')choices.forEach(([v,t])=>{const o=el('option',t);o.value=v;n.append(o);});
  if(type==='checkbox'){n.checked=Boolean(value);n.value='true';}else n.value=value??'';
  n.required=required;if(type==='number'){n.min='0';n.step='0.01';}wrap.append(n);form.append(wrap);return n;
 }
 function options(key,predicate=()=>true){return [['','선택해 주세요'],...(state[key]||[]).filter(predicate).map(r=>[r.id,(r.code?r.code+' · ':'')+(r.name||r.title)])];}
 const labelFor=(key,id)=>state[key]?.find(r=>r.id===id)?.name||state[key]?.find(r=>r.id===id)?.title||'—';
 function table(headers,rows){const wrap=el('div','','erp-table-wrap');const t=el('table');const head=el('thead'),tr=el('tr');headers.forEach(h=>tr.append(el('th',h)));head.append(tr);t.append(head);const tb=el('tbody');rows.forEach(values=>{const row=el('tr');values.forEach(v=>{const cell=el('td');cell.append(v instanceof Node?v:document.createTextNode(String(v??'—')));row.append(cell);});tb.append(row);});t.append(tb);wrap.append(t);return wrap;}
 function clearEditor(){if(editor.querySelector('form[data-dirty="true"]')&&!window.confirm('저장하지 않은 입력이 있습니다. 닫을까요?'))return false;editor.replaceChildren();return true;}
 function formStart(title){if(!clearEditor())return null;const f=el('form','','app-authoring');f.append(el('h3',title));const grid=el('fieldset','','erp-fields');grid.disabled=!state.canWrite;const legend=el('legend','입력 정보','sr-only');grid.append(legend);f.append(grid);f.addEventListener('input',()=>f.dataset.dirty='true');editor.append(f);return {f,grid};}
 function masterEditor(kind,row={}){
  const names={party:'거래처',agent:'영업자',item:'품목·서비스',contract:'용역 계약'};const parts=formStart((row.id?'수정: ':'등록: ')+names[kind]);if(!parts)return;const {f,grid}=parts;
  const add=(n,l,t='text',v=row[n]??'',c=[],req=false)=>field(grid,n,l,t,v,c,req);
  if(kind==='party'){
   add('name','거래처명','text',row.name||'',[],true);const type=add('kind','개인·기업','select',row.kind||'company',[['company','기업'],['individual','개인']],true);
   const business=add('business_number','사업자등록번호 (기업 10자리)','text',row.business_number||'',[],true);const sync=()=>{business.closest('label').hidden=type.value==='individual';business.required=type.value==='company';};type.addEventListener('change',sync);sync();
   add('phone','연락처','tel');add('contact_name','거래 담당자');
   for(const [code,label] of [['customer','고객'],['supplier','공급처'],['sales_contact','영업 관계']]){const n=add('relationships',label,'checkbox',row.relationships?.includes(code)??code==='customer');n.value=code;}
   if(state.documentCompanies.length)add('document_company_id','기존 거래처 문서 연결','select',row.document_company_id||'',[['','연결 안 함'],...state.documentCompanies.map(r=>[r.id,r.name])]);
   add('memo','거래 메모','textarea');
  }else if(kind==='agent'){add('name','영업자명','text',row.name||'',[],true);add('phone','연락처','tel');add('memo','메모','textarea');
  }else if(kind==='item'){
   add('code','품목코드','text',row.code||'',[],true);add('name','품목·서비스명','text',row.name||'',[],true);
   add('kind','유형','select',row.kind||'product',Object.entries(kinds).filter(([k])=>['product','service','material','packaging'].includes(k)),true);
   add('unit','단위','text',row.unit||'',[],true);add('base_price','기준 공급단가 (선택)','number');add('tax_class','세금 구분','select',row.tax_class||'taxable',taxChoices,true);add('inventory_managed','재고관리 대상 표시','checkbox',row.inventory_managed||false);
   f.append(el('p','기준 단가 변경은 과거 거래에 적용되지 않습니다. 입출고·재고 계산은 후속 단계입니다.','help'));
  }else{
   add('title','계약명','text',row.title||'',[],true);add('party_id','계약 거래처','select',row.party_id||'',options('parties',p=>p.active&&p.relationships.includes('customer')),true);
   add('item_id','용역 품목','select',row.item_id||'',options('items',i=>i.active&&i.kind==='service'),true);
   add('starts_on','계약 시작일','date',row.starts_on||today(),[],true);add('ends_on','계약 종료일','date',row.ends_on||'',[],true);
   add('monthly_supply','월 공급가액 (원)','number',row.monthly_supply??0,[],true).step='1';add('monthly_tax','월 부가세 (직접 입력, 원)','number',row.monthly_tax??0,[],true).step='1';
   add('tax_class','세금 구분','select',row.tax_class||'taxable',taxChoices,true);add('billing_basis','청구 기준 (예: 매월 말일, 익월 10일)','text',row.billing_basis||'',[],true);
   add('status','계약 상태','select',row.status||'draft',[['draft','작성 중'],['active','진행 중'],['ended','종료']],true);add('memo','메모','textarea');
   f.append(el('p','거래처와 용역 품목을 먼저 등록하세요. 월 매출은 계약에서 해당 월을 선택해 생성합니다. 부분 월의 일할 계산은 자동으로 하지 않습니다.','help'));
  }
  if(kind!=='contract')add('active','사용 중 (해제하면 중단)','checkbox',row.active??true);
  const actions=el('div','','erp-actions');if(state.canWrite){const save=el('button','저장','button primary');save.type='submit';actions.append(save);}actions.append(btn('닫기',clearEditor));f.append(actions);
  f.addEventListener('submit',event=>{event.preventDefault();if(!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));
   if(kind==='party'){d.relationships=new FormData(f).getAll('relationships');if(!d.relationships.length){report('고객·공급처·영업 관계 중 하나 이상 선택해 주세요.',true);return;}if(d.kind==='individual')d.business_number=null;}
   if(kind!=='contract')d.active=f.elements.active.checked;if(kind==='item')d.inventory_managed=f.elements.inventory_managed.checked;
   void run(async()=>{await rpc('erp_sales_save_master',{p_kind:kind,p_data:d,p_id:row.id||null,p_revision:row.revision||0});state=await rpc('erp_sales_bootstrap');f.dataset.dirty='false';editor.replaceChildren();draw();report('저장했습니다.');});
  });f.querySelector('input,select')?.focus();
 }
 function assignmentEditor(){const parts=formStart('영업 관계 연결·담당자 변경');if(!parts)return;const {f,grid}=parts;
  field(grid,'party_id','거래처','select','',options('parties',r=>r.active),true);field(grid,'agent_id','영업자','select','',options('agents',r=>r.active),true);
  field(grid,'relationship','관계','select','management',[['management','담당 (기존 담당 관계 종료 후 변경)'],['acquisition','확보'],['support','지원']],true);
  field(grid,'starts_on','관계 시작일','date',today(),[],true);field(grid,'reason','연결·변경 사유','text','',[],true);
  f.append(el('p','과거 거래의 영업자와 영업비 조건은 바뀌지 않습니다. 같은 거래처에 확보·담당·지원 관계를 함께 연결할 수 있습니다.','help'));
  const save=el('button','관계 저장','button primary');save.type='submit';f.append(save,btn('닫기',clearEditor));f.addEventListener('submit',e=>{e.preventDefault();if(!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));void run(async()=>{await rpc('erp_sales_assign_agent',{p_party_id:d.party_id,p_agent_id:d.agent_id,p_relationship:d.relationship,p_starts_on:d.starts_on,p_reason:d.reason});state=await rpc('erp_sales_bootstrap');f.dataset.dirty='false';editor.replaceChildren();draw();report('영업 관계를 저장했습니다.');});});
 }
 function drawMasters(){const actions=el('div','','erp-actions');if(state.canWrite){actions.append(btn('거래처 등록',()=>masterEditor('party')),btn('영업자 등록',()=>masterEditor('agent')),btn('영업 관계 연결',assignmentEditor));}body.append(actions);
  body.append(el('h3','거래처'),table(['거래처','구분','거래 관계','상태','문서 연결',''],state.parties.map(r=>[r.name,kinds[r.kind],r.relationships.map(x=>({customer:'고객',supplier:'공급처',sales_contact:'영업 관계'})[x]).join(' · '),r.active?'활성':'중단',state.documentCompanies.find(x=>x.id===r.document_company_id)?.name||'—',btn(state.canWrite?'수정':'보기',()=>masterEditor('party',r))])));
  body.append(el('h3','영업자'),table(['영업자','연락처','상태',''],state.agents.map(r=>[r.name,r.phone,r.active?'활성':'중단',btn(state.canWrite?'수정':'보기',()=>masterEditor('agent',r))])));
  const history=el('details');history.append(el('summary',`영업 관계 이력 ${state.assignments.length}건`),table(['거래처','영업자','관계','시작일','종료일 (미포함)','사유'],state.assignments.map(r=>[labelFor('parties',r.party_id),labelFor('agents',r.agent_id),kinds[r.relationship],r.starts_on,r.ends_on||'현재',r.reason])));body.append(history);
 }
 function drawItems(){if(state.canWrite)body.append(btn('품목·서비스 등록',()=>masterEditor('item'),true));body.append(table(['코드','품목·서비스','유형','단위','기준 공급단가','재고 대상','상태',''],state.items.map(r=>[r.code,r.name,kinds[r.kind],r.unit,r.base_price===null?'—':money(r.base_price),r.inventory_managed?'표시됨':'아니오',r.active?'사용':'중단',btn(state.canWrite?'수정':'보기',()=>masterEditor('item',r))])));}
 function drawContracts(){
  const asOf=today();
  const cutoff=new Date(asOf+'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate()+30);
  const through=cutoff.toISOString().slice(0,10);
  const nearEnd=contract=>contract.status==='active'&&contract.ends_on>=asOf&&contract.ends_on<=through;
  const pastEnd=contract=>contract.status==='active'&&contract.ends_on<asOf;
  const contracts=state.contracts.filter(contract=>contractPeriod==='all'||
   (contractPeriod==='expiring'?nearEnd(contract):pastEnd(contract)));
  const controls=el('div','','erp-fields');
  const period=field(controls,'contract_period_filter','계약 종료일','select',contractPeriod,
   [['all','전체 계약'],['expiring','30일 이내 종료'],['expired','기간이 지난 진행중 계약']]);
  period.addEventListener('change',()=>{
   if(!clearEditor()){period.value=contractPeriod;return;}
   contractPeriod=period.value;
   body.replaceChildren();
   drawContracts();
  });
  body.append(controls,el('p','계약 '+contracts.length+'건 · 종료 임박 '+state.contracts.filter(nearEnd).length+
   '건 · 기간 지난 진행중 계약 '+state.contracts.filter(pastEnd).length+'건','help'));
  body.append(el('p','종료 임박은 진행중 계약 중 '+asOf+'부터 '+through+'까지 종료되는 계약입니다.','help'));
  if(state.canWrite)body.append(btn('용역 계약 등록',()=>masterEditor('contract'),true));
  if(!contracts.length){body.append(el('p','조회 조건에 맞는 계약이 없습니다.','message'));return;}
  body.append(table(['계약','거래처','기간','월 공급가 / 부가세','청구 기준','상태','기한 확인',''],contracts.map(contract=>{
   const actions=el('div','','erp-actions');
   actions.append(btn(state.canWrite?'수정':'보기',()=>masterEditor('contract',contract)));
   if(phase2)actions.append(btn('수금 기준',()=>void run(async()=>{
    const rule=await rpc('erp_sales_get_contract_receipt_rule',{p_contract_id:contract.id});
    contractReceiptRuleEditor(contract,rule);
   })));
   if(contractMonthLookup)actions.append(btn('월 매출 조회',()=>contractMonthEditor(contract)));
   if(state.canWrite&&contract.status==='active')actions.append(btn('월 매출 생성',()=>monthEditor(contract)));
   return [contract.title,labelFor('parties',contract.party_id),contract.starts_on+' ~ '+contract.ends_on,
    money(contract.monthly_supply)+' / '+money(contract.monthly_tax),contract.billing_basis,kinds[contract.status],
    pastEnd(contract)?'기간 지남':nearEnd(contract)?'30일 이내 종료':'—',actions];
  })));
 }
 function contractReceiptRuleEditor(contract,rule){
  const parts=formStart('수금 기준: '+contract.title);
  if(!parts)return;
  const {f,grid}=parts;
  const month=field(grid,'receipt_month','수금 기준 월','select',rule.month_offset??'',
   [['','자동 지정 안 함'],['0','매출 당월'],['1','매출 익월']]);
  const day=field(grid,'receipt_day','수금일 (1~31일)','number',rule.due_day??'');
  day.min='1';
  day.max='31';
  day.step='1';
  function syncDay(){
   const enabled=month.value!=='';
   day.closest('label').hidden=!enabled;
   day.disabled=!enabled;
   day.required=enabled;
  }
  month.addEventListener('change',syncDay);
  syncDay();
  f.append(el('p','31일은 말일로 처리합니다. 지정일이 없는 달은 그달 마지막 날을 사용합니다. 변경 후 새로 생성하는 월 매출에 적용됩니다.','help'));
  if(state.canWrite){
   const save=el('button','수금 기준 저장','button primary');
   save.type='submit';
   f.append(save);
  }
  f.append(btn('닫기',clearEditor));
  f.addEventListener('submit',event=>{
   event.preventDefault();
   if(!state.canWrite||!f.reportValidity())return;
   const offset=month.value===''?null:Number(month.value);
   const dueDay=offset===null?null:Number(day.value);
   void run(async()=>{
    await rpc('erp_sales_set_contract_receipt_rule',{
     p_contract_id:contract.id,p_month_offset:offset,p_due_day:dueDay,p_expected_rule:rule
    });
    f.dataset.dirty='false';
    clearEditor();
    report('용역 계약의 수금 기준을 저장했습니다.');
   });
  });
 }
 function contractMonthEditor(contract){
  if(!clearEditor())return;
  const form=el('form','','app-authoring');
  const grid=el('div','','erp-fields');
  const month=field(grid,'lookup_month','조회 월','month',today().slice(0,7),[],true);
  const search=el('button','선택 월 조회','button primary');
  search.type='submit';
  form.append(el('h3','월 매출 조회: '+contract.title),grid,search,btn('닫기',clearEditor));
  editor.append(form);
  form.addEventListener('submit',event=>{
   event.preventDefault();
   if(!form.reportValidity())return;
   void run(async()=>{
    const sale=await rpc('erp_sales_get_contract_month',{p_contract_id:contract.id,p_month:month.value+'-01'});
    if(!sale){report('선택한 월에 생성된 매출이 없습니다.');return;}
    saleEditor(sale);
    report('기존 월 매출을 불러왔습니다.');
   });
  });
 }
 function monthEditor(contract){const parts=formStart('월 매출 생성: '+contract.title);if(!parts)return;const {f,grid}=parts;field(grid,'month','매출 월','month',today().slice(0,7),[],true);f.append(el('p','기존 문서와 계산 결과는 변경하지 않습니다. 같은 계약·월 매출이 있으면 기존 거래를 엽니다.','help'));const save=el('button','매출 생성·확인','button primary');save.type='submit';f.append(save,btn('닫기',clearEditor));f.addEventListener('submit',e=>{e.preventDefault();if(!f.reportValidity())return;void run(async()=>{const sale=await rpc('erp_sales_generate_month',{p_contract_id:contract.id,p_month:f.elements.month.value+'-01'});f.dataset.dirty='false';saleEditor(sale);report(sale.alreadyExists?'이미 생성된 월 매출을 불러왔습니다.':'월 매출을 생성했습니다. 내용을 확인 후 확정하세요.');});});}
 function saleEditor(sale=null){const locked=sale?.status==='confirmed';const parts=formStart(sale?.id?(locked?'확정 매출 상세':'매출 수정'):'소금·상품 판매 등록');if(!parts)return;const {f,grid}=parts;f.dataset.confirmed=String(locked);const data=sale||{};const requestKey=data.request_key||crypto.randomUUID();
  const kind=data.kind||'product';f.append(el('p',data.id?'거래·주문 ID: '+data.id:'공급처 직배송 주문입니다. 태장 창고 재고를 차감하지 않습니다.','help'));
  field(grid,'party_id','고객·거래처','select',data.party_id||'',locked?[[data.party_id,data.party_snapshot.name]]:options('parties',p=>p.active&&p.relationships.includes('customer')),true);
  field(grid,'order_date','주문·등록일','date',data.order_date||today(),[],true);const salesDate=field(grid,'sales_date','매출 기준일','date',data.sales_date||today(),[],true);
  const agent=field(grid,'agent_id','담당 영업자 (선택)','select',data.agent_id||'',locked&&data.agent_id?[[data.agent_id,data.agent_snapshot.name]]:options('agents',a=>a.active));
  const refreshAgents=()=>{const p=f.elements.party_id.value,d=salesDate.value;const relations=state.assignments.filter(a=>a.party_id===p&&a.starts_on<=d&&(!a.ends_on||d<a.ends_on));const old=agent.value;agent.replaceChildren();for(const [v,t] of options('agents',a=>a.active&&relations.some(r=>r.agent_id===a.id))){const o=el('option',t);o.value=v;agent.append(o);}agent.value=[...agent.options].some(o=>o.value===old)?old:(relations.find(r=>r.relationship==='management')?.agent_id||'');};
  f.elements.party_id.addEventListener('change',refreshAgents);salesDate.addEventListener('change',refreshAgents);if(!locked)refreshAgents();
  if(kind==='product'){
   field(grid,'supplier_id','직배송 공급처','select',data.supplier_id||'',locked?[[data.supplier_id,data.supplier_snapshot.name]]:options('parties',p=>p.active&&p.relationships.includes('supplier')),true);
   field(grid,'order_channel','주문 경로','select',data.order_channel||'phone',[['mall','쇼핑몰'],['phone','전화'],['kakao','카카오톡'],['purchase_order','기업 발주서'],['other','기타']],true);
   field(grid,'shipping_status','등록 시 배송 상태','select',data.shipping_status||'preparing',[['preparing','배송 준비'],['shipped','발송'],['delivered','배송 완료']],true);
  }else f.append(el('p','연결 계약: '+(data.contract_snapshot?.title||labelFor('contracts',data.contract_id))+' / 매출 월: '+data.sales_month?.slice(0,7),'help'));
  const lineArea=el('section','','app-form-section');lineArea.append(el('h4','거래 품목·실제 금액'));const lineRows=el('div','','erp-line-rows');lineArea.append(lineRows);let seq=0;
  const addLine=(line={})=>{const box=el('fieldset','','erp-line erp-fields');box.disabled=locked||!state.canWrite;box.append(el('legend','품목 '+(++seq)));const add=(n,l,t,v,c=[],r=true)=>field(box,n+'_'+seq,l,t,v,c,r);
   const item=add('item_id','판매 품목','select',line.item_id||'',locked?[[line.item_id,line.item_snapshot.name]]:options('items',i=>i.active&&i.kind===kind));
   const quantity=add('quantity','수량','number',line.quantity??1);quantity.step='0.001';quantity.min='0.001';
   const price=add('unit_price','실제 공급단가 (세금 별도, 원)','number',line.unit_price??'');
   const taxClass=add('tax_class','세금 구분','select',line.tax_class||'taxable',taxChoices);
   const tax=add('tax_amount','부가세 (직접 입력, 원)','number',line.tax_amount??0);tax.step='1';
   item.addEventListener('change',()=>{const chosen=state.items.find(i=>i.id===item.value);if(chosen){price.value=chosen.base_price??'';taxClass.value=chosen.tax_class;tax.value=0;}});
   if(!locked&&state.canWrite)box.append(btn('품목 제거',()=>{box.remove();f.dataset.dirty='true';}));
   box.readLine=()=>({item_id:item.value,quantity:Number(quantity.value),unit_price:Number(price.value),tax_class:taxClass.value,tax_amount:Number(tax.value)});lineRows.append(box);
  };
  (data.lines?.length?data.lines:[{}]).forEach(addLine);if(!locked&&state.canWrite&&kind==='product')lineArea.append(btn('품목 추가',()=>{addLine();f.dataset.dirty='true';}));f.append(lineArea);
  const fee=el('fieldset','','erp-fields app-form-section');fee.disabled=locked||!state.canWrite;fee.append(el('legend','거래별 영업비 조건'));
  const commission=data.commission||{kind:'none',value:0,settlement_rule:'after_full_payment'};
  field(fee,'fee_kind','조건','select',commission.kind,[['none','없음'],['fixed','고정 금액'],['rate','비율 (%)']],true);
  const val=field(fee,'fee_value','금액 또는 비율 (지급 계산 아님)','number',commission.value,[],true);val.step='0.001';
  field(fee,'settlement_rule','후속 지급 기준','select',commission.settlement_rule,[['after_full_payment','전액 입금 후 지급'],['proportional','부분 입금 비율 정산']],true);field(fee,'fee_note','조건 메모','textarea',commission.note||'');f.append(fee);
  field(grid,'memo','거래 메모','textarea',data.memo||'');grid.disabled=locked||!state.canWrite;
  if(sale?.id)f.append(el('p',`공급가 ${money(data.supply_amount)} · 부가세 ${money(data.tax_amount)} · 합계 ${money(data.total_amount)} · ${kinds[data.status]}`,'erp-total'));
  const actions=el('div','','erp-actions');if(!locked&&state.canWrite){const save=el('button','매출 저장','button primary');save.type='submit';actions.append(save);}
  if(sale?.id&&!locked&&state.canConfirm)actions.append(btn('매출 확정',()=>{if(f.dataset.dirty==='true'){report('변경한 내용을 먼저 저장한 뒤 확정해 주세요.',true);return;}if(window.confirm('확정 후 금액과 핵심 정보는 잠깁니다. 확정할까요?'))void run(async()=>{const result=await rpc('erp_sales_confirm',{p_id:data.id,p_revision:data.revision});saleEditor(result);if(tab==='sales')await drawSales();report('매출을 확정했습니다. 원본 금액은 잠겨 있습니다.');});}));
  if(sale?.id&&kind==='product'&&state.canWrite)actions.append(btn('새 주문으로 복사',()=>{
   if(!clearEditor())return;
   saleEditor({kind:'product',party_id:data.party_id,supplier_id:data.supplier_id,
    order_channel:data.order_channel,shipping_status:'preparing',lines:data.lines.map(line=>({
     item_id:line.item_id,quantity:line.quantity,unit_price:line.unit_price,
     tax_class:line.tax_class,tax_amount:line.tax_amount
    }))});
   report('새 주문을 작성합니다. 단가·수량과 이번 거래의 영업비 조건을 확인한 뒤 저장해 주세요.');
  }));
  actions.append(btn('닫기',clearEditor));f.append(actions);
  f.addEventListener('submit',event=>{event.preventDefault();if(locked||!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));const lines=[...lineRows.children].map(row=>row.readLine());if(!lines.length){report('판매 품목을 한 개 이상 입력해 주세요.',true);return;}
   const payload={kind,request_key:requestKey,party_id:d.party_id,order_date:d.order_date,sales_date:d.sales_date,agent_id:d.agent_id||null,memo:d.memo,lines,
    commission:{kind:d.fee_kind,value:Number(d.fee_value),settlement_rule:d.settlement_rule,note:d.fee_note||''},
    ...(kind==='product'?{supplier_id:d.supplier_id,order_channel:d.order_channel,shipping_status:d.shipping_status}:{contract_id:data.contract_id,sales_month:data.sales_month})};
   void run(async()=>{const result=await rpc('erp_sales_save',{p_data:payload,p_id:data.id||null,p_revision:data.revision||0});f.dataset.dirty='false';saleEditor(result);if(tab==='sales')await drawSales();report('매출을 저장했습니다. 입력한 실제 단가와 조건이 보존됩니다.');});
  });
  let refreshReceipts;
  if(locked&&phase4) drawAdjustments(data,()=>refreshReceipts?.());
  if(locked&&phase2) refreshReceipts=drawReceipts(data.id,data.total_amount);
  if(locked&&phase2&&(data.supplier_id||(data.agent_id&&Number(data.commission?.value)>0))) drawPayouts(data.id);
  if(sale?.id&&kind==='product'){
   const delivery=el('section','','app-form-section');delivery.append(el('h4','공급처 직배송 상태'),el('p',kinds[data.shippingCurrent||data.shipping_status]||'—'));const next=field(delivery,'next_shipping','배송 상태 기록','select',data.shippingCurrent||data.shipping_status,[['preparing','배송 준비'],['shipped','발송'],['delivered','배송 완료']]);
   if(state.canWrite)delivery.append(btn('배송 상태 저장',()=>{const value=next.value;void run(async()=>{const result=await rpc('erp_sales_shipping',{p_id:data.id,p_status:value});f.dataset.dirty='false';saleEditor(result);report('배송 상태를 이력으로 기록했습니다. 매출 원본은 유지됩니다.');});}));else next.disabled=true;editor.append(delivery);
  }
  if(sale?.id){const history=el('details');history.append(el('summary',`변경 이력 ${(data.history||[]).length}건`),table(['작업','일시','작업자'],(data.history||[]).map(h=>[({create:'등록',update:'수정',confirm:'확정',shipping:'배송 상태'})[h.action]||h.action,new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(h.created_at)),h.actor_id])));editor.append(history);}
 }
 function drawPayouts(saleId){
  const panel=el('section','','app-form-section');
  const content=el('div');
  const refresh=btn('지급 내역 조회',()=>{
   if(!canReplaceForm())return;
   void run(async()=>render(await rpc('erp_sales_get_payouts',{p_sale_id:saleId})));
  });
  panel.append(el('h4','영업비·공급처 지급'),refresh,content);
  editor.append(panel);
  const canAct=state.canWrite&&state.canConfirm;

  function canReplaceForm(){
   return !content.querySelector('form[data-dirty="true"]')||window.confirm('저장하지 않은 지급 입력을 닫을까요?');
  }
  function render(summary,mode=null){
   content.replaceChildren();
   for(const [kind,label] of [['commission','영업비'],['supplier','공급처 지급']]){
    const detail=summary[kind];
    if(!detail)continue;
    const block=el('section','','app-form-section');
    block.append(el('h5',label+' · '+detail.name),
     el('p','전체 지급액 '+(detail.basis===null?'미확정':money(detail.basis))+
      ' · 지급 완료 '+money(detail.paid)+' · 지급 대기 '+money(detail.pending)+
      ' · 남은 지급액 '+(detail.remaining===null?'미확정':money(detail.remaining)),'help'));
    if(detail.cash_paid!=null&&detail.cash_paid!==detail.paid){
     block.append(el('p','실제 송금 합계 '+money(detail.cash_paid),'help'));
    }
    if(detail.commission){
     const rule=detail.commission.settlement_rule==='proportional'?'입금 비율 정산':'전액 입금 후 지급';
     const basis=detail.commission.kind==='rate'?detail.commission.value+'%':money(detail.commission.value);
     block.append(el('p','거래 조건 '+basis+' · '+rule,'help'));
    }
    if(detail.basis!==null)block.append(el('p','추가 승인 가능액 '+money(Math.max(0,detail.allowed-detail.paid-detail.pending)),'help'));
    if(canAct)block.append(btn(label+' 승인',()=>{
     if(canReplaceForm())render(summary,{kind});
    }));
    if(detail.entries.length)block.append(table(['금액','지급 목표일','주기','승인 근거','상태','결과 근거',''],detail.entries.map(entry=>{
     const actions=el('div','','erp-actions');
     if(canAct&&!entry.outcome){
      for(const [outcome,text] of [['paid','지급 완료 기록'],['cancelled','미지급 승인 취소']]){
       actions.append(btn(text,()=>{if(canReplaceForm())render(summary,{kind,entry,outcome});}));
      }
     }
     const status=entry.outcome==='paid'?'지급 완료 '+entry.outcome_on:entry.outcome==='cancelled'?'승인 취소 '+entry.outcome_on:'지급 대기';
     const amount=entry.offset&&entry.outcome!=='cancelled'
      ?money(entry.amount)+' · 상계 '+money(entry.offset)+' · 실제 지급액 '+money(entry.cash_amount):money(entry.amount);
     return [amount,entry.due_on,entry.cycle==='monthly'?'월 지정일':'거래별',
      entry.approval_evidence,status,entry.outcome_evidence||'—',actions];
    })));
    if(mode?.kind===kind)block.append(payoutForm(detail,mode));
    content.append(block);
   }

   function payoutForm(detail,{kind,entry,outcome}){
    const form=el('form','','app-authoring');
    const fields=el('div','','erp-fields');
    const requestId=crypto.randomUUID();
    const label=entry?(outcome==='paid'?'실제 지급 저장':'승인 취소 저장'):'지급 승인 저장';
    let basis,amount,date,cycle;
    if(entry){
     form.append(el('p','승인 금액 '+money(entry.amount),'help'));
     if(entry.offset&&outcome==='paid'){
      form.append(el('p','상계 '+money(entry.offset)+' · 실제 지급액 '+money(entry.cash_amount),'erp-total'));
     }
     date=field(fields,'payout_on',outcome==='paid'?'실제 지급일':'취소일','date',today(),[],true);
     date.max=today();
    }else{
     if(detail.basis===null){
      basis=field(fields,'payout_basis',kind==='commission'?'계약으로 확인한 전체 영업비 (원)':'공급처 전체 지급액 (원)','number','',[],true);
      basis.min='1';basis.step='1';basis.max='2000000000000';
     }
     amount=field(fields,'payout_amount','이번 승인 금액 (원)','number','',[],true);
     amount.min='1';amount.step='1';amount.max='2000000000000';
     if(kind==='supplier'){
      cycle=field(fields,'payout_cycle','공급처 지급 주기','select',detail.cycle||'transaction',[['transaction','거래별'],['monthly','월 지정일']],true);
      date=field(fields,'payout_due','지급 목표일','date');
      const sync=()=>{date.required=cycle.value==='monthly';};
      cycle.addEventListener('change',sync);sync();
     }
    }
    const evidence=field(fields,'payout_evidence',entry?(outcome==='paid'?(entry.cash_amount===0?'전액 상계 확인 근거':'송금 확인 근거'):'승인 취소 사유'):'지급 승인 근거','text','',[],true);
    evidence.maxLength=500;
    const submit=el('button',label,'button primary');
    submit.type='submit';
    form.append(fields,submit,btn('닫기',()=>{if(canReplaceForm())render(summary);}));
    form.addEventListener('input',()=>{form.dataset.dirty='true';});
    form.addEventListener('submit',event=>{
     event.preventDefault();
     if(!form.reportValidity())return;
     void run(async()=>{
      const next=entry
       ?await rpc('erp_sales_finish_payout',{p_sale_id:saleId,p_payout_id:entry.id,p_outcome:outcome,p_on:date.value,p_evidence:evidence.value})
       :await rpc('erp_sales_approve_payout',{p_sale_id:saleId,p_request_id:requestId,p_kind:kind,
        p_amount:Number(amount.value),p_evidence:evidence.value,p_basis_amount:basis?Number(basis.value):null,
        p_cycle:cycle?.value||'transaction',p_due_on:date?.value||null});
      render(next);
      report(entry?(outcome==='paid'?'실제 지급을 기록했습니다.':'미지급 승인을 취소했습니다.'):'지급을 승인했습니다.');
      if(tab==='payouts'){
       await drawPayoutQueue().catch(()=>report('지급 처리를 저장했습니다. 지급 대기 조회를 다시 눌러 주세요.',true));
      }
     });
    });
    return form;
   }
  }
 }
 function drawReceipts(saleId,originalTotal){
  const panel=el('section','','app-form-section');
  const content=el('div');
  const load=btn('수금 내역 조회',()=>{
   if(content.querySelector('form[data-dirty="true"]')&&!window.confirm('저장하지 않은 수금 입력을 닫을까요?'))return;
   void run(async()=>render(await rpc('erp_sales_get_receipts',{p_sale_id:saleId})));
  });
  panel.append(el('h4','수금·미수금'),content,load);
  editor.append(panel);

  async function refresh(){
   if(!content.hasChildNodes()||content.querySelector('form[data-dirty="true"]'))return;
   render(await rpc('erp_sales_get_receipts',{p_sale_id:saleId}));
  }

  async function showSaved(summary,message){
   render(summary);
   report(message);
   if(tab==='receivables'){
    await drawReceivables().catch(()=>report('저장했습니다. 미수금 목록 조회를 다시 시도해 주세요.',true));
   }
  }

  function render(summary, reversal=null, editDue=false){
   load.textContent='수금 내역 새로 조회';
   const reversedIds=new Set(summary.entries.map(entry=>entry.reverses_id).filter(Boolean));
   content.replaceChildren(el('p','누적 수금 '+money(summary.received)+' · 미수금 '+money(summary.balance),'erp-total'));
   if(summary.effective_total!=null&&summary.effective_total!==originalTotal){
    content.append(el('p','조정 후 매출 '+money(summary.effective_total),'help'));
   }
   if(summary.refunded){
    content.append(el('p','실제 환불 '+money(summary.refunded)+' · 순수금 '+money(summary.net_received),'help'));
   }
   if(summary.overpaid)content.append(el('p','초과 수금 '+money(summary.overpaid),'help'));
   const form=el('form','','app-authoring');
   const due=el('div','','erp-actions');
   due.append(el('span','수금 예정일 '+(summary.due_on||'미지정')));
   if(state.canWrite&&!editDue)due.append(btn('예정일 설정',()=>{
    if(form.dataset.dirty==='true'&&!window.confirm('저장하지 않은 수금 입력을 닫을까요?'))return;
    render(summary,null,true);
    content.querySelector('[name="receipt_due_on"]')?.focus();
   }));
   content.append(due);
   if(editDue){
    const fields=el('div','','erp-fields');
    const date=field(fields,'receipt_due_on','수금 예정일','date',summary.due_on||'');
    date.min='1900-01-01';
    date.max='9999-12-31';
    const save=el('button','예정일 저장','button primary');
    save.type='submit';
    form.append(fields,el('p','날짜를 비우고 저장하면 예정일이 해제됩니다.','help'),save,
     btn('돌아가기',()=>{
      if(form.dataset.dirty!=='true'||window.confirm('저장하지 않은 예정일 입력을 닫을까요?'))render(summary);
     }));
    form.addEventListener('input',()=>{form.dataset.dirty='true';});
    form.addEventListener('submit',event=>{
     event.preventDefault();
     if(!form.reportValidity())return;
     void run(async()=>{
      const next=await rpc('erp_sales_set_receipt_due_on',{
       p_sale_id:saleId,p_due_on:date.value||null,p_expected_due_on:summary.due_on??null
      });
      await showSaved(next,'수금 예정일을 저장했습니다.');
     });
    });
    content.append(form);
    return;
   }
   if(summary.entries.length){
    content.append(table(['기록일','구분','금액','메모',''],summary.entries.map(entry=>{
     const type=entry.reverses_id?'오입금 취소':reversedIds.has(entry.id)?'입금 (취소됨)':'입금';
     const reverse=state.canWrite&&!entry.reverses_id&&!reversedIds.has(entry.id)
      &&(summary.net_received==null||entry.amount<=summary.net_received)
      ?btn('오입금 취소',()=>{
       if(form.dataset.dirty==='true'&&!window.confirm('저장하지 않은 수금 입력을 닫을까요?'))return;
       render(summary,entry);
       content.querySelector('input[name="receipt_note"]')?.focus();
      }):'';
     return [entry.recorded_on,type,money(entry.reverses_id?-entry.amount:entry.amount),entry.note,reverse];
    })));
   }else{
    content.append(el('p','등록된 입금이 없습니다.','message'));
   }
   if(!state.canWrite||(!reversal&&summary.balance===0))return;

   const requestId=crypto.randomUUID();
   const fields=el('div','','erp-fields');
   const recordedOn=field(fields,'receipt_date',reversal?'정정일':'입금일','date',today(),[],true);
   recordedOn.max=today();
   let amount;
   if(reversal){
    recordedOn.min=reversal.recorded_on;
    form.append(el('p',reversal.recorded_on+' 입금 '+money(reversal.amount)+'의 기록을 취소합니다.','help'));
   }else{
    amount=field(fields,'receipt_amount','입금액 (원)','number','',[],true);
    amount.min='1';
    amount.max=String(summary.balance);
    amount.step='1';
   }
   const note=field(fields,'receipt_note',reversal?'취소 사유':'입금 메모','text','',[],Boolean(reversal));
   note.maxLength=500;
   const save=el('button',reversal?'취소 기록 저장':'입금 기록 저장','button primary');
   save.type='submit';
   form.append(fields,save);
   if(reversal)form.append(btn('돌아가기',()=>{
    if(form.dataset.dirty!=='true'||window.confirm('저장하지 않은 취소 사유를 닫을까요?'))render(summary);
   }));
   form.addEventListener('input',()=>{form.dataset.dirty='true';});
   form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    void run(async()=>{
     const next=await rpc('erp_sales_record_receipt',{
      p_sale_id:saleId,p_request_id:requestId,p_recorded_on:recordedOn.value,
      p_amount:amount?Number(amount.value):null,p_note:note.value,p_reverses_id:reversal?.id??null
     });
     await showSaved(next,reversal?'오입금 취소를 기록했습니다.':'입금을 기록했습니다.');
    });
   });
   content.append(form);
  }
  return refresh;
 }
 async function drawSales(){const list=await rpc('erp_sales_list',{p_from:filters.from,p_to:filters.to,p_party_id:filters.party||null,p_kind:filters.kind||null,p_status:filters.status||null,p_agent_id:filters.agent||null});if(tab!=='sales')return;body.replaceChildren();
  const f=el('form','','app-authoring');const grid=el('div','','erp-fields');const inputs=[field(grid,'from','시작일','date',filters.from,[],true),field(grid,'to','종료일','date',filters.to,[],true),field(grid,'party','거래처','select',filters.party,[['','전체 거래처'],...state.parties.map(p=>[p.id,p.name])]),field(grid,'kind','상품·용역','select',filters.kind,[['','전체 유형'],['service','용역'],['product','상품']]),field(grid,'status','거래 상태','select',filters.status,[['','전체 상태'],['draft','작성 중'],['confirmed','확정']]),field(grid,'agent','영업자','select',filters.agent,[['','전체 영업자'],...state.agents.map(a=>[a.id,a.name])])];
  inputs.forEach(input=>input.addEventListener('change',()=>filters[input.name]=input.value));
  const [from,to]=inputs;
  const search=el('button','조회','button primary');
  search.type='submit';
  const actions=el('div','','erp-actions');
  actions.append(search,btn('이번 달',()=>setMonthRange(false)),btn('지난달',()=>setMonthRange(true)));
  f.append(grid,actions);
  f.addEventListener('submit',event=>{
   event.preventDefault();
   if(!f.reportValidity())return;
   if(from.value>to.value){
    report('시작일은 종료일보다 늦을 수 없습니다.',true);
    return;
   }
   inputs.forEach(input=>filters[input.name]=input.value);
   void run(async()=>{await drawSales();report('');});
  });
  body.append(f);

  function setMonthRange(previous){
   const current=today();
   const first=current.slice(0,7)+'-01';
   if(previous){
    const last=new Date(first+'T00:00:00Z');
    last.setUTCDate(0);
    to.value=last.toISOString().slice(0,10);
    from.value=to.value.slice(0,7)+'-01';
   }else{
    from.value=first;
    to.value=current;
   }
   f.requestSubmit();
  }
  if(state.canWrite)body.append(btn('소금·상품 판매 등록',()=>saleEditor(),true));body.append(el('p',`총 ${list.total}건${list.total>list.limit?' 중 최신 '+list.limit+'건 표시 · 기간을 좁혀 조회하세요.':''}`));
  if(!list.items.length)body.append(el('p','해당 기간의 매출이 없습니다. 계약에서 월 매출을 생성하거나 상품 판매를 등록하세요.','message'));
  else body.append(table(['매출일','거래처','유형','영업자','상태','금액',''],list.items.map(s=>[s.sales_date,s.party_name,kinds[s.kind],s.agent_name||'—',kinds[s.status],money(s.total_amount),btn('상세',()=>void run(async()=>saleEditor(await rpc('erp_sales_get',{p_id:s.id}))))])));
 }
 async function drawPayoutQueue(){
  const yesterday=new Date(today()+'T00:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const list=await rpc('erp_sales_list_pending_payouts',{
   p_kind:payoutFilters.kind||null,
   p_due_to:payoutFilters.overdue?yesterday.toISOString().slice(0,10):null
  });
  if(tab!=='payouts')return;
  const form=el('form','','app-authoring');
  const grid=el('div','','erp-fields');
  const kind=field(grid,'payout_filter_kind','지급 구분','select',payoutFilters.kind,
   [['','전체'],['commission','영업비'],['supplier','공급처 지급']]);
  const scope=field(grid,'payout_filter_scope','목표일','select',payoutFilters.overdue?'overdue':'all',
   [['all','전체 지급 대기'],['overdue','목표일 지남']]);
  const search=el('button','지급 대기 조회','button primary');
  search.type='submit';
  form.append(grid,search);
  form.addEventListener('submit',event=>{
   event.preventDefault();
   Object.assign(payoutFilters,{kind:kind.value,overdue:scope.value==='overdue'});
   void run(async()=>{await drawPayoutQueue();report('');});
  });
  body.replaceChildren(form);
  const count=list.total>list.limit?' ('+list.limit+'건 표시)':'';
  body.append(el('p','지급 대기 '+list.total+'건 · 실제 지급 예정 합계 '+
   BigInt(list.total_cash).toLocaleString('ko-KR')+'원'+count,'erp-total'),
   el('p','승인 후 지급 결과가 기록되지 않은 건입니다. 상세에서 지급 완료 또는 미지급 승인 취소를 기록합니다.','help'));
  if(!list.items.length){
   body.append(el('p','조회 조건에 맞는 지급 대기 건이 없습니다.','message'));
   return;
  }
  const asOf=today();
  body.append(table(['구분','지급 대상','거래처','목표일','승인액','상계액','실제 지급 예정액','상태',''],
   list.items.map(row=>[
    row.kind==='commission'?'영업비':'공급처 지급',row.payee_name,row.party_name,
    row.due_on+(row.due_on<asOf?' · 기한 지남':''),money(row.amount),money(row.offset_amount),
    money(row.cash_amount),row.cancelled_sale?'거래 취소 승인 · 확인 필요':'지급 대기',
    btn('상세',()=>void run(async()=>saleEditor(await rpc('erp_sales_get',{p_id:row.sale_id}))))
   ])));
 }
 async function drawAdjustmentQueue(){
  const list=await rpc('erp_sales_list_pending_adjustments',{p_kind:adjustmentKind||null});
  if(tab!=='adjustments')return;
  const form=el('form','','app-authoring');
  const grid=el('div','','erp-fields');
  const kind=field(grid,'adjustment_filter_kind','조정 구분','select',adjustmentKind,
   [['','전체'],...Object.entries(adjustmentLabels)]);
  const search=el('button','조정 대기 조회','button primary');search.type='submit';
  form.append(grid,search);
  form.addEventListener('submit',event=>{
   event.preventDefault();adjustmentKind=kind.value;
   void run(async()=>{await drawAdjustmentQueue();report('');});
  });
  body.replaceChildren(form);
  body.append(el('p','조정 대기 '+list.total+'건'+(list.total>list.limit?' ('+list.limit+'건 표시)':''),'erp-total'),
   el('p','승인·반려 전 요청을 오래된 순서로 표시합니다. 상세에서 요청 내용과 원거래를 확인한 뒤 처리하세요.','help'));
  if(!list.items.length){body.append(el('p','조회 조건에 맞는 조정 대기 요청이 없습니다.','message'));return;}
  body.append(table(['요청일','거래처','구분','요청 사유',''],list.items.map(row=>[
   row.requested_on,row.party_name,adjustmentLabels[row.kind],row.reason,
   btn('상세',()=>void run(async()=>saleEditor(await rpc('erp_sales_get',{p_id:row.sale_id}))))
  ])));
 }
 async function drawReceivables(){
  const list=await rpc('erp_sales_list_receivables',{
   p_party_id:receivableFilters.party||null,p_due_from:receivableFilters.from||null,p_due_to:receivableFilters.to||null
  });
  if(tab!=='receivables')return;
  const form=el('form','','app-authoring');
  const grid=el('div','','erp-fields');
  const party=field(grid,'receivable_party','거래처','select',receivableFilters.party,
   [['','전체 거래처'],...state.parties.map(p=>[p.id,p.name])]);
  const from=field(grid,'receivable_from','예정일 시작','date',receivableFilters.from);
  const to=field(grid,'receivable_to','예정일 종료','date',receivableFilters.to);
  const search=el('button','미수금 조회','button primary');
  search.type='submit';
  const actions=el('div','','erp-actions');
  actions.append(search,btn('기한 지난 미수금',()=>setDueRange(true)),
   btn('전체 미수금',()=>setDueRange(false)));
  form.append(grid,actions);
  function setDueRange(overdue){
   from.value='';
   if(overdue){
    const yesterday=new Date(today()+'T00:00:00Z');
    yesterday.setUTCDate(yesterday.getUTCDate()-1);
    to.value=yesterday.toISOString().slice(0,10);
   }else{
    to.value='';
   }
   form.requestSubmit();
  }
  form.addEventListener('submit',event=>{
   event.preventDefault();
   if(from.value&&to.value&&from.value>to.value){
    report('예정일의 시작일과 종료일을 확인해 주세요.',true);
    return;
   }
   Object.assign(receivableFilters,{party:party.value,from:from.value,to:to.value});
   void run(async()=>{await drawReceivables();report('');});
  });
  body.replaceChildren(form,el('p','날짜를 비우면 예정일이 없는 미수 거래도 표시됩니다.','help'));
  const count=list.total>list.limit?` (${list.limit}건 표시)`:'';
  body.append(el('p',`미수 거래 ${list.total}건 · 미수 합계 ${BigInt(list.total_balance).toLocaleString('ko-KR')}원${count}`,'erp-total'));
  if(!list.items.length){
   body.append(el('p','조회 조건에 맞는 미수 거래가 없습니다.','message'));
   return;
  }
  const asOf=today();
  body.append(table(['거래처','유형','매출일','수금 예정일','매출액','수금액','미수금',''],list.items.map(item=>[
   item.party_name,kinds[item.kind],item.sales_date,
   item.due_on?(item.due_on<asOf?item.due_on+' · 기한 지남':item.due_on):'미지정',
   money(item.total_amount),money(item.received),money(item.balance),
   btn('상세',()=>void run(async()=>saleEditor(await rpc('erp_sales_get',{p_id:item.id}))))
  ])));
 }
 const paymentMethods=[['company_card','법인카드'],['transfer','이체'],['cash','현금'],['other','기타']];
 const purchaseKinds=[['expense','비용'],['purchase','매입']];
 const supportRpc=(kind,request,data)=>rpc('erp_sales_record_support',{p_kind:kind,p_request_id:request,p_data:data});
 function datedField(grid,label){
  const date=field(grid,'date',label,'date',today(),[],true);
  date.max=today();
  return date;
 }
 function amountField(grid,label,min='1'){
  const amount=field(grid,'amount',label,'number','',[],true);
  amount.min=min;amount.max='2000000000000';amount.step='1';
  return amount;
 }
 function supportSubmit(form,label,save){
  const button=el('button',label,'button primary');
  button.type='submit';
  form.append(button);
  form.addEventListener('input',()=>{form.dataset.dirty='true';});
  form.addEventListener('submit',event=>{
   event.preventDefault();
   if(form.reportValidity())void run(save);
  });
 }
 function supportEditor(title,kind){
  const parts=formStart(title);
  if(!parts)return;
  const {f,grid}=parts;
  const request=crypto.randomUUID();
  return {f,grid,save:async(data,refresh)=>{
   await supportRpc(kind,request,data);
   f.dataset.dirty='false';
   clearEditor();
   report('기록을 저장했습니다.');
   await refresh().catch(()=>report('저장했습니다. 목록 조회를 다시 시도해 주세요.',true));
  }};
 }
 async function drawPurchases(){
  const result=await rpc('erp_sales_list_purchases',{p_from:purchaseRange.from,p_to:purchaseRange.to});
  if(tab!=='purchases')return;
  const search=el('form','','app-authoring');
  const grid=el('div','','erp-fields');
  const from=field(grid,'purchase_from','구매일 시작','date',purchaseRange.from,[],true);
  const to=field(grid,'purchase_to','구매일 종료','date',purchaseRange.to,[],true);
  search.append(grid);
  supportSubmit(search,'구매 내역 조회',async()=>{
   Object.assign(purchaseRange,{from:from.value,to:to.value});
   await drawPurchases();report('');
  });
  body.replaceChildren(search);
  if(state.canWrite)body.append(btn('일반 구매 등록',purchaseEditor,true));
  body.append(el('p',`구매 ${result.total}건 · 합계 ${BigInt(result.total_amount).toLocaleString('ko-KR')}원`+
   (result.total>200?' · 최근 200건 표시':'') ,'erp-total'));
  if(!result.items.length)body.append(el('p','등록된 구매가 없습니다.','message'));
  else body.append(table(['구매일','구분','구매처','품목·내역','결제 수단','금액','증빙'],result.items.map(row=>[
   row.purchased_on,Object.fromEntries(purchaseKinds)[row.purchase_kind],row.supplier,
   [row.item,row.description].filter(Boolean).join(' · '),Object.fromEntries(paymentMethods)[row.method],money(row.total_amount),row.evidence||'—'
  ])));
 }
 function purchaseEditor(){
  const edit=supportEditor('일반 구매 등록','purchase');
  if(!edit)return;
  const {f,grid,save}=edit;
  const date=datedField(grid,'구매일');
  const kind=field(grid,'purchase_kind','구분','select','expense',purchaseKinds,true);
  const supplier=field(grid,'supplier_id','등록된 공급처 (선택)','select','',options('parties',p=>p.active&&p.relationships.includes('supplier')));
  const merchant=field(grid,'merchant','구매처 이름','text','',[],true);
  merchant.maxLength=150;
  const sync=()=>{merchant.disabled=Boolean(supplier.value);merchant.required=!supplier.value;};
  supplier.addEventListener('change',sync);
  const item=field(grid,'item_id','품목 (선택)','select','',options('items',i=>i.active));
  const desc=field(grid,'description','구매 내역','text','',[],true);desc.maxLength=200;
  const method=field(grid,'method','결제 수단','select','company_card',paymentMethods,true);
  const amount=amountField(grid,'결제 금액 (원)');
  const evidence=field(grid,'note','영수증·결제 증빙 (선택)','text');evidence.maxLength=500;
  supportSubmit(f,'구매 저장',()=>save({date:date.value,purchase_kind:kind.value,supplier_id:supplier.value||null,
   merchant:merchant.value,item_id:item.value||null,description:desc.value,method:method.value,
   amount:Number(amount.value),note:evidence.value},drawPurchases));
  f.append(btn('닫기',clearEditor));
 }
 async function drawStock(){
  const data=await rpc('erp_sales_get_stock');
  if(tab!=='stock')return;
  body.replaceChildren(el('p','태장이 직접 보유하는 재고를 기록합니다. 공급처 직배송은 재고에 반영되지 않습니다.','help'));
  if(state.canWrite)body.append(btn('입출고 기록',stockEditor,true));
  body.append(el('h3','현재고'),table(['코드','품목','현재고','상태'],data.balances.map(r=>[
   r.code,r.name,r.quantity+' '+r.unit,r.active&&r.inventory_managed?'관리 중':'관리 중지'
  ])));
  body.append(el('h3','최근 입출고'),table(['날짜','품목','구분','수량','근거'],data.movements.map(r=>[
   r.moved_on,r.name,r.quantity>0?'입고':'출고',Math.abs(r.quantity)+' '+r.unit,r.reason
  ])));
 }
 function stockEditor(){
  const edit=supportEditor('입출고 기록','stock');
  if(!edit)return;
  const {f,grid,save}=edit;
  const date=datedField(grid,'입출고일');
  const item=field(grid,'stock_item','재고관리 품목','select','',
   options('items',i=>i.active&&i.inventory_managed&&i.kind!=='service'),true);
  const direction=field(grid,'direction','구분','select','in',[['in','입고'],['out','출고']],true);
  const quantity=field(grid,'quantity','수량','number','',[],true);
  quantity.min='0.001';quantity.max='1000000000';quantity.step='0.001';
  const note=field(grid,'note','기록 근거','text','',[],true);note.maxLength=500;
  supportSubmit(f,'입출고 저장',()=>save({date:date.value,item_id:item.value,
   quantity:Number(quantity.value)*(direction.value==='out'?-1:1),note:note.value},drawStock));
  f.append(btn('닫기',clearEditor));
 }
 const adjustmentLabels={cancel_order:'배송 전 취소',return_goods:'반품',service_change:'용역 매출 조정',
  sales_change:'확정 매출 조정',commission_change:'지급 영업비 조정'};
 const adjustmentActions={approve:'승인',reject:'반려',recall:'공급처 회수 확인',refund:'실제 환불 기록'};
 const commissionActions=[['offset','다음 영업비에서 상계'],['return','별도 반환'],['difference','차액 조정'],['waive','면제']];
 function drawAdjustments(sale,refreshReceipts){
  const panel=el('section','','app-form-section');
  const content=el('div');
  const preview=el('div');
  const previewButton=btn('정산 잔액 미리보기',()=>void run(async()=>{
   const receipt=await rpc('erp_sales_get_receipts',{p_sale_id:sale.id});
   renderReconciliationPreview(preview,sale,receipt);
  }));
  previewButton.hidden=true;
  const show=btn('취소·반품·조정 조회',()=>void run(async()=>{
   const rows=await rpc('erp_sales_list_adjustments',{p_sale_id:sale.id});
   show.hidden=true;render(rows);
  }));
  panel.append(el('h4','취소·반품·조정'),show,previewButton,content,preview);
  editor.append(panel);
  function render(rows){
   previewButton.hidden=false;
   preview.replaceChildren();
   content.replaceChildren();
   const switchForm=factory=>{
    if(content.querySelector('form[data-dirty="true"]')&&!window.confirm('저장하지 않은 조정 입력을 닫을까요?'))return;
    content.querySelector('form')?.remove();
    content.append(factory());
   };
   if(state.canWrite)content.append(btn('조정 요청 작성',()=>switchForm(()=>requestForm(rows))));
   for(const row of rows){
    const box=el('section','','app-form-section');
    const decision=row.events.find(event=>['approve','reject'].includes(event.action));
    const refunded=row.events.filter(e=>e.action==='refund').reduce((sum,e)=>sum+e.amount,0);
    const planned=row.detail.refund_plan||0;
    const stateLabel=decision?.action==='approve'?'승인':decision?.action==='reject'?'반려':'검토 대기';
    box.append(el('h5',adjustmentLabels[row.kind]+' · '+stateLabel),
     el('p',row.requested_on+' · '+row.reason,'help'));
    if(row.kind==='return_goods'){
     const line=(sale.lines||[]).find(item=>item.id===row.detail.line_id);
     box.append(el('p',line?'부분 반품 · '+line.item_snapshot.name+' '+row.detail.quantity:'전체 반품','help'),
      el('p','반품 승인 요청액 '+money(row.detail.credit_amount),'help'));
    }
    if(row.kind==='commission_change'){
     box.append(el('p',Object.fromEntries(commissionActions)[row.detail.commission_action]+' · '+money(row.detail.amount),'help'));
    }else if(row.detail.amount!=null){
     box.append(el('p','기존 매출 '+money(row.before.total_amount)+' · 조정 후 '+money(row.detail.amount),'help'));
    }
    if(planned)box.append(el('p','환불 예정 '+money(planned)+' · 실제 환불 '+money(refunded),'help'));
    if(row.events.length)box.append(table(['일자','처리','금액','근거'],row.events.map(event=>[
     event.recorded_on,adjustmentActions[event.action],event.amount===null?'—':money(event.amount),event.note
    ])));
    if(state.canWrite&&state.canConfirm){
     const actions=!decision?['approve','reject']:decision.action==='approve'?[
      ...(row.kind==='return_goods'&&!row.events.some(e=>e.action==='recall')?['recall']:[]),
      ...(planned>refunded?['refund']:[])
     ]:[];
     for(const action of actions)box.append(btn(adjustmentActions[action],()=>switchForm(()=>eventForm(rows,row,action))));
    }
    content.append(box);
   }
  }
  function requestForm(rows){
   const f=el('form','','app-authoring');
   const grid=el('div','','erp-fields');
   const kinds=sale.kind==='product'?['cancel_order','return_goods','sales_change']:['service_change'];
   if(sale.agent_id)kinds.push('commission_change');
   const kind=field(grid,'adjustment_kind','구분','select',kinds[0],kinds.map(key=>[key,adjustmentLabels[key]]),true);
   const line=field(grid,'return_line','반품 품목','select','',
    [['','전체 반품'],...sale.lines.map(item=>[item.id,item.item_snapshot.name+' · '+item.quantity])]);
   const quantity=field(grid,'return_quantity','부분 반품 수량','number','');
   quantity.min='0.001';quantity.step='0.001';
   const credit=field(grid,'credit_amount','반품 매출 차감액 (원)','number','');
   credit.min='1';credit.step='1';credit.max=String(sale.total_amount);
   const refund=field(grid,'refund_plan','환불 예정액 (원)','number','0');refund.step='1';
   const amount=amountField(grid,'조정 금액 또는 조정 후 매출 (원)','0');
   const commission=field(grid,'commission_action','지급 영업비 처리','select','offset',commissionActions);
   const reason=field(grid,'adjustment_reason','요청 사유','text','',[],true);reason.maxLength=500;
   const toggle=(input,visible,required=false)=>{
    input.closest('label').hidden=!visible;input.disabled=!visible;input.required=visible&&required;
   };
   function sync(){
    const returns=kind.value==='return_goods';
    const productAction=returns||kind.value==='cancel_order';
    toggle(line,returns);toggle(quantity,returns&&Boolean(line.value),true);
    toggle(credit,returns,true);toggle(refund,productAction,true);toggle(amount,!productAction,true);
    toggle(commission,kind.value==='commission_change',true);
   }
   kind.addEventListener('change',sync);line.addEventListener('change',sync);sync();
   f.append(grid,el('p','승인된 취소·반품은 미수금에, 실제 환불은 순수금에 반영됩니다. 영업비 상계는 같은 영업자의 다음 지급 승인에 적용됩니다.','help'));
   const id=crypto.randomUUID();
   supportSubmit(f,'조정 요청 저장',async()=>{
    const returns=kind.value==='return_goods';
    const productAction=returns||kind.value==='cancel_order';
    const updated=await rpc('erp_sales_request_adjustment',{p_sale_id:sale.id,p_request_id:id,
     p_kind:kind.value,p_reason:reason.value,p_detail:{
      line_id:returns?line.value||null:null,quantity:returns&&line.value?Number(quantity.value):null,
      credit_amount:returns?Number(credit.value):null,refund_plan:productAction?Number(refund.value):0,amount:productAction?null:Number(amount.value),
      commission_action:kind.value==='commission_change'?commission.value:null
     }});
    render(updated);report('조정 요청을 저장했습니다.');
    if(tab==='adjustments')await drawAdjustmentQueue().catch(()=>report('조정 요청을 저장했습니다. 조정 대기 조회를 다시 눌러 주세요.',true));
   });
   f.append(btn('닫기',()=>{if(f.dataset.dirty!=='true'||window.confirm('입력을 닫을까요?'))render(rows);}));
   return f;
  }
  function eventForm(rows,row,action){
   const f=el('form','','app-authoring');
   const grid=el('div','','erp-fields');
   const date=datedField(grid,'처리일');
   const note=field(grid,'event_note','처리 근거','text','',[],true);note.maxLength=500;
   const amount=action==='refund'?amountField(grid,'실제 환불액 (원)'):null;
   f.append(el('h5',adjustmentActions[action]),grid);
   const id=crypto.randomUUID();
   supportSubmit(f,'처리 저장',async()=>{
    const updated=await rpc('erp_sales_record_adjustment_event',{p_sale_id:sale.id,p_adjustment_id:row.id,
     p_request_id:id,p_action:action,p_on:date.value,p_note:note.value,p_amount:amount?Number(amount.value):null});
    render(updated);report('처리 내역을 저장했습니다.');
    if(tab==='adjustments')await drawAdjustmentQueue().catch(()=>report('처리 내역을 저장했습니다. 조정 대기 조회를 다시 눌러 주세요.',true));
    if(action==='approve'||action==='refund'){
     try{
      await refreshReceipts();
      if(tab==='receivables')await drawReceivables();
     }catch{report('처리 내역을 저장했습니다. 수금·미수금 조회를 다시 열어 주세요.',true);}
    }
   });
   f.append(btn('닫기',()=>{if(f.dataset.dirty!=='true'||window.confirm('입력을 닫을까요?'))render(rows);}));
   return f;
  }
 }
 function renderReconciliationPreview(host,sale,receipt){
  const form=el('form','','app-authoring');
  const grid=el('div','','erp-fields');
  const refunded=Number(receipt.refunded);
  const received=Number(receipt.received);
  const net=Number(receipt.net_received);
  const revised=amountField(grid,'검수용 조정 후 매출 (원)','0');
  revised.value=String(receipt.effective_total??sale.total_amount);
  const refund=amountField(grid,'검수용 추가 환불 (원)','0');
  refund.value='0';
  refund.max=String(Math.max(0,net));
  let nextFee,offset;
  if(sale.agent_id){
   nextFee=amountField(grid,'검수용 다음 영업비 (원)','0');
   offset=amountField(grid,'검수용 영업비 상계액 (원)','0');
   nextFee.value='0';
   offset.value='0';
  }
  const output=el('div','','erp-total');
  output.setAttribute('aria-live','polite');
  form.append(el('h5','정산 잔액 검수'),
   el('p','입력한 금액은 미리보기에만 사용됩니다. 원장 반영 기준을 확인하는 화면입니다.','help'),
   el('p','원매출 '+money(sale.total_amount)+' · 실제 수금 '+money(received)+' · 실제 환불 '+money(refunded),'help'),
   grid,output,btn('미리보기 닫기',()=>host.replaceChildren()));
  form.addEventListener('submit',event=>event.preventDefault());
  form.addEventListener('input',calculate);
  host.replaceChildren(form);
  calculate();

  function calculate(){
   if(offset)offset.max=String(Number(nextFee.value)||0);
   if(net<0){
    output.textContent='실제 환불이 현재 수금 기록을 초과합니다. 입금 정정 내역을 확인해 주세요.';
    return;
   }
   if(!form.checkValidity()){
    output.textContent='원 단위 금액을 확인해 주세요. 추가 환불은 현재 순수금, 상계는 다음 영업비를 초과할 수 없습니다.';
    return;
   }
   const projectedNet=net-Number(refund.value);
   const difference=Number(revised.value)-projectedNet;
   output.replaceChildren(el('p','예상 순수금 '+money(projectedNet)+' · 예상 미수금 '+money(Math.max(0,difference))+
    ' · 예상 초과 수금 '+money(Math.max(0,-difference))));
   if(offset)output.append(el('p','상계 후 예상 영업비 '+money(Number(nextFee.value)-Number(offset.value))));
  }
 }
 async function drawMonthClose(){
  const result=await rpc('erp_sales_get_month_close',{p_month:closeMonth+'-01'});
  if(tab!=='close')return;
  const search=el('form','','app-authoring');
  const grid=el('div','','erp-fields');
  const month=field(grid,'close_month','조회 월','month',closeMonth,[],true);
  search.append(grid);
  supportSubmit(search,'마감 이력 조회',async()=>{if(clearEditor()){closeMonth=month.value;await drawMonthClose();report('');}});
  body.replaceChildren(search,el('p',closeMonth+' · '+(result.closed?'마감됨':'열림'),'erp-total'),
   el('p','매출은 매출일, 입금·지급·증빙·조정은 해당 기록일의 월에 잠깁니다. 후속 거래는 해당 월에 기록할 수 있습니다.','help'));
  if(state.canWrite&&state.canConfirm)body.append(btn(result.closed?'예외 해제':'월 마감 처리',()=>{
   const parts=formStart(result.closed?'월 마감 예외 해제':'월 마감');
   if(!parts)return;
   const {f,grid}=parts;
   const note=field(grid,'close_reason','처리 사유','text','',[],true);note.maxLength=500;
   const id=crypto.randomUUID();
   supportSubmit(f,'마감 상태 저장',async()=>{
    await rpc('erp_sales_set_month_close',{p_month:closeMonth+'-01',p_request_id:id,p_closed:!result.closed,
     p_expected_closed:result.closed,p_reason:note.value});
    f.dataset.dirty='false';clearEditor();
    await drawMonthClose().catch(()=>{report('저장했습니다. 마감 이력을 다시 조회해 주세요.',true);});
   });
   f.append(btn('닫기',clearEditor));
  }));
  if(result.events.length)body.append(table(['처리','일시','사유'],result.events.map(row=>[
   row.closed?'마감':'예외 해제',new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(row.created_at)),row.reason
  ])));
 }
 function draw(){if(!body)return;body.replaceChildren();if(tab==='parties')drawMasters();else if(tab==='items')drawItems();else if(tab==='contracts')drawContracts();else if(tab==='sales')void run(drawSales);else if(tab==='receivables')void run(drawReceivables);else if(tab==='payouts')void run(drawPayoutQueue);else if(tab==='adjustments')void run(drawAdjustmentQueue);else if(tab==='purchases')void run(drawPurchases);else if(tab==='stock')void run(drawStock);else void run(drawMonthClose);}
 async function open(){if(!allowed())return;const generation=++epoch;const main=document.getElementById('dashboard-main');if(!main)return;root=el('section','','erp-sales');status=el('p','불러오는 중입니다.','message');status.setAttribute('role','status');status.tabIndex=-1;root.append(el('h2','기준정보·매출 관리'),status);main.replaceChildren(root);
  try{
   const [bootstrap,ready,purchasingReady,adjustmentsReady,queueReady,monthLookupReady,adjustmentQueueReady]=await Promise.all([
    rpc('erp_sales_bootstrap'),
    rpc('erp_sales_phase2_ready').catch(()=>false),
    rpc('erp_sales_phase3_ready').catch(()=>false),
    rpc('erp_sales_adjustments_ready').catch(()=>false),
    rpc('erp_sales_payout_queue_ready').catch(()=>false),
    rpc('erp_sales_contract_month_ready').catch(()=>false),
    rpc('erp_sales_adjustment_queue_ready').catch(()=>false)
   ]);
   if(generation!==epoch)return;
   state=bootstrap;
   phase2=ready===true;
   phase3=purchasingReady===true;
   phase4=adjustmentsReady===true;
   payoutQueue=ready===true&&queueReady===true;
   contractMonthLookup=monthLookupReady===true;
   adjustmentQueue=phase4&&adjustmentQueueReady===true;
   if(!adjustmentQueue&&tab==='adjustments')tab='sales';
   if(!payoutQueue&&tab==='payouts')tab='sales';
   if(!phase4&&tab==='close')tab='sales';
   if(!phase3&&['purchases','stock'].includes(tab))tab='sales';
   if(!phase2&&tab==='receivables')tab='sales';const tabs=el('div','','erp-tabs');tabs.setAttribute('role','tablist');body=el('div','','erp-body');body.setAttribute('role','tabpanel');body.id='erp-sales-panel';body.setAttribute('aria-labelledby','erp-tab-'+tab);editor=el('section','','erp-editor');
   for(const [key,label] of [['parties','거래처·영업자'],['items','품목·서비스'],['contracts','용역 계약'],['sales','매출·판매'],...(phase2?[['receivables','미수금']]:[]),...(payoutQueue?[['payouts','지급 대기']]:[]),...(phase3?[['purchases','구매·매입'],['stock','재고']]:[]),...(adjustmentQueue?[['adjustments','조정 대기']]:[]),...(phase4?[['close','월 마감']]:[])]){const button=btn(label,()=>{if(!clearEditor())return;tab=key;tabs.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;});body.setAttribute('aria-labelledby',button.id);draw();});button.id='erp-tab-'+key;button.setAttribute('role','tab');button.setAttribute('aria-controls','erp-sales-panel');button.tabIndex=tab===key?0:-1;button.setAttribute('aria-selected',String(tab===key));tabs.append(button);}
   tabs.addEventListener('keydown',event=>{const buttons=[...tabs.querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);if(i<0)return;const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowRight'?(i+1)%buttons.length:event.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:null;if(index===null)return;event.preventDefault();buttons[index].focus();buttons[index].click();if(buttons[index].getAttribute('aria-selected')!=='true')buttons[i].focus();});
   root.append(tabs,body,editor);report('');draw();
  }catch(e){report(errorText(e),true);root.append(btn('다시 조회',()=>void open()));}
 }
 function scrub(){if(root?.isConnected&&!allowed()){epoch++;state=null;root.replaceChildren(el('p','접근 권한을 다시 확인해 주세요.','message error'));}}
 for(const event of ['taejang-capabilities-ready','taejang-menu-authority-changed','taejang-app-ready'])document.addEventListener(event,scrub);
 window.TaejangErpSales={open,hasUnsavedChanges:()=>Boolean(root?.isConnected&&editor?.querySelector('form[data-dirty="true"]'))};
})();
