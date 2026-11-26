import {erpDocumentName} from './erp-pdf.mjs';

const won = new Intl.NumberFormat('ko-KR');
const quantityFormat = new Intl.NumberFormat('ko-KR', {maximumFractionDigits:3});
export const TAX_MODES = {included:'부가세 포함', separate:'부가세 별도', none:'부가세 미적용'};
export const MAX_QUOTE_ITEMS = 100;

function number(value, decimals, maximum, label) {
  const raw = String(value ?? '');
  const pattern = decimals ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/;
  const parsed = Number(raw);
  if (!pattern.test(raw) || parsed < 0 || parsed > maximum) throw new Error(label + '을 확인해 주세요.');
  return parsed;
}

export function calculateQuotation(input) {
  const rows = input.items.filter(item => Object.entries(item).some(([key,value]) =>
    !['quantity','unitPrice'].includes(key) && String(value).trim()) || item.unitPrice !== '');
  if (!input.customer.trim() || !input.supplier.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('거래처, 견적일과 공급자 상호를 입력해 주세요.');
  }
  if (!Object.hasOwn(TAX_MODES,input.taxMode)) throw new Error('부가세 기준을 선택해 주세요.');
  if (!rows.length || rows.length > MAX_QUOTE_ITEMS) throw new Error('품목을 1개 이상 입력해 주세요.');
  const items = rows.map((item,index) => {
    const label = (index+1)+'번 품목의 ';
    if (!item.name.trim()) throw new Error(label+'품명을 입력해 주세요.');
    const quantity = number(item.quantity,3,1000000,label+'수량');
    const unitPrice = number(item.unitPrice,0,1000000000,label+'단가');
    if (!quantity) throw new Error(label+'수량은 0보다 커야 합니다.');
    const scaled = Math.round(quantity*1000);
    if (scaled * unitPrice > 1000000000000000) throw new Error(label+'금액이 입력 범위를 초과했습니다.');
    const amount = Math.floor((scaled*unitPrice+500)/1000);
    return {...item,quantity,unitPrice,amount};
  });
  const subtotal = items.reduce((sum,item)=>sum+item.amount,0);
  if (subtotal > 1000000000000) throw new Error('품목 합계가 입력 범위를 초과했습니다.');
  const discount = number(input.discount || '0',0,subtotal,'할인·절사 금액');
  const net = subtotal-discount;
  const supply = input.taxMode==='included' ? Math.floor((net*10+5)/11) : net;
  const vat = input.taxMode==='included' ? net-supply : input.taxMode==='separate' ? Math.floor((supply+5)/10) : 0;
  return {...input,items,subtotal,discount,supply,vat,total:supply+vat};
}

export function escapeDocumentText(value) {
  return String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
}

export const QUOTE_WIDTHS = [5,17,28,7,9,14,18,16];

function recipientDetails(quote) {
  return [
    ['사업자등록번호',quote.customerBusinessNumber],
    ['담당자·연락처',quote.customerContact],
    ['주소',quote.customerAddress]
  ].filter(([,value])=>value);
}

