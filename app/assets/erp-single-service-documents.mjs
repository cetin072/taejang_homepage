import {printErpPdf} from './erp-pdf.mjs';

const dayInSeoul = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul'}).format(new Date());
const money = new Intl.NumberFormat('ko-KR');
function el(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action, primary = false) {
  const node = el('button', label, 'button mcd-button' + (primary ? ' primary' : ''));
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function field(group, label, type, value, {required = false, limit} = {}) {
  const wrap = el('label', label, 'mcd-field');
  const input = el(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = value ?? '';
  input.required = required;
  if (limit) input.maxLength = limit;
  wrap.append(input);
  group.append(wrap);
  return input;
}
function preview(frame, record, kind, ready) {
  const quote = kind === 'quote';
  const heading = quote ? '용역 견적서' : '용역 수행 결과보고서';
  const date = quote ? record.quote_on : record.performed_on;
  frame.title = heading + ' 미리보기';
  frame.hidden = false;
  frame.onload = () => {
    const doc = frame.contentDocument;
    if (!doc || frame.hidden) return;
    doc.body.append(el('h1', heading), el('p', '수신  ' + record.customer),
      el('p', (quote ? '견적일  ' : '수행일  ') + date), el('h2', record.title),
      el('h3', quote ? '용역 범위' : '수행 내용'), el('p', quote ? record.quote_scope : record.report_body));
    if (quote) doc.body.append(el('p', '견적 금액  ' + money.format(record.quote_amount) + '원'));
    doc.body.append(el('p', '농업회사법인 태장 주식회사'));
    ready(() => printErpPdf(record.customer, date, undefined, frame.contentWindow));
  };
  frame.srcdoc = '<!doctype html><html lang="ko"><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:14px/1.65 system-ui,sans-serif;margin:18px;overflow-wrap:anywhere}h1{margin-top:0;border-bottom:2px solid #21483a;padding-bottom:10px;color:#21483a}p{white-space:pre-wrap}h2,h3{margin-bottom:6px}h3+p{margin-top:0}</style><body></body></html>';
}
function errorMessage(error) {
  const message = String(error?.message || error);
  if (error?.code === 'PGRST202' || /Could not find the function/.test(message)) return '이 환경에 단건 의뢰 저장 기능이 아직 적용되지 않았습니다.';
  if (message.includes('ERP_WORKSPACE_REVISION_CONFLICT')) return '다른 사람이 의뢰를 수정했습니다. 입력 내용을 확인하고 목록에서 최신 기록을 다시 여세요.';
  return '요청을 처리하지 못했습니다. 입력값이나 연결을 확인해 주세요.';
}

export function mountSingleServiceDocuments(host, rpc) {
  const status = el('p', '', 'message');
  status.setAttribute('role','status');
  const toolbar = el('div', '', 'mcd-actions');
  const search = el('form', '', 'mcd-actions');
  const query = field(search, '거래처·의뢰명 검색', 'search', '', {limit:200});
  const find = el('button','조회','button mcd-button');
  find.type = 'submit';
  search.append(find);
  const list = el('div');
  const create = button('+ 단건 의뢰',()=>openEditor(),true);
  create.disabled = true;
  toolbar.append(search,create);
  host.replaceChildren(el('h2','단건 의뢰'),toolbar,status,list);
  let offset = 0, request = 0, dialog, dirty = false, busy = false, customers = [];

  search.addEventListener('submit', event => { event.preventDefault(); offset = 0; void load(); });
  async function load() {
    const version = ++request;
    status.textContent = '의뢰를 불러오는 중입니다.';
    try {
      const result = await rpc('erp_list_single_service_cases',{p_query:query.value,p_offset:offset});
      if (!host.isConnected || version !== request) return;
      create.disabled = false;
      customers = result.customers;
      drawList(result.cases);
      status.textContent = '';
    } catch (error) {
      if (!host.isConnected || version !== request) return;
      status.textContent = errorMessage(error);
      list.replaceChildren(button('다시 조회',()=>void load()));
    }
  }
  function drawList(records) {
    const table = el('table','','mcd-table');
    const heading = el('tr');
    for (const label of ['견적일','거래처','의뢰명','서류','']) heading.append(el('th',label));
    const head = el('thead'); head.append(heading);
    const body = el('tbody');
    for (const record of records.slice(0,50)) {
      const row = el('tr');
      const quote = record.quote_amount == null ? '견적 초안' : '견적서';
      const columns = [
        ['견적일',record.quote_on],['거래처',record.customer],['의뢰명',record.title],
        ['서류',record.report_body ? quote + ' · 결과보고서' : quote]
      ];
      for (const [label,value] of columns) {
        const cell = el('td',value);
        cell.dataset.label = label;
        row.append(cell);
      }
      const action = el('td'); action.append(button('열기',()=>openEditor(record)));
      row.append(action); body.append(row);
    }
    table.append(head,body);
    const wrap = el('div','','mcd-table-wrap'); wrap.append(table);
    list.replaceChildren(records.length ? wrap : el('p','등록된 단건 의뢰가 없습니다.','message'));
    const pages = el('div','','mcd-actions');
    if (offset) pages.append(button('이전',()=>{offset = Math.max(0,offset-50); void load();}));
    if (records.length > 50) pages.append(button('다음',()=>{offset += 50; void load();}));
    if (pages.childElementCount) list.append(pages);
  }
  function openEditor(record) {
    const opener = document.activeElement;
    const id = record?.id ?? crypto.randomUUID();
    const modal = el('dialog','','mcd-email-dialog app-authoring-dialog single-service-editor');
    dialog = modal;
    const title = el('h3',record ? '단건 의뢰 수정' : '단건 의뢰 등록');
    title.id = 'single-service-editor-title';
    modal.setAttribute('aria-labelledby',title.id);
    const form = el('form','','app-authoring');
    const grid = el('div','','mcd-grid');
    const customer = field(grid,'거래처','text',record?.customer,{required:true,limit:200});
    const suggestions = el('datalist');
    suggestions.id = 'single-service-customers';
    for (const name of customers) suggestions.append(new Option(name));
    customer.setAttribute('list',suggestions.id);
    const name = field(grid,'의뢰명','text',record?.title,{required:true,limit:200});
    const quoteOn = field(grid,'견적일','date',record?.quote_on ?? dayInSeoul(),{required:true});
    const amount = field(grid,'견적 금액 (원)','number',record?.quote_amount);
    amount.min = '0'; amount.max = '1000000000000'; amount.step = '1';
    const scope = field(form,'견적 범위','textarea',record?.quote_scope,{required:true,limit:3000});
    const report = el('details');
    report.append(el('summary','수행 결과보고서'));
    report.open = !!record?.report_body;
    const performed = field(report,'수행일','date',record?.performed_on);
    const result = field(report,'수행 내용','textarea',record?.report_body,{limit:6000});
    const feedback = el('p','','message');
    feedback.setAttribute('role','status');
    const actions = el('div','','mcd-actions');
    const save = el('button','저장','button mcd-button primary'); save.type = 'submit';
    const quote = button('견적서 미리보기',()=>showPreview('quote'));
    const output = button('결과보고서 미리보기',()=>showPreview('report'));
    let printSaved;
    const print = button('인쇄 · PDF로 저장',()=>{try{printSaved?.();}catch{feedback.textContent='인쇄창을 열지 못했습니다.';}});
    print.hidden = true;
    const frame = el('iframe','','single-service-preview'); frame.hidden = true;
    actions.append(save,quote,output,print,button('닫기',close));
    form.prepend(grid,suggestions); form.append(report,actions,feedback,frame);
    modal.append(title,form); host.append(modal);
    dirty = false; busy = false;
    function refresh(){
      quote.disabled = !record || record.quote_amount == null || dirty || busy;
      output.disabled = !record?.report_body || dirty || busy;
      save.disabled = busy;
    }
    function close(){
      if (busy || (dirty && !window.confirm('저장하지 않은 입력이 있습니다. 닫을까요?'))) return;
      modal.close(); modal.remove(); dialog = null; dirty = false; opener?.focus();
    }
    function showPreview(kind){
      if (dirty || busy) return;
      print.hidden = true;
      preview(frame,record,kind,runPrint=>{printSaved=runPrint;print.hidden=false;});
    }
    form.addEventListener('input',()=>{dirty=true;frame.hidden=true;print.hidden=true;refresh();});
    modal.addEventListener('cancel',event=>{event.preventDefault();close();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (busy) return;
      const reportText = result.value.trim();
      if (Boolean(performed.value) !== Boolean(reportText)) {
        feedback.textContent = '결과보고서는 수행일과 수행 내용을 함께 입력해 주세요.';
        return;
      }
      busy = true; refresh();
      feedback.textContent = '저장 중입니다.';
      const inputs = [customer,name,quoteOn,amount,scope,performed,result];
      inputs.forEach(input=>input.disabled=true);
      try {
        record = await rpc('erp_save_single_service_case',{
          p_id:id,p_revision:record?.revision ?? 0,p_customer:customer.value,p_title:name.value,
          p_quote_on:quoteOn.value,p_quote_scope:scope.value,p_quote_amount:amount.value === '' ? null : Number(amount.value),
          p_performed_on:performed.value || null,p_report_body:reportText
        });
        if (!modal.isConnected) return;
        dirty = false;
        feedback.textContent = '저장했습니다.';
        await load();
      } catch (error) { feedback.textContent = errorMessage(error); }
      finally { busy = false; inputs.forEach(input=>input.disabled=false); refresh(); }
    });
    refresh(); modal.showModal();
  }

  void load();
  return {hasUnsavedChanges:()=>Boolean(dialog?.isConnected && (dirty || busy))};
}
