/* The ERP owns auth/navigation. Logistics owns only its workspace and document. */
import './logistics-core.js';
const C=window.TaejangLogisticsCore;
const money=n=>Number(n||0).toLocaleString('ko-KR')+'원';
const el=(tag,value='',cls='')=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
let root,status,content,tabs,state,quote,confirmed=null,tab='quote',customer='',query='',page=0,busy=false,epoch=0,dirty=false,settingsDirty=false,pending=null,sessionOwner='',customerSearch='',walletDirty=false,quoteReturn=null;
const app=()=>window.TaejangApp;
const permitted=()=>C.allowed(app());
const actor=()=>app()?.getAccessContext?.()?.id||'';
const pendingKey=()=>`taejang-logistics-pending-v1:${actor()}`;
const clone=C.copy;
function report(text,error=false,nearWallet=false){
 if(!root?.isConnected)return;
 const feedback=(nearWallet&&root.querySelector('[data-wallet-feedback]'))||status;
 if(feedback!==status){status.textContent='';status.hidden=true;}
 feedback.textContent=text;feedback.className='lg-status'+(error?' error':'');feedback.hidden=!text;
}
function message(error){const m=String(error?.message||error);const codes={LOGISTICS_FORBIDDEN:'이 메뉴는 부서팀장급 이상만 사용할 수 있습니다.',LOGISTICS_CONFLICT:'다른 직원이 변경했습니다. 입력은 보존했습니다. 새로고침 후 확인하세요.',LOGISTICS_FUNDS:'충전금이 부족합니다. 입금 확인 후 충전하세요.',LOGISTICS_DUPLICATE_CHARGE:'이미 차감한 견적입니다.',LOGISTICS_REVERSED:'이미 정정된 거래입니다.',LOGISTICS_REQUEST_REUSE:'저장 요청이 기존 기록과 다릅니다. 담당자에게 확인하세요.',LOGISTICS_CUSTOMER:'고객을 선택하거나 등록하세요.',LOGISTICS_INVALID:'입력값을 확인하세요.',LOGISTICS_DUPLICATE_CUSTOMER:'같은 이름의 고객이 이미 등록되어 있습니다.'};
 if(error?.code==='PGRST202'||/does not exist|Could not find the function/.test(m))return '물류 데이터 준비 전입니다. 운영 적용 후 사용할 수 있습니다.';
 return Object.entries(codes).find(([key])=>m.includes(key))?.[1]||'처리 결과를 확인하지 못했습니다. 입력은 보존했습니다.';
}
function button(label,fn,primary=false){const n=el('button',label,'lg-btn'+(primary?' lg-primary':''));n.type='button';n.addEventListener('click',()=>{if(!busy)void fn();});return n;}
function field(parent,label,value,onchange,{type='text',options=null,min=0,max=null,step='1'}={}){
 const wrap=el('label');wrap.append(el('span',label));const n=el(options?'select':'input');
 if(options)options.forEach(([v,t])=>n.append(new Option(t,v)));else{n.type=type;if(type==='number'){n.min=String(min);n.step=step;if(max!==null)n.max=String(max);}}
 if(type==='checkbox')n.checked=!!value;else n.value=value??'';
 n.setAttribute('aria-label',label);n.addEventListener(options||type==='checkbox'?'change':'input',()=>onchange(type==='checkbox'?n.checked:n.value,n));wrap.append(n);parent.append(wrap);return n;
}
function section(parent,no,title){const n=el('section','','lg-section');const h=el('h3');h.append(el('span',no,'lg-no'),document.createTextNode(title));n.append(h);parent.append(n);return n;}
function table(headers,rows){const wrap=el('div','','lg-table-wrap'),t=el('table'),thead=el('thead'),h=el('tr'),body=el('tbody');headers.forEach(x=>h.append(el('th',x)));thead.append(h);rows.forEach(row=>{const tr=el('tr');row.forEach(x=>{const td=el('td');td.append(x instanceof Node?x:document.createTextNode(String(x??'—')));tr.append(td);});body.append(tr);});t.append(thead,body);wrap.append(t);return wrap;}
async function read({selectedCustomer=customer,search=query,pageIndex=page}={}){const generation=epoch,owner=actor();if(!permitted())throw Error('LOGISTICS_FORBIDDEN');const data=await app().rpc('get_logistics_workspace',{p_customer_id:selectedCustomer||null,p_query:search,p_page:pageIndex});if(generation!==epoch||owner!==actor()||!permitted()||!root?.isConnected)throw Error('LOGISTICS_FORBIDDEN');state=data;return data;}
function persistPending(){if(pending)sessionStorage.setItem(pendingKey(),JSON.stringify(pending));else sessionStorage.removeItem(pendingKey());}
function applyResult(action,result){
 if(action==='quote.confirm'){confirmed=result.quote;quote=clone(result.quote.snapshot);dirty=false;tab='quote';customer=result.quote.customer_id;}
 if(action==='customer.save'){customer=result.customer.id;}
 if(action==='settings.save')settingsDirty=false;
}
async function mutate(action,payload){
 if(busy||!permitted())return;
 if(pending&&(pending.action!==action||JSON.stringify(pending.payload)!==JSON.stringify(payload))){report('미확인 저장 요청이 있습니다. 먼저 처리 결과를 확인하세요.',true,action.startsWith('wallet.'));return;}
 pending=pending||{id:crypto.randomUUID(),action,payload:clone(payload)};
 try{persistPending();}catch{pending=null;report('임시 저장 공간을 사용할 수 없어 거래를 시작하지 않았습니다.',true,action.startsWith('wallet.'));return;}
 busy=true;const generation=epoch,owner=actor();root.setAttribute('aria-busy','true');content.inert=true;
 try{
  const result=await app().rpc('mutate_logistics_workspace',{p_request_id:pending.id,p_action:pending.action,p_payload:pending.payload});
  if(generation!==epoch||owner!==actor()||!permitted()||!root?.isConnected)return;
  const done=pending.action;pending=null;persistPending();applyResult(done,result);
  try{await read();render();report('저장했습니다.',false,action.startsWith('wallet.'));}catch(e){render();report('저장은 완료됐습니다. 목록은 새로고침으로 다시 확인하세요.',true,action.startsWith('wallet.'));}
 }catch(e){
  if(generation!==epoch||owner!==actor())return;
  // Only a definite server rejection clears the idempotency key. Network/5xx keeps it.
  if(e?.status&&e.status<500){pending=null;persistPending();}
  report(message(e),true,action.startsWith('wallet.'));showRetry();
 }finally{busy=false;if(root){root.removeAttribute('aria-busy');content.inert=false;}}
}
function showRetry(){root?.querySelector('[data-logistics-retry]')?.remove();if(!pending)return;const retry=button('저장 결과 확인 / 같은 요청 재시도',()=>mutate(pending.action,pending.payload));retry.dataset.logisticsRetry='1';((pending.action.startsWith('wallet.')&&root.querySelector('[data-wallet-feedback]'))||status).after(retry);}
function newQuote(nextCustomer=customer){if(dirty&&!confirm('작성 중인 입력을 버리고 새 견적을 만들까요?'))return;customer=nextCustomer;quoteReturn=null;quote=C.draft(state.settings.data);quote.customerId=customer;confirmed=null;dirty=false;tab='quote';render();}
async function changeTab(next){
 if(busy||next===tab)return;
 if(tab==='customers'&&!leaveCustomerInputs())return;
 if(tab==='settings'&&settingsDirty&&!confirm('저장하지 않은 단가 변경을 버릴까요?'))return;
 if(next==='customers'||next==='history'){
  busy=true;
  try{await read(next==='customers'?{search:'',pageIndex:0}:undefined);}
  catch(error){report(message(error),true);return;}
  finally{busy=false;}
 }
 if(next==='customers'){query='';page=0;}
 settingsDirty=false;tab=next;quoteReturn=null;
 render();report('');
}
function render(){if(!permitted()||!root?.isConnected)return;walletDirty=false;tabs.querySelectorAll('button').forEach(b=>{const selected=b.dataset.tab===tab;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));});content.replaceChildren();if(tab==='quote')renderQuote();else if(tab==='customers')renderCustomers();else if(tab==='history')renderHistory();else renderSettings();showRetry();}
function rowCost(id,value){root.querySelectorAll(`[data-amount="${id}"]`).forEach(node=>node.textContent=value);}
function totals(){try{const t=confirmed&&quote.calculation?quote.calculation:C.calculate(quote);for(const line of t.lines)rowCost(line.key,money(line.amount));for(const key of ['workSubtotal','storageAmount','subtotal','supply','vat','platform','total'])rowCost(key,money(t[key]));
 const selected=state.customers.find(c=>c.id===quote.customerId);rowCost('balance',selected?money(selected.balance):'고객 미선택');rowCost('remaining',selected?money(Number(selected.balance)-(isCharged()?0:t.total)):'—');
 const summary=root.querySelector('[data-wallet-summary]');if(summary)summary.replaceChildren(walletSummary(selected,t.total));
 const b=root.querySelector('[data-confirm]');if(b)b.disabled=!quote.customerId||!!pending;return t;
 }catch(e){rowCost('total','입력 확인');const b=root.querySelector('[data-confirm]');if(b)b.disabled=true;return null;}}
