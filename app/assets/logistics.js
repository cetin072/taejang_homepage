/* The ERP owns auth/navigation. Logistics owns only its workspace and document. */
import './logistics-core.js';
const C=window.TaejangLogisticsCore;
const money=n=>Number(n||0).toLocaleString('ko-KR')+'원';
const el=(tag,value='',cls='')=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
let root,status,content,tabs,state,quote,confirmed=null,tab='quote',customer='',query='',page=0,busy=false,epoch=0,dirty=false,settingsDirty=false,pending=null,sessionOwner='';
const app=()=>window.TaejangApp;
const permitted=()=>C.allowed(app());
const actor=()=>app()?.getAccessContext?.()?.id||'';
const pendingKey=()=>`taejang-logistics-pending-v1:${actor()}`;
const clone=C.copy;
function report(text,error=false){if(!root?.isConnected)return;status.textContent=text;status.className='lg-status'+(error?' error':'');status.hidden=!text;}
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
async function read(){const generation=epoch,owner=actor();if(!permitted())throw Error('LOGISTICS_FORBIDDEN');const data=await app().rpc('get_logistics_workspace',{p_customer_id:customer||null,p_query:query,p_page:page});if(generation!==epoch||owner!==actor()||!permitted()||!root?.isConnected)throw Error('LOGISTICS_FORBIDDEN');state=data;return data;}
function persistPending(){if(pending)sessionStorage.setItem(pendingKey(),JSON.stringify(pending));else sessionStorage.removeItem(pendingKey());}
function applyResult(action,result){
 if(action==='quote.confirm'){confirmed=result.quote;quote=clone(result.quote.snapshot);dirty=false;tab='quote';customer=result.quote.customer_id;}
 if(action==='customer.save'){customer=result.customer.id;}
 if(action==='settings.save')settingsDirty=false;
}
async function mutate(action,payload){
 if(busy||!permitted())return;
 if(pending&&(pending.action!==action||JSON.stringify(pending.payload)!==JSON.stringify(payload))){report('미확인 저장 요청이 있습니다. 먼저 처리 결과를 확인하세요.',true);return;}
 pending=pending||{id:crypto.randomUUID(),action,payload:clone(payload)};
 try{persistPending();}catch{pending=null;report('임시 저장 공간을 사용할 수 없어 거래를 시작하지 않았습니다.',true);return;}
 busy=true;const generation=epoch,owner=actor();root.setAttribute('aria-busy','true');content.inert=true;
 try{
  const result=await app().rpc('mutate_logistics_workspace',{p_request_id:pending.id,p_action:pending.action,p_payload:pending.payload});
  if(generation!==epoch||owner!==actor()||!permitted()||!root?.isConnected)return;
  const done=pending.action;pending=null;persistPending();applyResult(done,result);
  try{await read();render();report('저장했습니다.');}catch(e){render();report('저장은 완료됐습니다. 목록은 새로고침으로 다시 확인하세요.',true);}
 }catch(e){
  if(generation!==epoch||owner!==actor())return;
  // Only a definite server rejection clears the idempotency key. Network/5xx keeps it.
  if(e?.status&&e.status<500){pending=null;persistPending();}
  report(message(e),true);showRetry();
 }finally{busy=false;if(root){root.removeAttribute('aria-busy');content.inert=false;}}
}
function showRetry(){root?.querySelector('[data-logistics-retry]')?.remove();if(!pending)return;const retry=button('저장 결과 확인 / 같은 요청 재시도',()=>mutate(pending.action,pending.payload));retry.dataset.logisticsRetry='1';status.after(retry);}
function newQuote(){if(dirty&&!confirm('작성 중인 입력을 버리고 새 견적을 만들까요?'))return;quote=C.draft(state.settings.data);quote.customerId=customer;confirmed=null;dirty=false;tab='quote';render();}
async function changeTab(next){if(busy)return;if(next!==tab&&tab==='settings'&&settingsDirty&&!confirm('저장하지 않은 단가 변경을 버릴까요?'))return;settingsDirty=false;tab=next;if(next==='customers'||next==='history'){try{await read();}catch(e){report(message(e),true);return;}}render();}
function render(){if(!permitted()||!root?.isConnected)return;tabs.querySelectorAll('button').forEach(b=>{const selected=b.dataset.tab===tab;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));});content.replaceChildren();showRetry();if(tab==='quote')renderQuote();else if(tab==='customers')renderCustomers();else if(tab==='history')renderHistory();else renderSettings();}
function rowCost(id,value){root.querySelectorAll(`[data-amount="${id}"]`).forEach(node=>node.textContent=value);}
function totals(){try{const t=C.calculate(quote);for(const line of t.lines)rowCost(line.key,money(line.amount));for(const key of ['workSubtotal','storageAmount','subtotal','supply','vat','platform','total'])rowCost(key,money(t[key]));
 const selected=state.customers.find(c=>c.id===quote.customerId);rowCost('balance',selected?money(selected.balance):'고객 미선택');rowCost('remaining',selected?money(selected.balance-t.total):'—');
 const b=root.querySelector('[data-confirm]');if(b)b.disabled=!quote.customerId||!!pending;return t;
 }catch(e){rowCost('total','입력 확인');const b=root.querySelector('[data-confirm]');if(b)b.disabled=true;return null;}}
