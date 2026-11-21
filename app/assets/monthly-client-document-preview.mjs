// The preview and the downloaded Word file share the same filled Word XML.
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const attr = (node,key) => node?.getAttributeNS(ns,key);
const child = (node,name) => Array.from(node?.children || []).find(item=>item.localName===name);
const points = (value, divisor=20) => Number(value || 0)/divisor+'pt';

export async function previewWord(frame, bytes, filename) {
  const zip = await window.JSZip.loadAsync(bytes);
  const source = await zip.file('word/document.xml').async('string');
  const xml = new DOMParser().parseFromString(source,'application/xml');
  const body = xml.getElementsByTagNameNS(ns,'body')[0];
  if (!body) throw new Error('문서 미리보기를 만들 수 없습니다.');
  const doc = frame.contentDocument;
  doc.title=filename;
  const style=doc.createElement('style');
  style.textContent='@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#eee;font:10.5pt "Malgun Gothic","Noto Sans CJK KR",sans-serif;color:#191919}.sheet{width:210mm;min-height:297mm;padding:23mm 25mm;background:white;margin:0 auto 8px;break-after:page}.sheet:last-child{break-after:auto}table{width:100%;table-layout:fixed;border-collapse:collapse}td{padding:2pt 4pt;vertical-align:middle}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{background:white}.sheet{margin:0}}';
  doc.head.replaceChildren(style);
  doc.body.replaceChildren();
  function paragraph(node) {
    const p=doc.createElement('p'),pr=child(node,'pPr'),sp=child(pr,'spacing');
    p.style.marginTop=points(attr(sp,'before')); p.style.marginBottom=points(attr(sp,'after'));
    p.style.lineHeight=attr(sp,'line')?points(attr(sp,'line')):'1.35';
    p.style.textAlign=attr(child(pr,'jc'),'val') || 'left';
    if(child(pr,'pBdr')) p.style.borderBottom='1.2pt solid #222';
    for(const run of Array.from(node.children).filter(x=>x.localName==='r')){
      const span=doc.createElement('span'),rp=child(run,'rPr');
      if(child(rp,'b'))span.style.fontWeight='bold';
      if(child(rp,'sz'))span.style.fontSize=points(attr(child(rp,'sz'),'val'),2);
      const color=attr(child(rp,'color'),'val');
      if(/^[0-9a-f]{6}$/i.test(color))span.style.color='#'+color;
      span.textContent=Array.from(run.children).map(x=>x.localName==='t'?x.textContent:x.localName==='br'?'\n':'').join('');
      p.append(span);
    }
    return p;
  }
  function table(node) {
    const tbl=doc.createElement('table'),grid=child(node,'tblGrid'),cols=doc.createElement('colgroup');
    const widths=Array.from(grid.children,col=>Number(attr(col,'w')));
    const total=widths.reduce((sum,n)=>sum+n,0);
    for(const w of widths){const col=doc.createElement('col');col.style.width=(w/total*100)+'%';cols.append(col);}
    tbl.append(cols);
    const borders=child(child(node,'tblPr'),'tblBorders');
    for(const tr of Array.from(node.children).filter(x=>x.localName==='tr')){
      const row=tbl.insertRow();
      for(const tc of Array.from(tr.children).filter(x=>x.localName==='tc')){
        const cell=row.insertCell(),pr=child(tc,'tcPr');
        cell.colSpan=Number(attr(child(pr,'gridSpan'),'val')||1);
        if(borders && attr(child(borders,'top'),'val')==='single')cell.style.border='0.5pt solid #aaa';
        const fill=attr(child(pr,'shd'),'fill');
        if(/^[0-9a-f]{6}$/i.test(fill))cell.style.backgroundColor='#'+fill;
        for(const p of Array.from(tc.children).filter(x=>x.localName==='p'))cell.append(paragraph(p));
      }
    }
    return tbl;
  }
  let sheet;
  for(const block of body.children){
    if(!['tbl','p'].includes(block.localName))continue;
    if(!sheet){sheet=doc.createElement('section');sheet.className='sheet';doc.body.append(sheet);}
    sheet.append(block.localName==='tbl'?table(block):paragraph(block));
    if(child(child(block,'pPr'),'sectPr'))sheet=null;
  }
  await doc.fonts.ready;
}
