import {escapeDocumentText, recipientDetails, TAX_MODES} from './general-quotation-document.mjs';

const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACK='http://schemas.openxmlformats.org/package/2006';
const COLUMN_WIDTHS=[5,17,35,7,9,14,14.85546875,14.85546875];
const FIRST_ITEM_ROW=10;
const FONT_SIZES=[10,10,11,21,13,12];
const TONES={
  text:[0,0,0], issuer:[1,0,0], label:[2,2,0], title:[3,0,0], band:[1,2,0],
  grand:[4,3,3], item:[5,0,0], quantity:[5,0,164], itemMoney:[5,0,3], money:[0,0,3],
  bank:[2,0,0]
};
const col=index=>String.fromCharCode(66+index);
const xml=value=>escapeDocumentText(String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,''));
const out=markup=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+markup;
const displayUnits=line=>Array.from(line).reduce((sum,ch)=>sum+(ch.charCodeAt(0)>127?2:1),0);

function quotationRows(quote) {
  const cell=(value,tone='text',span=1,formula)=>({value,tone,span,formula});
  const subtotalRow=FIRST_ITEM_ROW+quote.items.length;
  const discountRow=subtotalRow+1;
  const supplyRow=subtotalRow+2;
  const vatRow=subtotalRow+3;
  const totalRow=subtotalRow+4;
  const pair=(left,value,right,other)=>[cell(left,'label',2),cell(value,'text',2),cell(right,'label',2),cell(other,'issuer',2)];
  const recipient=[quote.customer+' 귀하',...recipientDetails(quote).map(([label,value])=>label+' '+value)].join('\n');
  const rows=[
    [cell('견 적 서','title',8)],
    pair('수신',recipient,'공급자',quote.supplier),
    pair('견적일',quote.date,'사업자등록번호',quote.businessNumber),
    pair('유효기간',quote.validity,'대표자',quote.representative),
    pair('결제 조건',quote.payment,'담당자·연락처',quote.contact),
    pair('건명',quote.subject,'주소',quote.address),
    [cell('합계금액','band',3),cell(quote.total,'grand',3,'E'+totalRow),cell(TAX_MODES[quote.taxMode],'band',2)],
    ['No.','품명','규격·모델','단위','수량','단가 (원)','금액 (원)','비고'].map(label=>cell(label,'band'))
  ];
  quote.items.forEach((item,index)=>{
    const row=index+FIRST_ITEM_ROW;
    rows.push([cell(index+1,'item'),cell(item.name,'item'),cell(item.spec,'item'),cell(item.unit,'item'),
      cell(item.quantity,'quantity'),cell(item.unitPrice,'itemMoney'),
      cell(item.amount,'itemMoney',1,'ROUND(ROUND(F'+row+'*1000,0)*G'+row+'/1000,0)'),cell(item.memo,'item')]);
  });
  const summary=(name,value,tone='money',formula)=>[cell(name,'label',3),cell(value,tone,5,formula)];
  const net='(E'+subtotalRow+'-E'+discountRow+')';
  rows.push(summary('품목 합계',quote.subtotal,'money','SUM(H10:H'+(subtotalRow-1)+')'),
    summary('할인·절사',quote.discount),
    summary('공급가액',quote.supply,'money',quote.taxMode==='included'?'ROUND('+net+'/1.1,0)':net),
    summary('부가세',quote.vat,'money',quote.taxMode==='included'?net+'-E'+supplyRow:quote.taxMode==='separate'?'ROUND(E'+supplyRow+'/10,0)':'0'),
    summary('합계금액',quote.total,'grand','SUM(E'+supplyRow+':E'+vatRow+')'));
  if(quote.notes)rows.push([cell('배송·기타사항','label',2),cell(quote.notes,'text',6)]);
  if(quote.bank)rows.push([cell('입금 계좌','label',2),cell(quote.bank,'bank',6)]);
  return rows;
}