function isCharged(){return !!(state.quotes.find(q=>q.id===confirmed?.id)?.charged||confirmed?.charged);}
function lowBalance(c){return Number(c.balance)<30000;}
function balanceDisplay(c){const box=el('span',money(c.balance));if(lowBalance(c))box.append(el('span','충전 안내 필요','lg-low-balance'));return box;}
function walletSummary(c,total){
 const box=el('div','','lg-wallet-summary');box.append(el('h3','고객 충전금'));
 if(!c){box.append(el('p','고객을 선택하세요.'));return box;}
 const row=(label,value)=>{const n=el('div','','lg-billrow');n.append(el('span',label),el('strong',value));box.append(n);};
 row('현재 충전 잔액',money(c.balance));
 if(lowBalance(c))box.append(el('p','충전 안내 필요 · 잔액 30,000원 미만','lg-low-balance lg-no-print'));
 const latest=c.latest_debit;
 row('최근 차감',latest?money(latest.amount)+' · '+new Date(latest.created_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}):c.latest_debit===null?'차감 내역 없음':'조회 정보 없음');
 row('이번 견적',money(total)+(isCharged()?' · 차감 기록 있음':' · 미차감'));
 if(!isCharged())row('이번 견적 차감 후 예상 잔액',money(Number(c.balance)-total));
 box.append(el('p','충전금은 조회 시점 기준이며, 견적 확정 당시 금액과 다를 수 있습니다. 정정된 차감은 최근 차감에서 제외합니다.','lg-help'));
 return box;
}
function out(key,initial='—'){const n=el('output',initial);n.dataset.amount=key;return n;}
function quoteChange(){dirty=true;totals();}
function renderQuote(){
 if(!quote)quote=C.draft(state.settings.data);
 const actions=el('div','','lg-toolbar lg-no-print');actions.append(button('+ 새 견적',newQuote),el('span',confirmed?'확정 당시 저장 내용 · PDF 재생성':'고객 선택 → 견적 확정 → 인쇄·PDF 저장 → 별도 차감','lg-muted'));
 if(quoteReturn)actions.append(button('거래 목록으로 돌아가기',()=>{if(dirty&&!confirm('작성 중인 견적을 버리고 거래 목록으로 돌아갈까요?'))return;tab=quoteReturn;quoteReturn=null;render();root.querySelector('[data-wallet-heading]')?.focus();}));
 content.append(actions);
 const sheet=el('article','','lg-panel lg-sheet');sheet.dataset.quoteSheet='1';
 const header=el('header','','lg-header'),title=el('div');title.append(el('h2','물류 견적서'),el('p',confirmed?.number||'견적번호 자동 발급','lg-muted'));header.append(title);sheet.append(header);
 const fields=el('div','','lg-fields');
 const choices=[['','고객 선택'],...state.customers.map(c=>[c.id,c.name])];
 if(confirmed){const label=el('label','고객명');label.append(el('span',quote.customerName));fields.append(label);}else field(fields,'고객명',quote.customerId,v=>{quote.customerId=v;customer=v;quoteChange();},{options:choices});
 field(fields,'견적일',quote.issueDate,v=>{quote.issueDate=v;quoteChange();},{type:'date'});
 field(fields,'유효기간',quote.validity,v=>{quote.validity=v;quoteChange();});sheet.append(fields);
 const route=section(sheet,'01','작업 범위와 진행 순서'),routeFields=el('div','','lg-route');
 field(routeFields,'입고지',quote.pickup,v=>{quote.pickup=v;quoteChange();});routeFields.append(el('span','→'));field(routeFields,'발송지',quote.dropoff,v=>{quote.dropoff=v;quoteChange();});route.append(routeFields);
 const work=section(sheet,'02','작업 내역');
 const quick=el('div','','lg-fields lg-no-print');
 const setQuantity=(keys,value)=>{quote.lines.filter(l=>keys.includes(l.key)).forEach(l=>{l.quantity=value;const input=root.querySelector(`[data-row="${l.key}"] .lg-qty input`);if(input)input.value=value;});dirty=true;totals();};
 field(quick,'개별 재포장 수량',quote.lines.find(l=>l.key==='repack').quantity,v=>setQuantity(['innerBox','repack','individualLabel'],v),{type:'number'}).addEventListener('focus',e=>e.target.select());
 field(quick,'최종 출고 박스 수',quote.lines.find(l=>l.key==='ship').quantity,v=>setQuantity(['bundle','outerBox','photo','ship'],v),{type:'number'});
 field(quick,'사진·실측 서비스',quote.photoMonth,v=>{quote.photoMonth=Number(v);dirty=true;render();},{options:[['1','첫 달 무료'],['2','이후 유료']]});
 work.append(quick);quick.style.marginBottom='10px';
 const tw=el('div','','lg-table-wrap'),t=el('table'),th=el('thead'),hr=el('tr');['No.','작업 항목','구분','수량','단가(원)','금액(원)'].forEach(x=>hr.append(el('th',x)));th.append(hr);t.append(th);const tbody=el('tbody');let stage=0;
 quote.lines.forEach((line,i)=>{
  if(stage!==line.stage){stage=line.stage;const sr=el('tr','','lg-stage'),td=el('td',C.STAGES[stage-1]);td.colSpan=6;sr.append(td);tbody.append(sr);}
  const tr=el('tr'),no=el('td',String(i+1).padStart(2,'0')),name=el('td','','lg-line-label'),kind=el('td'),qty=el('td','','lg-num lg-qty'),price=el('td','','lg-num lg-price'),amount=el('td','','lg-num');
  if(line.kind==='extra'&&!confirmed){field(name,'항목명',line.label,v=>{line.label=v;quoteChange();});name.append(button('삭제',()=>{quote.lines=quote.lines.filter(l=>l!==line);dirty=true;render();}));}else name.textContent=line.label;
  tr.dataset.row=line.key;const free=line.kind==='free'||line.kind==='photo'&&Number(quote.photoMonth)===1;kind.textContent=line.kind==='free'?'무료 서비스':free?'첫 달 무료':line.kind==='extra'?'추가 비용':'작업비 / 자재';if(free)kind.className='lg-free';
  if(line.kind==='free'){qty.textContent='—';price.textContent='무료';price.className+=' lg-free';}
  else if(confirmed){qty.textContent=line.quantity;price.textContent=money(line.unitPrice);}
  else{
   field(qty,'수량',line.quantity,v=>{line.quantity=v;quoteChange();},{type:'number'});
   if(['box','shipping'].includes(line.kind)){
    const options=line.kind==='box'?Object.entries(C.BOXES).map(([k,label])=>[k,label+' · '+money(state.settings.data.boxes[k])]):state.settings.data.shipping.map((p,i)=>['ship-'+i,(i+1)+'구간 · '+money(p)]);
    options.push(['manual','직접 입력']);const chosen=line.option||(line.kind==='shipping'?('ship-'+state.settings.data.shipping.indexOf(Number(line.unitPrice))):'manual');
    field(price,'규격 / 운임',options.some(o=>o[0]===chosen)?chosen:'manual',v=>{line.option=v;if(v!=='manual')line.unitPrice=line.kind==='box'?state.settings.data.boxes[v]:state.settings.data.shipping[Number(v.slice(5))];dirty=true;render();},{options});
    if(line.option==='manual'||!options.some(o=>o[0]===chosen))field(price,'직접 단가',line.unitPrice,v=>{line.unitPrice=v;quoteChange();},{type:'number'});
   }else field(price,'단가',line.unitPrice,v=>{line.unitPrice=v;quoteChange();},{type:'number'});
  }
  qty.querySelectorAll('label>span').forEach(n=>n.hidden=true);price.querySelectorAll('label>span').forEach(n=>n.hidden=true);amount.append(out(line.key));tr.append(no,name,kind,qty,price,amount);tbody.append(tr);
 });t.append(tbody);tw.append(t);work.append(tw);
 if(!confirmed){const extra=button('+ 기타 항목 추가',()=>{if(quote.lines.length>=52)return report('기타 항목은 최대 40개입니다.',true);quote.lines.push({key:'extra-'+crypto.randomUUID(),stage:5,label:'기타 비용',kind:'extra',quantity:1,unitPrice:0});dirty=true;render();});extra.classList.add('lg-no-print');work.append(extra);}
 const storage=section(sheet,'03','선반 보관료'),shelf=el('div','','lg-shelf');
 for(const [key,label,min] of [['shelves','사용 칸 수',0],['startMonth','시작 월차',1],['months','청구 개월',1],['rate','칸당 월 단가',0]])field(shelf,label,quote.storage[key],v=>{quote.storage[key]=v;quoteChange();},{type:'number',min});shelf.append(out('storageAmount'));storage.append(shelf,el('p','기본 1칸 최초 3개월 무료 · 추가 칸은 첫 달부터 과금','lg-help'));
 const tax=section(sheet,'04','부가세 적용');field(tax,'금액 기준',quote.vatMode,v=>{quote.vatMode=v;quoteChange();},{options:[['exclusive','부가세 별도 (+10%)'],['inclusive','부가세 포함']]});
 const summary=section(sheet,'05','금액 계산'),grid=el('div','','lg-summary'),left=el('div','','lg-card'),right=el('div','','lg-card');
 for(const [key,label] of [['workSubtotal','작업 · 자재 · 택배'],['storageAmount','선반 보관료'],['subtotal','소계']]){const r=el('div','','lg-billrow');r.append(el('span',label),out(key));left.append(r);}
 field(left,'할인액',quote.discount,v=>{quote.discount=v;quoteChange();},{type:'number'});
 const fee=field(left,'플랫폼 수수료 적용',quote.feeEnabled,v=>{quote.feeEnabled=v;quoteChange();},{type:'checkbox'});fee.parentElement.classList.add('lg-check');field(left,'수수료율 (%)',quote.feeRate,v=>{quote.feeRate=v;quoteChange();},{type:'number',max:100,step:'0.01'});
 for(const [key,label] of [['supply','공급가액'],['vat','부가세 (10%)'],['platform','플랫폼 수수료']]){const r=el('div','','lg-billrow');r.append(el('span',label),out(key));right.append(r);}
 const total=el('div','','lg-total'),strong=el('strong');strong.append(out('total'));total.append(el('span','최종 견적금액'),strong);right.append(total);grid.append(left,right);summary.append(grid);
 const controls=el('div','','lg-actions lg-section lg-no-print');
 if(!confirmed){const confirmButton=button('금액 확정하기',()=>{const calc=totals();if(!calc||!quote.customerId)return;void mutate('quote.confirm',{quote:clone(quote)});},true);confirmButton.dataset.confirm='1';controls.append(confirmButton);}
 else{controls.append(button('견적서 인쇄 / PDF 저장',printQuote,true),button('복사해 새 견적',()=>{confirmed=null;quote=clone(quote);delete quote.number;dirty=true;render();}));}
 sheet.append(controls);
 if(confirmed)sheet.append(el('p','보관된 원본 PDF 파일이 아닌 확정 당시 저장 내용으로 다시 생성합니다. 인쇄창에서 PDF로 저장을 선택하세요. A4 · 배율 100% · 머리글/바닥글 해제 권장.','lg-help lg-no-print'));
 content.append(sheet);
 const wallet=el('section','','lg-panel lg-no-print');wallet.append(el('h3','고객 충전금'));
 const walletBody=el('div');walletBody.dataset.walletSummary='1';wallet.replaceChildren(walletBody);
 if(confirmed){const charged=state.quotes.find(q=>q.id===confirmed.id)?.charged||confirmed.charged;const b=button(charged?'차감 기록 있음':'충전금에서 차감',()=>{if(confirm('이 견적 금액을 충전금에서 차감할까요?'))void mutate('wallet.charge',{quoteId:confirmed.id});},true);b.disabled=!!charged||Number(confirmed.total)===0;wallet.append(b);}
 content.append(wallet);
 if(confirmed)sheet.querySelectorAll('input,select').forEach(n=>n.disabled=true);
 totals();
}
function customerChoices(parent,onchange){field(parent,'고객',customer,v=>{customer=v;page=0;void reload();},{options:[['','전체 고객'],...state.customers.map(c=>[c.id,c.name])]});}
async function reload(){if(busy)return;try{await read();render();report('');}catch(e){report(message(e),true);}}
function leaveCustomerInputs(){
 if(pending){report('미확인 저장 요청이 있습니다. 먼저 처리 결과를 확인하세요.',true,true);return false;}
 return !(walletDirty||content.querySelector('[data-customer-editor]'))||confirm('저장하지 않은 입력을 버리고 이동할까요?');
}
async function selectCustomer(id){
 if(busy)return;
 if(id===customer){root.querySelector('[data-wallet-heading]')?.focus();return;}
 if(!leaveCustomerInputs())return;
 const previous=customer,previousPage=page,generation=epoch;busy=true;customer=id;page=0;
 root.setAttribute('aria-busy','true');content.inert=true;
 try{await read();render();report('');content.inert=false;const heading=root.querySelector('[data-wallet-heading]');heading?.focus();heading?.scrollIntoView({block:'nearest'});}
 catch(e){if(generation===epoch){customer=previous;page=previousPage;report(message(e),true);}}
 finally{busy=false;root?.removeAttribute('aria-busy');content.inert=false;}
}
function renderCustomers(){
 const panel=el('section','','lg-panel'),head=el('div','','lg-toolbar');head.append(el('h3','고객 관리'),button('+ 고객 등록',()=>customerEditor()));panel.append(head);
 const stats=el('div','','lg-fields');for(const [label,value] of [['등록 고객',state.customers.length+'명'],['충전금 잔액 합계',money(state.customers.reduce((s,c)=>s+Number(c.balance),0))]]){const box=el('div','','lg-card');box.append(el('span',label,'lg-muted'),el('div',value,'lg-stat'));stats.append(box);}panel.append(stats);
 const low=state.customers.filter(lowBalance).length;if(low)panel.append(el('p','충전 안내 필요 '+low+'명 · 잔액 30,000원 미만','lg-low-balance'));
 panel.append(el('p','고객 행을 누르면 충전·사용 내역을 볼 수 있습니다.','lg-help'));
 const search=el('input');search.type='search';search.placeholder='고객명 검색';search.setAttribute('aria-label','고객명 검색');search.className='lg-search';search.value=customerSearch;panel.append(search);
 const list=el('div');panel.append(list);
 const draw=()=>{
  const customers=state.customers.filter(c=>c.name.includes(search.value));
  const grid=table(['고객명','연락처','충전 잔액','관리'],customers.map(c=>{
   const name=button(c.name,()=>selectCustomer(c.id));name.classList.add('lg-customer-name');name.setAttribute('aria-label',c.name+' 충전·사용 내역 보기');name.setAttribute('aria-pressed',String(c.id===customer));
   const actions=el('div','','lg-actions');actions.append(button('충전·사용',()=>selectCustomer(c.id)),button('수정',()=>customerEditor(c)),button('새 견적',()=>{if(!leaveCustomerInputs())return;newQuote(c.id);}));
   return [name,c.phone||'—',balanceDisplay(c),actions];
  }));
  grid.querySelectorAll('tbody tr').forEach((row,i)=>{
   const c=customers[i];row.classList.add('lg-customer-row');row.classList.toggle('is-selected',c.id===customer);
   if(c.id===customer)row.cells[0].append(el('span','선택됨','lg-selected-label'));
   row.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea,label,[role="button"]'))return;void selectCustomer(c.id);});
  });list.replaceChildren(grid);
 };
 search.addEventListener('input',()=>{customerSearch=search.value;draw();});draw();content.append(panel);
 if(customer){const c=state.customers.find(x=>x.id===customer);if(c)walletEditor(c);}
}
function customerEditor(c={}){
 const trigger=document.activeElement;
 const panel=el('form','','lg-panel');panel.dataset.customerEditor='1';panel.append(el('h3',c.id?'고객 정보 수정':'고객 등록'));const data={id:c.id||null,name:c.name||'',phone:c.phone||'',memo:c.memo||'',revision:c.revision||0};const grid=el('div','','lg-fields');for(const [key,label] of [['name','고객명'],['phone','연락처'],['memo','메모']])field(grid,label,data[key],v=>data[key]=v);panel.append(grid);const actions=el('div','','lg-actions');actions.append(button('저장',()=>mutate('customer.save',data),true),button('닫기',()=>{panel.remove();if(trigger?.isConnected)trigger.focus();}));panel.append(actions);panel.addEventListener('submit',e=>e.preventDefault());content.prepend(panel);panel.querySelector('input').focus();
}
function walletEditor(c){
 const panel=el('section','','lg-panel');
 const heading=el('h3',c.name+' · 충전금');heading.tabIndex=-1;heading.dataset.walletHeading='1';const amountDisplay=balanceDisplay(c);amountDisplay.classList.add('lg-stat');panel.append(heading,amountDisplay);
 const form=el('form'),fields=el('div','','lg-fields');form.addEventListener('input',()=>walletDirty=true);form.addEventListener('change',()=>walletDirty=true);
 let type='deposit',amount='',memo='';
 field(fields,'거래 종류',type,value=>{type=value;update();},{options:[['deposit','입금 확인 · 충전'],['manual','건별 작업비 차감']]});
 const amountInput=field(fields,'금액 (원)',amount,value=>{amount=value;update();},{type:'number',min:1,max:1000000000000});
 amountInput.required=true;
 const memoInput=field(fields,'메모 (선택)',memo,value=>memo=value);
 memoInput.maxLength=500;
 const preview=el('p','','lg-help');
 const save=button('충전금 저장',()=>{},true);
 save.type='submit';
 const actions=el('div','','lg-actions');actions.append(save);
 const feedback=el('p','','lg-status');feedback.dataset.walletFeedback='1';feedback.setAttribute('role','status');feedback.hidden=true;
 function update(){
  const deposit=type==='deposit';
  save.textContent=deposit?'충전금 저장':'작업비 차감 저장';
  const memoLabel=deposit?'메모 (선택)':'작업 내용 (필수)';
  memoInput.previousElementSibling.textContent=memoLabel;
  memoInput.setAttribute('aria-label',memoLabel);memoInput.required=!deposit;
  const value=Number(amount);
  preview.textContent=Number.isSafeInteger(value)&&value>0
   ? `${deposit?'입금':'차감'} ${money(value)} · 저장 후 잔액 ${money(Number(c.balance)+(deposit?value:-value))}`
   : '실제 입금된 금액을 입력한 뒤 저장해 주세요.';
 }
 form.addEventListener('submit',event=>{
  event.preventDefault();
  if(busy||!form.reportValidity())return;
  const note=memo.trim()||(type==='deposit'?'입금 확인 · 충전':'');
  if(!note){memoInput.focus();report('작업 내용을 입력하세요.',true,true);return;}
  if(confirm(`${c.name}\n${type==='deposit'?'입금 확인 · 충전':'작업비 차감'} ${money(amount)}\n저장할까요?`))
   void mutate(type==='deposit'?'wallet.deposit':'wallet.manual',{customerId:c.id,amount:Number(amount),memo:note});
 });
 update();form.append(fields,preview,actions,feedback);panel.append(form);content.append(panel);renderEntries(panel);pager(panel);
}

