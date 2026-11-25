import {escapeDocumentText, quotationRows, QUOTE_WIDTHS} from './general-quotation-document.mjs';

const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACK='http://schemas.openxmlformats.org/package/2006';
const tones=['','key','title','column','total','grand','center','quantity','money'];
const col=index=>String.fromCharCode(65+index);
const xml=value=>escapeDocumentText(String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,''));
const out=markup=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+markup;
const displayUnits=line=>Array.from(line).reduce((sum,ch)=>sum+(ch.charCodeAt(0)>127?2:1),0);

const styles=out(`<styleSheet xmlns="${NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts>
<fonts count="4">
  <font><sz val="10"/><name val="맑은 고딕"/></font>
  <font><b/><sz val="10"/><name val="맑은 고딕"/></font>
  <font><b/><sz val="21"/><name val="맑은 고딕"/></font>
  <font><b/><sz val="13"/><name val="맑은 고딕"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEDF3F0"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${tones.length}">${tones.map(tone=>{
  const font=tone==='title'?2:tone==='grand'?3:['key','column','total'].includes(tone)?1:0;
  const fill=tone==='grand'?3:['key','column','total'].includes(tone)?2:0;
  const format=tone==='quantity'?164:['money','grand'].includes(tone)?3:0;
  const horizontal=['money','grand','quantity'].includes(tone)?'right':['title','column','center'].includes(tone)?'center':'left';
  return `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${horizontal}" vertical="center" wrapText="1"/></xf>`;
}).join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);

export async function quotationXlsx(quote, JSZip) {
  const zip=new JSZip();
  const merges=[];
  const rows=quotationRows(quote).map((row,index)=>{
    const rowNumber=index+1;
    let column=0, lines=1;
    const cells=row.map(({value,tone,span,formula})=>{
      const ref=col(column)+rowNumber;
      const id=tones.indexOf(tone);
      const prefix=`<c r="${ref}" s="${id}"`;
      const width=QUOTE_WIDTHS.slice(column,column+span).reduce((sum,size)=>sum+size,0);
      if(typeof value==='string'){
        const wrapped=value.split('\n').reduce((total,line)=>total+Math.max(1,Math.ceil(displayUnits(line)/Math.max(4,width-2))),0);
        lines=Math.max(lines,wrapped);
      }
      const content=formula?`${prefix}><f>${formula}</f><v>${value}</v></c>`:typeof value==='number'?
        `${prefix}><v>${value}</v></c>`:`${prefix} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      if(span>1)merges.push(ref+':'+col(column+span-1)+rowNumber);
      column+=span;
      const blanks=Array.from({length:span-1},(_,i)=>`<c r="${col(column-span+1+i)+rowNumber}" s="${id}"/>`).join('');
      return content+blanks;
    }).join('');
    const height=index===0?42:Math.min(400,Math.max(22,lines*14+8));
    return `<row r="${rowNumber}" ht="${height}" customHeight="1">${cells}</row>`;
  });
  const sheet=out(`<worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
    <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
    <cols>${QUOTE_WIDTHS.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols>
    <sheetData>${rows.join('')}</sheetData>
    <mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
    <pageMargins left="0.47" right="0.47" top="0.51" bottom="0.51" header="0" footer="0"/>
    <pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
  </worksheet>`);
  zip.file('[Content_Types].xml',out(`<Types xmlns="${PACK}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
  zip.file('_rels/.rels',out(`<Relationships xmlns="${PACK}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
  zip.file('xl/workbook.xml',out(`<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="견적서" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'견적서'!$1:$8</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`));
  zip.file('xl/_rels/workbook.xml.rels',out(`<Relationships xmlns="${PACK}/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`));
  zip.file('xl/styles.xml',styles);
  zip.file('xl/worksheets/sheet1.xml',sheet);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