function styleCatalog() {
  const borders=['<border/>'];
  const formats=['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const borderIds=new Map();
  const formatIds=new Map();
  const sides=['left','right','top','bottom'];
  function id(tone,edges){
    const edgeKey=edges.join(':');
    if(!borderIds.has(edgeKey)){
      borderIds.set(edgeKey,borders.length);
      borders.push('<border>'+sides.map((side,i)=>edges[i]?
        `<${side} style="${edges[i]}"><color auto="1"/></${side}>`:`<${side}/>`).join('')+'</border>');
    }
    const formatKey=tone+':'+edgeKey;
    if(!formatIds.has(formatKey)){
      formatIds.set(formatKey,formats.length);
      const [font,fill,format]=TONES[tone];
      const wrapping=format?'shrinkToFit="1"':'wrapText="1"';
      formats.push(`<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${borderIds.get(edgeKey)}" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" ${wrapping}/></xf>`);
    }
    return formatIds.get(formatKey);
  }
  function serialize(){
    const fonts=FONT_SIZES.map((size,index)=>`<font>${index>0&&index<5?'<b/>':''}<sz val="${size}"/><name val="맑은 고딕"/></font>`).join('');
    return out(`<styleSheet xmlns="${NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts>
<fonts count="${FONT_SIZES.length}">${fonts}</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEDF3F0"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${formats.length}">${formats.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
  }
  return {id,serialize};
}

export async function quotationXlsx(quote, JSZip) {
  const zip=new JSZip();
  const merges=[];
  const styles=styleCatalog();
  const layout=quotationRows(quote);
  const lastRow=layout.length+1;
  const lastItemRow=FIRST_ITEM_ROW+quote.items.length-1;
  const rows=layout.map((row,index)=>{
    const rowNumber=index+2;
    const isItem=rowNumber>=FIRST_ITEM_ROW&&rowNumber<=lastItemRow;
    const top=[2,9,lastItemRow+1].includes(rowNumber)?'medium':'thin';
    const bottom=[2,8,lastItemRow,lastRow].includes(rowNumber)?'medium':'thin';
    let column=0, contentHeight=0;
    const cells=row.map(({value,tone,span,formula})=>{
      const ref=col(column)+rowNumber;
      const width=COLUMN_WIDTHS.slice(column,column+span).reduce((sum,size)=>sum+size,0);
      if(typeof value==='string'){
        const fontSize=FONT_SIZES[TONES[tone][0]];
        const available=Math.max(4,(width-2)*10/fontSize);
        const lines=value.split('\n').reduce((total,line)=>total+Math.max(1,Math.ceil(displayUnits(line)/available)),0);
        contentHeight=Math.max(contentHeight,lines*(fontSize+4)+4);
      }
      if(span>1)merges.push(ref+':'+col(column+span-1)+rowNumber);
      const content=Array.from({length:span},(_,i)=>{
        const left=i?'':column===0?'medium':'thin';
        const right=i<span-1?'':column+span===COLUMN_WIDTHS.length?'medium':'thin';
        const prefix=`<c r="${col(column+i)+rowNumber}" s="${styles.id(tone,[left,right,top,bottom])}"`;
        if(i)return prefix+'/>';
        if(formula)return `${prefix}><f>${formula}</f><v>${value}</v></c>`;
        if(typeof value==='number')return `${prefix}><v>${value}</v></c>`;
        return `${prefix} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      }).join('');
      column+=span;
      return content;
    }).join('');
    const minimum={2:42,3:63.95,7:28.5}[rowNumber]??(isItem?34.5:21.95);
    const height=rowNumber===2?minimum:Math.min(400,Math.max(minimum,contentHeight));
    return `<row r="${rowNumber}" ht="${height}" customHeight="1">${cells}</row>`;
  });
  const sheet=out(`<worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
    <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
    <cols><col min="1" max="1" width="2.5703125" customWidth="1"/>${COLUMN_WIDTHS.map((width,i)=>`<col min="${i+2}" max="${i+2}" width="${width}" customWidth="1"/>`).join('')}</cols>
    <sheetData><row r="1" ht="6.75" customHeight="1"><c r="A1"/></row>${rows.join('')}</sheetData>
    <mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
    <pageMargins left="0.47" right="0.47" top="0.51" bottom="0.51" header="0" footer="0"/>
    <pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
  </worksheet>`);
  zip.file('[Content_Types].xml',out(`<Types xmlns="${PACK}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
  zip.file('_rels/.rels',out(`<Relationships xmlns="${PACK}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
  zip.file('xl/workbook.xml',out(`<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="견적서" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'견적서'!$A$1:$I$${lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'견적서'!$2:$9</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`));
  zip.file('xl/_rels/workbook.xml.rels',out(`<Relationships xmlns="${PACK}/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`));
  zip.file('xl/styles.xml',styles.serialize());
  zip.file('xl/worksheets/sheet1.xml',sheet);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