export function quotationRows(quote) {
  const rows=[];
  const cell=(value,tone='',span=1,formula)=>({value,tone,span,formula});
  const subtotalRow=9+quote.items.length;
  const discountRow=subtotalRow+1;
  const supplyRow=subtotalRow+2;
  const vatRow=subtotalRow+3;
  const totalRow=subtotalRow+4;
  const pair=(left,value,right,other)=>[cell(left,'key',2),cell(value,'',2),cell(right,'key',2),cell(other,'',2)];
  const recipient=[quote.customer+' 귀하',...recipientDetails(quote).map(([label,value])=>label+' '+value)].join('\n');
  rows.push([cell('견 적 서','title',8)],
    pair('수신',recipient,'공급자',quote.supplier),
    pair('견적일',quote.date,'사업자등록번호',quote.businessNumber),
    pair('유효기간',quote.validity,'대표자',quote.representative),
    pair('결제 조건',quote.payment,'담당자·연락처',quote.contact),
    pair('건명',quote.subject,'주소',quote.address),
    [cell('합계금액','total',3),cell(quote.total,'grand',3,'G'+totalRow),cell(TAX_MODES[quote.taxMode],'total',2)],
    ['No.','품명','규격·모델','단위','수량','단가 (원)','금액 (원)','비고'].map(label=>cell(label,'column')));
  quote.items.forEach((item,index)=>{
    const row=index+9;
    rows.push([cell(index+1,'center'),cell(item.name),cell(item.spec),cell(item.unit,'center'),cell(item.quantity,'quantity'),
      cell(item.unitPrice,'money'),cell(item.amount,'money',1,'ROUND(ROUND(E'+row+'*1000,0)*F'+row+'/1000,0)'),cell(item.memo)]);
  });
  const summary=(name,value,tone='money',formula)=>[cell(name,'key',6),cell(value,tone,2,formula)];
  const net='(G'+subtotalRow+'-G'+discountRow+')';
  rows.push(summary('품목 합계',quote.subtotal,'money','SUM(G9:G'+(subtotalRow-1)+')'),
    summary('할인·절사',quote.discount),
    summary('공급가액',quote.supply,'money',quote.taxMode==='included'?'ROUND('+net+'/1.1,0)':net),
    summary('부가세',quote.vat,'money',quote.taxMode==='included'?net+'-G'+supplyRow:quote.taxMode==='separate'?'ROUND(G'+supplyRow+'/10,0)':'0'),
    summary('합계금액',quote.total,'grand','SUM(G'+supplyRow+':G'+vatRow+')'));
  if (quote.notes) rows.push([cell('배송·기타사항','key',2),cell(quote.notes,'',6)]);
  if (quote.bank) rows.push([cell('입금 계좌','key',2),cell(quote.bank,'',6)]);
  return rows;
}

const PRINT_STYLE = `
@page{size:A4;margin:15mm}
@page :first{margin-top:0;margin-bottom:0}
*{box-sizing:border-box}
body{margin:0;padding:22px;font:13px/1.5 "Malgun Gothic","Noto Sans CJK KR",system-ui,sans-serif;color:#172921;background:#fff}
h1,h2,p,dl,dd{margin:0}
.quote-sheet{margin:auto;max-width:820px}
.quote-heading{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding-bottom:13px;border-bottom:2px solid #2f5a49}
h1{font-size:30px;letter-spacing:.05em}
.quote-date{color:#475e54;white-space:nowrap;font-variant-numeric:tabular-nums}
.quote-date time{margin-left:8px;color:#172921;font-weight:650}
.quote-subject{margin:14px 0 0;font-size:17px;font-weight:750;overflow-wrap:anywhere}
.quote-parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:22px 0}
.quote-party{min-width:0;border-top:1px solid #d1ded7;padding-top:11px}
.quote-party h2{font-size:11px;color:#365949}
.quote-party-name{margin:2px 0 7px;font-size:16px;font-weight:750;overflow-wrap:anywhere}
.quote-details>div{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:9px;margin:3px 0}
dt{color:#475e54}
dd,td{overflow-wrap:anywhere;white-space:pre-wrap}
.quote-items{width:100%;border-collapse:collapse;text-align:left}
.quote-items th{background:#ebf2ee;font-size:11px;color:#284a3c;border-top:1px solid #bacdc3;border-bottom:1px solid #bacdc3}
.quote-items :is(td,th){padding:8px 7px;vertical-align:top}
.quote-items td{border-bottom:1px solid #dce5e0}
.quote-items th,.center,.money,.quantity,.grand{white-space:nowrap}
.center{text-align:center}
.money,.quantity,.grand{text-align:right;font-variant-numeric:tabular-nums}
.quote-item-spec{display:block;color:#475e54;font-size:11px}
.quote-end{display:grid;grid-template-columns:minmax(0,1fr) 42%;gap:32px;margin-top:18px}
.quote-notes>div{padding-top:9px;margin-bottom:11px;border-top:1px solid #d1ded7}
.quote-notes dt{font-size:11px;font-weight:700}
.quote-notes dd{margin-top:3px}
.quote-amounts{grid-column:2}
.quote-amounts>div{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:3px 0}
.quote-amounts .quote-total{margin-top:6px;padding:9px 10px;background:#ebf2ee;border-top:1px solid #98b3a6}
.quote-total dt{color:#244637;font-weight:750}
.quote-tax-mode{display:block;font-size:10px;font-weight:500}
.grand{font-size:19px;color:#244637;font-weight:750}
.quote-print-gap{display:none}
@media screen and (max-width:775px){.quote-sheet{min-width:740px}}
@media print{
  body{padding:0;font-size:10pt}
  .quote-sheet{max-width:none;padding:14mm 0 12mm}
  .quote-items th,.quote-items td{padding:6px}
  .quote-print-gap{display:table-footer-group}
  .quote-print-gap td{height:9mm;padding:0;border:0}
  .quote-end,.quote-parties,tr{break-inside:avoid}
  *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
}
`;

