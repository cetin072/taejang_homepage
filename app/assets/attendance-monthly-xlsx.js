// Packaging adapted from TaejangPayrollLedgerXlsx. General attendance is independent of payroll/HR exports.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.TaejangAttendanceMonthlyXlsx=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const encoder=new TextEncoder();
  function xml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function columnName(index) {
    let number = index + 1;
    let name = '';
    while (number > 0) {
      const remainder = (number - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      number = Math.floor((number - 1) / 26);
    }
    return name;
  }

  function cellXml(value, ref, style = 0) {
    if (value === null || value === undefined || value === '') {
      return `<c r="${ref}" s="${style}"/>`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="15"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6B57"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD9E1DD"/></left><right style="thin"><color rgb="FFD9E1DD"/></right><top style="thin"><color rgb="FFD9E1DD"/></top><bottom style="thin"><color rgb="FFD9E1DD"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function push16(target, value) {
    target.push(value & 255, (value >>> 8) & 255);
  }

  function push32(target, value) {
    target.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  }

  function storedZip(files) {
    const output = [];
    const central = [];
    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);
      const offset = output.length;
      push32(output, 0x04034b50); push16(output, 20); push16(output, 0x0800); push16(output, 0);
      push16(output, 0); push16(output, 0); push32(output, crc); push32(output, data.length); push32(output, data.length);
      push16(output, name.length); push16(output, 0); output.push(...name); for (const byte of data) output.push(byte);

      push32(central, 0x02014b50); push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
      push16(central, 0); push16(central, 0); push32(central, crc); push32(central, data.length); push32(central, data.length);
      push16(central, name.length); push16(central, 0); push16(central, 0); push16(central, 0); push16(central, 0);
      push32(central, 0); push32(central, offset); central.push(...name);
    });
    const centralOffset = output.length;
    output.push(...central);
    push32(output, 0x06054b50); push16(output, 0); push16(output, 0); push16(output, files.length); push16(output, files.length);
    push32(output, central.length); push32(output, centralOffset); push16(output, 0);
    return new Uint8Array(output);
  }

  function buildTableWorkbookXlsx(sheets) {
    const files = [
      { name: '_rels/.rels', content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/styles.xml', content: STYLES_XML },
    ];
    const overrides=[], relationships=[], names=[];
    sheets.forEach((sheet,index)=>{
      const id=index+1, last=columnName(sheet.headers.length-1);
      names.push('<sheet name="'+xml(sheet.name)+'" sheetId="'+id+'" r:id="rId'+id+'"/>');
      overrides.push('<Override PartName="/xl/worksheets/sheet'+id+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
      relationships.push('<Relationship Id="rId'+id+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+id+'.xml"/>');
      const rows=[
        '<row r="1" ht="26" customHeight="1">'+cellXml(sheet.title,'A1',1)+'</row>',
        '<row r="2">'+cellXml(sheet.note,'A2',4)+'</row>',
        '<row r="3" ht="38" customHeight="1">'+sheet.headers.map((v,c)=>cellXml(v,columnName(c)+'3',2)).join('')+'</row>',
        ...sheet.rows.map((row,r)=>'<row r="'+(r+4)+'" ht="42" customHeight="1">'+row.map((v,c)=>cellXml(v,columnName(c)+(r+4))).join('')+'</row>')
      ];
      files.push({name:'xl/worksheets/sheet'+id+'.xml',content:'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="3" topLeftCell="C4" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>'+sheet.headers.map((v,c)=>'<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+(sheet.widths?.[c] || 24)+'" customWidth="1"/>').join('')+'</cols><sheetData>'+rows.join('')+'</sheetData><autoFilter ref="A3:'+last+Math.max(3,sheet.rows.length+3)+'"/><mergeCells count="2"><mergeCell ref="A1:'+last+'1"/><mergeCell ref="A2:'+last+'2"/></mergeCells></worksheet>'});
    });
    relationships.push('<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    files.push(
      {name:'[Content_Types].xml',content:'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+overrides.join('')+'</Types>'},
      {name:'xl/workbook.xml',content:'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+names.join('')+'</sheets></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',content:'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+relationships.join('')+'</Relationships>'}
    );
    return storedZip(files);
  }


  return Object.freeze({buildTableWorkbookXlsx});
});