function out(key,initial='—'){const n=el('output',initial);n.dataset.amount=key;return n;}
function quoteChange(){dirty=true;totals();}
function renderQuote(){
 if(!quote)quote=C.draft(state.settings.data);
 const actions=el('div','','lg-toolbar lg-no-print');actions.append(button('+ 새 견적',newQuote),el('span',confirmed?'확정 견적 · 원본 보존':'고객 선택 → 견적 확정 → PDF → 별도 차감','lg-muted'));
 content.append(actions);
 const sheet=el('article','','lg-panel lg-sheet');sheet.dataset.quoteSheet='1';
 const header=el('header','','lg-header'),title=el('div');title.append(el('h2','물류 견적서'),el('p',confirmed?.number||'견적번호 자동 발급','lg-muted'));header.append(title,el('div',quote.issuer,'lg-brand'));sheet.append(header);
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
 else{controls.append(button('고객용 PDF',printQuote,true),button('복사해 새 견적',()=>{confirmed=null;quote=clone(quote);delete quote.number;dirty=true;render();}));}
 sheet.append(controls);content.append(sheet);
 const wallet=el('section','','lg-panel lg-no-print');wallet.append(el('h3','고객 충전금'));
 for(const [key,label] of [['balance','현재 잔액'],['remaining','이번 견적 차감 후 잔액']]){const row=el('div','','lg-billrow');row.append(el('span',label),out(key));wallet.append(row);}
 if(confirmed){const charged=state.quotes.find(q=>q.id===confirmed.id)?.charged||confirmed.charged;const b=button(charged?'차감 기록 있음':'충전금에서 차감',()=>{if(confirm('이 견적 금액을 충전금에서 차감할까요?'))void mutate('wallet.charge',{quoteId:confirmed.id});},true);b.disabled=!!charged||Number(confirmed.total)===0;wallet.append(b);}
 content.append(wallet);
 if(confirmed)sheet.querySelectorAll('input,select').forEach(n=>n.disabled=true);
 totals();
}
function customerChoices(parent,onchange){field(parent,'고객',customer,v=>{customer=v;page=0;void reload();},{options:[['','전체 고객'],...state.customers.map(c=>[c.id,c.name])]});}
async function reload(){if(busy)return;try{await read();render();report('');}catch(e){report(message(e),true);}}
function renderCustomers(){
 const panel=el('section','','lg-panel'),head=el('div','','lg-toolbar');head.append(el('h3','고객 관리'),button('+ 고객 등록',()=>customerEditor()));panel.append(head);
 const stats=el('div','','lg-fields');for(const [label,value] of [['등록 고객',state.customers.length+'명'],['충전금 잔액 합계',money(state.customers.reduce((s,c)=>s+Number(c.balance),0))]]){const box=el('div','','lg-card');box.append(el('span',label,'lg-muted'),el('div',value,'lg-stat'));stats.append(box);}panel.append(stats);
 const search=el('input');search.type='search';search.placeholder='고객명 검색';search.setAttribute('aria-label','고객명 검색');search.className='lg-search';panel.append(search);const list=el('div');panel.append(list);const draw=()=>{list.replaceChildren(table(['고객명','연락처','충전 잔액','관리'],state.customers.filter(c=>c.name.includes(search.value)).map(c=>{const actions=el('div','','lg-actions');actions.append(button('선택',()=>{customer=c.id;page=0;void reload();}),button('수정',()=>customerEditor(c)),button('새 견적',()=>{customer=c.id;newQuote();}));return [c.name,c.phone||'—',money(c.balance),actions];})));};search.addEventListener('input',draw);draw();content.append(panel);
 if(customer){const c=state.customers.find(x=>x.id===customer);if(c)walletEditor(c);}
}
function customerEditor(c={}){
 const panel=el('form','','lg-panel');panel.append(el('h3',c.id?'고객 정보 수정':'고객 등록'));const data={id:c.id||null,name:c.name||'',phone:c.phone||'',memo:c.memo||'',revision:c.revision||0};const grid=el('div','','lg-fields');for(const [key,label] of [['name','고객명'],['phone','연락처'],['memo','메모']])field(grid,label,data[key],v=>data[key]=v);panel.append(grid);const actions=el('div','','lg-actions');actions.append(button('저장',()=>mutate('customer.save',data),true),button('닫기',()=>panel.remove()));panel.append(actions);panel.addEventListener('submit',e=>e.preventDefault());content.prepend(panel);panel.querySelector('input').focus();
}
function walletEditor(c){
 const panel=el('section','','lg-panel');panel.append(el('h3',c.name+' · 충전금'),el('p',money(c.balance),'lg-stat'));let type='deposit',amount='',memo='';const fields=el('div','','lg-fields');field(fields,'거래 종류',type,v=>type=v,{options:[['deposit','입금 확인 · 충전'],['manual','건별 작업비 차감']]});field(fields,'금액',amount,v=>amount=v,{type:'number',min:1});field(fields,'메모 / 작업 내용',memo,v=>memo=v);panel.append(fields,button('거래 기록',()=>{if(!memo.trim())return report('거래 메모를 입력하세요.',true);if(confirm(`${c.name}\n${type==='deposit'?'실제 입금 확인':'작업비 차감'}: ${money(amount)}\n기록할까요?`))void mutate(type==='deposit'?'wallet.deposit':'wallet.manual',{customerId:c.id,amount:Number(amount),memo});},true));content.append(panel);renderEntries(panel);
}
function renderEntries(parent){const rows=state.entries.map(t=>{const reverse=button(t.reversed||t.reversal_of?'정정 완료':'정정',()=>{const reason=prompt('정정 사유 (원 거래는 보존됩니다)');if(reason?.trim())void mutate('wallet.reverse',{entryId:t.id,reason:reason.trim()});});reverse.disabled=!!t.reversed||!!t.reversal_of;return [new Date(t.created_at).toLocaleString('ko-KR'),t.customer_name,t.reversal_of?'정정':t.type==='deposit'?'충전':'사용',(t.type==='deposit'?'+':'−')+money(t.amount),t.memo,t.actor,reverse];});parent.append(table(['일시','고객','구분','금액','메모','담당자','정정'],rows));}
function renderHistory(){
 const panel=el('section','','lg-panel');panel.append(el('h3','거래 내역'));const filters=el('div','','lg-fields');customerChoices(filters);const search=field(filters,'견적번호 / 고객 / 메모',query,v=>query=v);search.addEventListener('keydown',e=>{if(e.key==='Enter'){page=0;void reload();}});filters.append(button('조회',()=>{page=0;void reload();}));panel.append(filters,el('h3','확정 견적'));panel.append(table(['견적번호','고객','금액','담당자','충전금','보기'],state.quotes.map(q=>[q.number,q.snapshot.customerName,money(q.total),q.actor,q.charged?'차감 기록 있음':'미차감',button('견적 보기 / PDF',()=>{quote=clone(q.snapshot);confirmed=q;customer=q.customer_id;dirty=false;tab='quote';render();})])));panel.append(el('h3','충전 · 사용 · 정정'));renderEntries(panel);content.append(panel);pager(panel);
}
function pager(parent){const bar=el('div','','lg-pager'),back=button('이전',()=>{page--;void reload();}),next=button('다음',()=>{page++;void reload();});back.disabled=page===0;next.disabled=(page+1)*50>=Math.max(state.quoteCount,state.entryCount);bar.append(back,el('span',(page+1)+'페이지'),next);parent.append(bar);}
function renderSettings(){
 const panel=el('section','','lg-panel');panel.append(el('h3','기본 단가 설정'),el('p','새 견적부터 적용','lg-muted'));const data=clone(state.settings.data),fields=el('div','','lg-fields');field(fields,'견적서 발행업체',data.issuer,v=>{data.issuer=v;settingsDirty=true;});
 for(const [key,label] of [['shelf','선반 1칸 · 월'],['repack','재포장'],['individualLabel','개별 운송장'],['bundle','합포장'],['photo','사진·실측']])field(fields,label,data[key],v=>{data[key]=Number(v);settingsDirty=true;},{type:'number'});
 for(const [key,label] of Object.entries(C.BOXES))field(fields,label,data.boxes[key],v=>{data.boxes[key]=Number(v);settingsDirty=true;},{type:'number'});
 data.shipping.forEach((v,i)=>field(fields,'택배 '+(i+1)+'구간',v,n=>{data.shipping[i]=Number(n);settingsDirty=true;},{type:'number'}));panel.append(fields,button('기본 단가 저장',async()=>{await mutate('settings.save',{data,revision:state.settings.revision});},true));content.append(panel);
}
function printQuote(){
 if(!confirmed||!permitted())return;document.getElementById('logistics-print')?.remove();const printed=el('div','','lg');printed.id='logistics-print';const sheet=root.querySelector('[data-quote-sheet]').cloneNode(true);
 sheet.querySelectorAll('.lg-no-print,button').forEach(n=>n.remove());sheet.querySelectorAll('input[type=checkbox]').forEach(n=>n.closest('label')?.remove());sheet.querySelector('[aria-label="수수료율 (%)"]')?.closest('label')?.remove();if(!quote.feeEnabled)sheet.querySelector('[data-amount=platform]')?.closest('.lg-billrow')?.remove();sheet.querySelectorAll('input,select,textarea').forEach(n=>{const value=n.tagName==='SELECT'?n.selectedOptions[0]?.textContent:n.type==='checkbox'?(n.checked?'적용':'미적용'):n.value;const text=el('span',value||'—','lg-print-value');n.replaceWith(text);});
 printed.append(sheet);document.body.append(printed);document.body.classList.add('lg-printing');
 window.print();
}
window.addEventListener('afterprint',()=>{document.body.classList.remove('lg-printing');document.getElementById('logistics-print')?.remove();});
function revoke(){if(permitted()&&sessionOwner===actor())return;epoch++;pending=null;state=null;quote=null;confirmed=null;dirty=false;root?.replaceChildren(el('p','이 메뉴를 사용할 권한이 없습니다.'));document.getElementById('logistics-print')?.remove();document.body.classList.remove('lg-printing');}
for(const event of ['taejang-app-ready','taejang-capabilities-changed','taejang-menu-authority-changed'])document.addEventListener(event,revoke);
window.addEventListener('storage',event=>{if(event.key==='taejang-staff-session-v1')revoke();});
async function open(){
 if(!permitted())throw Error('LOGISTICS_FORBIDDEN');if(sessionOwner!==actor()){state=null;quote=null;confirmed=null;dirty=false;pending=null;tab='quote';customer='';query='';page=0;}sessionOwner=actor();epoch++;root=el('section','','lg');const host=document.getElementById('dashboard-main');host.replaceChildren(root);
 const head=el('header','','lg-toolbar');head.append(el('h2','물류 관리'),button('새로고침',reload));tabs=el('nav','','lg-tabs');tabs.setAttribute('aria-label','물류 업무');tabs.setAttribute('role','tablist');for(const [key,label] of [['quote','견적 작성'],['customers','고객 관리'],['history','거래 내역'],['settings','단가 설정']]){const b=button(label,()=>changeTab(key));b.dataset.tab=key;b.setAttribute('role','tab');tabs.append(b);}status=el('p','','lg-status');status.setAttribute('role','status');content=el('div');root.append(head,tabs,status,content);
 if(!document.querySelector('[data-logistics-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./logistics.css',import.meta.url).href;link.dataset.logisticsStyle='1';document.head.append(link);}
 try{const saved=sessionStorage.getItem(pendingKey());pending=saved?JSON.parse(saved):null;}catch{pending=null;}
 report('불러오는 중');try{await read();if(!quote)quote=C.draft(state.settings.data);render();report(pending?'미확인 저장 요청이 있습니다. 처리 결과를 확인하세요.':'');showRetry();}catch(e){report(message(e),true);}
}
window.TaejangLogistics={open,hasUnsavedChanges:()=>dirty||settingsDirty||!!pending};
