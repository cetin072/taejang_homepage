/* ERP V1 uses the existing shell, authoring styles and server-owned RPC permissions. */
(() => {
 'use strict';
 const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
 const money=v=>Number(v||0).toLocaleString('ko-KR')+'원';
 const taxChoices=[['taxable','과세 (세액 직접 입력)'],['exempt','면세'],['zero_rated','영세율']];
 const kinds={product:'상품',service:'용역',material:'원재료',packaging:'포장재',company:'기업',individual:'개인',draft:'작성 중',confirmed:'확정',active:'진행 중',ended:'종료',preparing:'배송 준비',shipped:'발송',delivered:'배송 완료',acquisition:'확보',management:'담당',support:'지원'};
 const allowed=()=>{const a=window.TaejangApp;return a?.hasCapabilityContract?.()&&a.can?.('erp_sales.read')&&a.getActualRoles?.().includes('operations_manager')&&a.getEffectiveRoles?.().includes('operations_manager')&&!a.getAccessContext?.()?.role_simulation?.active;};
 let root,status,body,editor,state,tab='parties',busy=false,epoch=0;
 const filters={from:today().slice(0,7)+'-01',to:today(),party:'',kind:'',status:'',agent:''};
 const report=(message,error=false)=>{if(!root?.isConnected)return;status.textContent=message;status.className=error?'message error':'message';status.hidden=!message;};
 function errorText(error){const m=String(error?.message||error);if(/PGRST202|does not exist|404/.test(m))return '이 환경은 매출 기능의 데이터 준비가 완료되지 않았습니다. 담당자에게 확인해 주세요.';
  if(/23505|duplicate|unique/.test(m))return '이미 등록된 정보입니다. 기존 거래처·품목 또는 계약 월 매출을 확인해 주세요.';
  const codes={ERP_FORBIDDEN:'이 기능을 사용할 권한이 없습니다.',ERP_REVISION_CONFLICT:'다른 화면에서 변경되었습니다. 입력을 보존했습니다. 새로 조회한 뒤 비교해 주세요.',ERP_SALE_CONFIRMED:'이미 확정된 거래는 원본을 수정할 수 없습니다.',ERP_AGENT_RELATION_REQUIRED:'매출일에 유효한 거래처·영업자 관계를 먼저 등록해 주세요.',ERP_INVALID_COMMISSION:'영업자와 거래별 영업비 조건을 확인해 주세요.',ERP_INVALID_CONTRACT_MONTH:'계약 기간과 매출 월을 확인해 주세요.',ERP_CONTRACT_NOT_ACTIVE:'진행 중인 계약과 해당 월을 확인해 주세요.',ERP_REQUEST_REUSE:'같은 저장 요청으로 이미 다른 내용이 저장되었습니다. 입력은 보존되니 매출 목록에서 기존 거래를 먼저 확인해 주세요.',ERP_INVALID_PERIOD:'조회 기간은 1년 이내로 지정해 주세요.'};
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
 function drawContracts(){if(state.canWrite)body.append(btn('용역 계약 등록',()=>masterEditor('contract'),true));body.append(table(['계약','거래처','기간','월 공급가 / 부가세','청구 기준','상태',''],state.contracts.map(r=>{const a=el('div','','erp-actions');a.append(btn(state.canWrite?'수정':'보기',()=>masterEditor('contract',r)));if(state.canWrite&&r.status==='active')a.append(btn('월 매출 생성',()=>monthEditor(r)));return [r.title,labelFor('parties',r.party_id),r.starts_on+' ~ '+r.ends_on,money(r.monthly_supply)+' / '+money(r.monthly_tax),r.billing_basis,kinds[r.status],a];})));}
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
  actions.append(btn('닫기',clearEditor));f.append(actions);
  f.addEventListener('submit',event=>{event.preventDefault();if(locked||!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));const lines=[...lineRows.children].map(row=>row.readLine());if(!lines.length){report('판매 품목을 한 개 이상 입력해 주세요.',true);return;}
   const payload={kind,request_key:requestKey,party_id:d.party_id,order_date:d.order_date,sales_date:d.sales_date,agent_id:d.agent_id||null,memo:d.memo,lines,
    commission:{kind:d.fee_kind,value:Number(d.fee_value),settlement_rule:d.settlement_rule,note:d.fee_note||''},
    ...(kind==='product'?{supplier_id:d.supplier_id,order_channel:d.order_channel,shipping_status:d.shipping_status}:{contract_id:data.contract_id,sales_month:data.sales_month})};
   void run(async()=>{const result=await rpc('erp_sales_save',{p_data:payload,p_id:data.id||null,p_revision:data.revision||0});f.dataset.dirty='false';saleEditor(result);if(tab==='sales')await drawSales();report('매출을 저장했습니다. 입력한 실제 단가와 조건이 보존됩니다.');});
  });
  if(sale?.id&&kind==='product'){
   const delivery=el('section','','app-form-section');delivery.append(el('h4','공급처 직배송 상태'),el('p',kinds[data.shippingCurrent||data.shipping_status]||'—'));const next=field(delivery,'next_shipping','배송 상태 기록','select',data.shippingCurrent||data.shipping_status,[['preparing','배송 준비'],['shipped','발송'],['delivered','배송 완료']]);
   if(state.canWrite)delivery.append(btn('배송 상태 저장',()=>{const value=next.value;void run(async()=>{const result=await rpc('erp_sales_shipping',{p_id:data.id,p_status:value});f.dataset.dirty='false';saleEditor(result);report('배송 상태를 이력으로 기록했습니다. 매출 원본은 유지됩니다.');});}));else next.disabled=true;editor.append(delivery);
  }
  if(sale?.id){const history=el('details');history.append(el('summary',`변경 이력 ${(data.history||[]).length}건`),table(['작업','일시','작업자'],(data.history||[]).map(h=>[({create:'등록',update:'수정',confirm:'확정',shipping:'배송 상태'})[h.action]||h.action,new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(h.created_at)),h.actor_id])));editor.append(history);}
 }
 async function drawSales(){const list=await rpc('erp_sales_list',{p_from:filters.from,p_to:filters.to,p_party_id:filters.party||null,p_kind:filters.kind||null,p_status:filters.status||null,p_agent_id:filters.agent||null});if(tab!=='sales')return;body.replaceChildren();
  const f=el('form','','app-authoring');const grid=el('div','','erp-fields');const inputs=[field(grid,'from','시작일','date',filters.from,[],true),field(grid,'to','종료일','date',filters.to,[],true),field(grid,'party','거래처','select',filters.party,[['','전체 거래처'],...state.parties.map(p=>[p.id,p.name])]),field(grid,'kind','상품·용역','select',filters.kind,[['','전체 유형'],['service','용역'],['product','상품']]),field(grid,'status','거래 상태','select',filters.status,[['','전체 상태'],['draft','작성 중'],['confirmed','확정']]),field(grid,'agent','영업자','select',filters.agent,[['','전체 영업자'],...state.agents.map(a=>[a.id,a.name])])];
  inputs.forEach(input=>input.addEventListener('change',()=>filters[input.name]=input.value));const search=el('button','조회','button primary');search.type='submit';f.append(grid,search);f.addEventListener('submit',e=>{e.preventDefault();if(f.reportValidity())void run(drawSales);});body.append(f);
  if(state.canWrite)body.append(btn('소금·상품 판매 등록',()=>saleEditor(),true));body.append(el('p',`총 ${list.total}건${list.total>list.limit?' 중 최신 '+list.limit+'건 표시 · 기간을 좁혀 조회하세요.':''}`));
  if(!list.items.length)body.append(el('p','해당 기간의 매출이 없습니다. 계약에서 월 매출을 생성하거나 상품 판매를 등록하세요.','message'));
  else body.append(table(['매출일','거래처','유형','영업자','상태','금액',''],list.items.map(s=>[s.sales_date,s.party_name,kinds[s.kind],s.agent_name||'—',kinds[s.status],money(s.total_amount),btn('상세',()=>void run(async()=>saleEditor(await rpc('erp_sales_get',{p_id:s.id}))))])));
 }
 function draw(){if(!body)return;body.replaceChildren();if(tab==='parties')drawMasters();else if(tab==='items')drawItems();else if(tab==='contracts')drawContracts();else void run(drawSales);}
 async function open(){if(!allowed())return;const generation=++epoch;const main=document.getElementById('dashboard-main');if(!main)return;root=el('section','','erp-sales');status=el('p','불러오는 중입니다.','message');status.setAttribute('role','status');status.tabIndex=-1;root.append(el('h2','기준정보·매출 관리'),status);main.replaceChildren(root);
  try{state=await rpc('erp_sales_bootstrap');if(generation!==epoch)return;const tabs=el('div','','erp-tabs');tabs.setAttribute('role','tablist');body=el('div','','erp-body');body.setAttribute('role','tabpanel');body.id='erp-sales-panel';body.setAttribute('aria-labelledby','erp-tab-'+tab);editor=el('section','','erp-editor');
   for(const [key,label] of [['parties','거래처·영업자'],['items','품목·서비스'],['contracts','용역 계약'],['sales','매출·판매']]){const button=btn(label,()=>{if(!clearEditor())return;tab=key;tabs.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;});body.setAttribute('aria-labelledby',button.id);draw();});button.id='erp-tab-'+key;button.setAttribute('role','tab');button.setAttribute('aria-controls','erp-sales-panel');button.tabIndex=tab===key?0:-1;button.setAttribute('aria-selected',String(tab===key));tabs.append(button);}
   tabs.addEventListener('keydown',event=>{const buttons=[...tabs.querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);if(i<0)return;const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowRight'?(i+1)%buttons.length:event.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:null;if(index===null)return;event.preventDefault();buttons[index].focus();buttons[index].click();if(buttons[index].getAttribute('aria-selected')!=='true')buttons[i].focus();});
   root.append(tabs,body,editor);report('');draw();
  }catch(e){report(errorText(e),true);root.append(btn('다시 조회',()=>void open()));}
 }
 function scrub(){if(root?.isConnected&&!allowed()){epoch++;state=null;root.replaceChildren(el('p','접근 권한을 다시 확인해 주세요.','message error'));}}
 for(const event of ['taejang-capabilities-ready','taejang-menu-authority-changed','taejang-app-ready'])document.addEventListener(event,scrub);
 window.TaejangErpSales={open,hasUnsavedChanges:()=>Boolean(root?.isConnected&&editor?.querySelector('form[data-dirty="true"]'))};
})();
