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

export function quotationRows(quote) {
  const rows=[];
  const cell=(value,tone='',span=1,formula)=>({value,tone,span,formula});
  const subtotalRow=9+quote.items.length;
  const discountRow=subtotalRow+1;
  const supplyRow=subtotalRow+2;
  const vatRow=subtotalRow+3;
  const totalRow=subtotalRow+4;
  const pair=(left,value,right,other)=>[cell(left,'key',2),cell(value,'',2),cell(right,'key',2),cell(other,'',2)];
  rows.push([cell('견 적 서','title',8)],
    pair('수신',quote.customer+' 귀하','공급자',quote.supplier),
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
@page{size:A4;margin:13mm 12mm}
*{box-sizing:border-box}
body{margin:0;padding:18px;font:13px/1.45 "Malgun Gothic","Noto Sans CJK KR",system-ui,sans-serif;color:#172522;background:#fff}
table{width:100%;table-layout:fixed;border-collapse:collapse}
td,th{border:1px solid #65766f;padding:7px 8px;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap;vertical-align:middle}
tr,.summary{break-inside:avoid}
th.key,th.column,.total{background:#edf3f0;font-weight:700}
.column,.title,.center{text-align:center}
.column:first-child{white-space:nowrap;padding-inline:3px}
.title{font-size:26px;padding:19px 8px;letter-spacing:.08em}
.money,.quantity,.grand{text-align:right;font-variant-numeric:tabular-nums}
.grand{font-weight:750;background:#e3efe8;font-size:17px}
@media print{body{padding:0;font-size:10pt}td,th{padding:5px 6px}thead{display:table-header-group}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;

export function quotationHtml(quote) {
  function writeRow(row) {
    return '<tr>'+row.map(({value,tone,span})=>{
      const tag=['title','key','column'].includes(tone)?'th':'td';
      const display=tone==='grand'||tone==='money'?won.format(value):tone==='quantity'?quantityFormat.format(value):value;
      return '<'+tag+' class="'+tone+'" colspan="'+span+'">'+escapeDocumentText(display)+'</'+tag+'>';
    }).join('')+'</tr>';
  }
  const rows=quotationRows(quote);
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><title>견적서</title><style>'+PRINT_STYLE+'</style><body><table aria-label="공용 견적서"><colgroup>'
    +QUOTE_WIDTHS.map(width=>'<col style="width:'+100*width/QUOTE_WIDTHS.reduce((sum,w)=>sum+w,0)+'%">').join('')+'</colgroup><thead>'
    +rows.slice(0,8).map(writeRow).join('')+'</thead><tbody>'+rows.slice(8,8+quote.items.length).map(writeRow).join('')
    +'</tbody><tbody class="summary">'+rows.slice(8+quote.items.length).map(writeRow).join('')+'</tbody></table></body></html>';
}