async function openEntryQuote(entry){
 if(busy||!entry.quote_id||!leaveCustomerInputs())return;
 const generation=epoch,owner=actor();busy=true;root.setAttribute('aria-busy','true');content.inert=true;
 try{
  let found=state.quotes.find(q=>q.id===entry.quote_id&&q.customer_id===entry.customer_id);
  for(let index=0;!found;index++){
   const data=await app().rpc('get_logistics_workspace',{p_customer_id:entry.customer_id,p_query:'',p_page:index});
   if(generation!==epoch||owner!==actor()||!permitted()||!root?.isConnected)return;
   found=data.quotes.find(q=>q.id===entry.quote_id&&q.customer_id===entry.customer_id);
   if((index+1)*50>=data.quoteCount)break;
  }
  if(!found?.snapshot?.calculation){report('이 거래의 확정 당시 저장 내용을 찾을 수 없습니다. 원본 PDF는 보관되지 않아 복원할 수 없습니다.',true,true);return;}
  if(dirty&&!confirm('작성 중인 견적을 버리고 확정 견적을 볼까요?'))return;
  quoteReturn=tab;quote=clone(found.snapshot);confirmed=found;dirty=false;tab='quote';render();content.inert=false;
  const heading=root.querySelector('[data-quote-sheet] h2');heading.tabIndex=-1;heading.focus();
 }catch(e){report(message(e),true,true);}
 finally{busy=false;root?.removeAttribute('aria-busy');content.inert=false;}
}
function renderEntries(parent){
 const rows=state.entries.map(t=>{
  const reverse=button(t.reversed||t.reversal_of?'정정 완료':'정정',()=>{const reason=prompt('정정 사유 (원 거래는 보존됩니다)');if(reason?.trim())void mutate('wallet.reverse',{entryId:t.id,reason:reason.trim()});});reverse.disabled=!!t.reversed||!!t.reversal_of;
  const view=t.quote_id?button('확정 견적 / PDF',()=>openEntryQuote(t)):el('span',t.source==='manual'?'수기 사용 · 연결 견적 없음':'연결 견적 없음','lg-muted');
  return [new Date(t.created_at).toLocaleString('ko-KR'),t.customer_name,t.reversal_of?'정정':t.type==='deposit'?'충전':'사용',(t.type==='deposit'?'+':'−')+money(t.amount),t.memo,t.actor,view,reverse];
 });const grid=table(['일시','고객','구분','금액','메모','담당자','확정 견적','정정'],rows);
 grid.querySelectorAll('tbody tr').forEach((row,i)=>{const entry=state.entries[i];if(!entry.quote_id)return;row.classList.add('lg-entry-row');row.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea,[role="button"]'))return;void openEntryQuote(entry);});});parent.append(grid);
}
function renderHistory(){
 const panel=el('section','','lg-panel');panel.append(el('h3','거래 내역'));const filters=el('div','','lg-fields');customerChoices(filters);const search=field(filters,'견적번호 / 고객 / 메모',query,v=>query=v);search.addEventListener('keydown',e=>{if(e.key==='Enter'){page=0;void reload();}});filters.append(button('조회',()=>{page=0;void reload();}));panel.append(filters,el('h3','확정 견적'));panel.append(table(['견적번호','고객','금액','담당자','충전금','보기'],state.quotes.map(q=>[q.number,q.snapshot.customerName,money(q.total),q.actor,q.charged?'차감 기록 있음':'미차감',button('견적 보기 / 인쇄',()=>{quote=clone(q.snapshot);confirmed=q;customer=q.customer_id;dirty=false;tab='quote';render();})])));panel.append(el('h3','충전 · 사용 · 정정'));renderEntries(panel);content.append(panel);pager(panel);
}
function pager(parent){const bar=el('div','','lg-pager'),back=button('이전',()=>{if(tab==='customers'&&!leaveCustomerInputs())return;page--;void reload();}),next=button('다음',()=>{if(tab==='customers'&&!leaveCustomerInputs())return;page++;void reload();});back.disabled=page===0;next.disabled=(page+1)*50>=(tab==='customers'?state.entryCount:Math.max(state.quoteCount,state.entryCount));bar.append(back,el('span',(page+1)+'페이지'),next);parent.append(bar);}
function renderSettings(){
 const panel=el('section','','lg-panel');panel.append(el('h3','기본 단가 설정'),el('p','새 견적부터 적용','lg-muted'));const data=clone(state.settings.data),fields=el('div','','lg-fields');
 for(const [key,label] of [['shelf','선반 1칸 · 월'],['repack','재포장'],['individualLabel','개별 운송장'],['bundle','합포장'],['photo','사진·실측']])field(fields,label,data[key],v=>{data[key]=Number(v);settingsDirty=true;},{type:'number'});
 for(const [key,label] of Object.entries(C.BOXES))field(fields,label,data.boxes[key],v=>{data.boxes[key]=Number(v);settingsDirty=true;},{type:'number'});
 data.shipping.forEach((v,i)=>field(fields,'택배 '+(i+1)+'구간',v,n=>{data.shipping[i]=Number(n);settingsDirty=true;},{type:'number'}));panel.append(fields,button('기본 단가 저장',async()=>{await mutate('settings.save',{data,revision:state.settings.revision});},true));content.append(panel);
}
async function printQuote(){
 if(!confirmed||!permitted()||pending)return;
 const generation=epoch,owner=actor(),id=confirmed.id;
 busy=true;content.inert=true;
 try{
  const fresh=await app().rpc('get_logistics_workspace',{p_customer_id:confirmed.customer_id,p_query:confirmed.number,p_page:0});
  if(generation!==epoch||owner!==actor()||!permitted()||!root?.isConnected||confirmed?.id!==id)return;
  const current=fresh.quotes.find(q=>q.id===id),c=fresh.customers.find(c=>c.id===confirmed.customer_id);
  if(!current||!c||!Object.hasOwn(c,'latest_debit'))throw Error('WALLET_SUMMARY_UNAVAILABLE');
  state.customers=fresh.customers;confirmed={...confirmed,charged:current.charged};
  state.quotes=state.quotes.map(q=>q.id===id?{...q,charged:current.charged}:q);totals();
 }catch{report('충전금 최신 정보를 확인하지 못해 인쇄를 중단했습니다. 다시 시도해 주세요.',true);return;}
 finally{busy=false;if(content)content.inert=false;}
 document.getElementById('logistics-print')?.remove();const printed=el('div','','lg');printed.id='logistics-print';const source=root.querySelector('[data-quote-sheet]'),sheet=source.cloneNode(true);
 // cloneNode does not preserve the live selection of a select element.
 const selections=source.querySelectorAll('select');sheet.querySelectorAll('select').forEach((n,i)=>{n.value=selections[i].value;});
 sheet.querySelectorAll('.lg-no-print,button').forEach(n=>n.remove());sheet.querySelectorAll('input[type=checkbox]').forEach(n=>n.closest('label')?.remove());sheet.querySelector('[aria-label="수수료율 (%)"]')?.closest('label')?.remove();if(!quote.feeEnabled)sheet.querySelector('[data-amount=platform]')?.closest('.lg-billrow')?.remove();sheet.querySelectorAll('input,select,textarea').forEach(n=>{const value=n.tagName==='SELECT'?n.selectedOptions[0]?.textContent:n.type==='checkbox'?(n.checked?'적용':'미적용'):n.value;const text=el('span',value||'—','lg-print-value');n.replaceWith(text);});
 const summary=root.querySelector('[data-wallet-summary]').firstElementChild.cloneNode(true);
 summary.querySelectorAll('.lg-no-print').forEach(n=>n.remove());summary.append(el('p','조회: '+new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' (한국시간)','lg-help'));sheet.append(summary);
 printed.append(sheet);document.body.append(printed);document.body.classList.add('lg-printing');
 try{window.print();}catch{clearPrint();report('인쇄창을 열지 못했습니다. 다시 눌러 주세요.',true);}
}
function clearPrint(){document.body.classList.remove('lg-printing');document.getElementById('logistics-print')?.remove();}
window.addEventListener('afterprint',clearPrint);
function revoke(){if(permitted()&&sessionOwner===actor())return;epoch++;pending=null;state=null;quote=null;confirmed=null;dirty=false;root?.replaceChildren(el('p','이 메뉴를 사용할 권한이 없습니다.'));clearPrint();}
for(const event of ['taejang-app-ready','taejang-capabilities-changed','taejang-menu-authority-changed'])document.addEventListener(event,revoke);
window.addEventListener('storage',event=>{if(event.key==='taejang-staff-session-v1')revoke();});
async function open(){
 if(!permitted())throw Error('LOGISTICS_FORBIDDEN');if(sessionOwner!==actor()){state=null;quote=null;confirmed=null;dirty=false;pending=null;tab='quote';customer='';query='';page=0;customerSearch='';quoteReturn=null;}sessionOwner=actor();epoch++;root=el('section','','lg');const host=document.getElementById('dashboard-main');host.replaceChildren(root);
 const head=el('header','','lg-toolbar');head.append(el('h2','물류 관리'),button('새로고침',reload));tabs=el('nav','','lg-tabs');tabs.setAttribute('aria-label','물류 업무');tabs.setAttribute('role','tablist');for(const [key,label] of [['quote','견적 작성'],['customers','고객 관리'],['history','거래 내역'],['settings','단가 설정']]){const b=button(label,()=>changeTab(key));b.dataset.tab=key;b.setAttribute('role','tab');tabs.append(b);}status=el('p','','lg-status');status.setAttribute('role','status');content=el('div');root.append(head,tabs,status,content);
 if(!document.querySelector('[data-logistics-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./logistics.css',import.meta.url).href;link.dataset.logisticsStyle='1';document.head.append(link);}
 try{const saved=sessionStorage.getItem(pendingKey());pending=saved?JSON.parse(saved):null;}catch{pending=null;}
 report('불러오는 중');try{await read();if(!quote)quote=C.draft(state.settings.data);render();report(pending?'미확인 저장 요청이 있습니다. 처리 결과를 확인하세요.':'');showRetry();}catch(e){report(message(e),true);}
}
window.TaejangLogistics={open,hasUnsavedChanges:()=>dirty||settingsDirty||!!pending};