export function quotationHtml(quote) {
  const e=escapeDocumentText;
  const detailList=(entries,className)=>'<dl class="'+className+'">'+entries.filter(([,value])=>value).map(([label,value])=>
    '<div><dt>'+label+'</dt><dd>'+e(value)+'</dd></div>').join('')+'</dl>';
  const party=(label,name,entries)=>'<section class="quote-party"><h2>'+label+'</h2><p class="quote-party-name">'+e(name)+'</p>'
    +detailList(entries,'quote-details')+'</section>';
  const itemRows=quote.items.map((item,index)=>'<tr><td class="center">'+(index+1)+'</td><td><strong>'+e(item.name)+'</strong>'
    +(item.spec?'<span class="quote-item-spec">'+e(item.spec)+'</span>':'')+'</td><td class="center">'+e(item.unit)+'</td>'
    +'<td class="quantity">'+quantityFormat.format(item.quantity)+'</td><td class="money">'+won.format(item.unitPrice)+'</td>'
    +'<td class="money">'+won.format(item.amount)+'</td><td>'+e(item.memo)+'</td></tr>').join('');
  const amounts=[['품목 합계',quote.subtotal],...(quote.discount?[['할인·절사',-quote.discount]]:[]),
    ['공급가액',quote.supply],['부가세',quote.vat]];
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><title>'+e(erpDocumentName(quote.customer,quote.date))+'</title><style>'+PRINT_STYLE+'</style><body>'
    +'<main class="quote-sheet"><header class="quote-heading"><h1>견적서</h1><p class="quote-date">견적일 <time>'+e(quote.date)+'</time></p></header>'
    +(quote.subject?'<p class="quote-subject">'+e(quote.subject)+'</p>':'')
    +'<div class="quote-parties">'
    +party('수신',quote.customer+' 귀하',[...recipientDetails(quote),['유효기간',quote.validity],['결제 조건',quote.payment]])
    +party('공급자',quote.supplier,[['사업자등록번호',quote.businessNumber],['대표자',quote.representative],['담당자·연락처',quote.contact],['주소',quote.address]])
    +'</div><table class="quote-items" aria-label="견적 품목"><colgroup><col style="width:6%"><col style="width:35%"><col style="width:8%"><col style="width:11%"><col style="width:13%"><col style="width:16%"><col style="width:11%"></colgroup>'
    +'<thead><tr><th class="center" scope="col">번호</th><th scope="col">품명 · 규격</th><th class="center" scope="col">단위</th><th class="quantity" scope="col">수량</th>'
    +'<th class="money" scope="col">단가 (원)</th><th class="money" scope="col">금액 (원)</th><th scope="col">비고</th></tr></thead><tbody>'+itemRows
    +'</tbody><tfoot class="quote-print-gap" aria-hidden="true"><tr><td colspan="7"></td></tr></tfoot></table><section class="quote-end" aria-label="견적 합계 및 안내">'
    +detailList([['입금 계좌',quote.bank],['배송·기타사항',quote.notes]],'quote-notes')
    +'<dl class="quote-amounts">'+amounts.map(([label,value])=>'<div><dt>'+label+'</dt><dd class="money">'+won.format(value)+'</dd></div>').join('')
    +'<div class="quote-total"><dt>합계금액 <span class="quote-tax-mode">'+TAX_MODES[quote.taxMode]+'</span></dt><dd class="grand">'+won.format(quote.total)+'원</dd></div></dl></section></main></body></html>';
}
