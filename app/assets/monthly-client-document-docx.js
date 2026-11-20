/* DOCX composition from the approved WordprocessingML tokens and package skeleton. */
(function (root, factory) {
  'use strict';
  const core = root.MonthlyClientDocumentCore || (typeof require === 'function' ? require('./monthly-client-document-core.js') : null);
  const api = factory(root, core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonthlyClientDocumentDocx = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root, core) {
  'use strict';
  if (!core) throw new Error('MONTHLY_DOCUMENT_CORE_REQUIRED');
  const TEMPLATE_VERSION = 'client-template-2';
  const supportsTemplate = version => ['claude-template-1', TEMPLATE_VERSION, 'monthly-stages-1'].includes(version);

  function textXml(value, breaks) { return breaks ? core.esc(value).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">') : core.esc(value); }

  function expandList(xml, token, items, breaks) {
    const tokenText = `{{${token}}}`;
    const escaped = tokenText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<w:p\\b[^>]*>(?:(?!</w:p>)[\\s\\S])*?${escaped}[\\s\\S]*?</w:p>`));
    if (!match) throw new Error(`MISSING_LIST_TOKEN_${token}`);
    const paragraph = match[0];
    const result = items.map((item, index) => {
      let output = paragraph.replace(tokenText, textXml(item, breaks));
      if (token === 'LIST_C' && index === items.length - 1) output = output.replace('w:after="60"', 'w:after="180"');
      return output;
    }).join('');
    return xml.replace(paragraph, () => result);
  }

  function fill(xml, content, breaks = false) {
    if (xml.includes('{{LIST_C}}')) xml = expandList(xml, 'LIST_C', content.listC, breaks);
    if (xml.includes('{{LIST_R}}')) xml = expandList(xml, 'LIST_R', content.listR, breaks);
    return xml.replace(/\{\{(\w+)\}\}/g, (token, key) => {
      if (!Object.prototype.hasOwnProperty.call(content.simple, key)) throw new Error(`UNKNOWN_DOCX_TOKEN_${key}`);
      return textXml(content.simple[key], breaks);
    });
  }

  function stagePages(stage, plan) {
    if (!['three_step','notice_skipped','single_bundle'].includes(plan)) throw new Error('INVALID_STAGE_PLAN');
    if (stage === 'notice' && plan === 'three_step') return ['C'];
    if (stage === 'result' || stage === 'closed') return plan === 'single_bundle' ? ['C','Q','Rlast'] : ['Q','Rlast'];
    throw new Error('현재 단계에서 발행할 문서가 없습니다.');
  }

  function stageBody(template, common, company, stage, plan, settings) {
    const pages = stagePages(stage, plan);
    const bundle = plan === 'single_bundle';
    const preset = common.serviceType === 'custom' ? common.customService : settings.service_types[common.serviceType];
    if (!preset?.item || !preset.report || !Array.isArray(preset.work) || !settings.contract_basis_text) throw new Error('용역 문구 설정을 확인하세요.');
    const report = preset.report.replaceAll('{N}', String(common.month));
    const work = preset.work.map(line => line.replaceAll('{장소}', () => common.place));
    const safe = { outdoor:'작업 전 현장 안전교육 및 보호장구 점검', indoor_hq:'작업 전 태장 본사 실내 안전교육 및 보호장구 점검', indoor_video:'작업 전 실내 안전교육(영상 교육)', custom:common.safety.text }[common.safety.mode];
    const dates = pages.includes('Rlast') ? common.actualPerfDates : common.perfDates;
    if (!safe || !dates?.length) throw new Error('수행일과 안전교육 내용을 확인하세요.');
    const normalized = {...common, docDate:pages[0] === 'C' ? common.noticeDate : common.quoteDate, perfDate:dates[0], perfDates:dates, safety:common.safety.mode === 'outdoor' ? 'outdoor' : 'indoor'};
    const warnings = core.layoutWarnings(normalized,[company]);
    if (warnings.length) throw new Error(warnings.join(' '));
    const calculation = core.calculate(normalized,company);
    if (calculation.warnings.length) throw new Error('DOCX_CALCULATION_WARNING');
    const content = core.buildContent(normalized,company,calculation);
    const s = content.simple;
    const basis = settings.contract_basis_text;
    const programs = [safe,...work,...[common.workDescription].filter(x => x && !work.includes(x)),...common.extras.filter(e=>e.name).map(e=>[e.name,e.description].filter(Boolean).join(' — '))];
    content.listC = programs.map((line,i)=>String.fromCharCode(0x2460+i)+' '+line);
    content.listR = programs.map(line=>'· '+line);
    Object.assign(s,{BASIS:basis, ITEM:preset.item, SERVICE:report, RELATED:plan === 'notice_skipped' ? 'T'+s.SEQ+'호' : '태장 제'+s.SEQ+'호',
      C2:'2. '+((company.note || common.note).replace(/^2\.\s*/, '') || report+' 용역비를 안내드립니다.'),
      C4:'4. 관련 용역은 '+s.PERF+' '+common.place+'에서 '+(bundle?'수행하였으며':'수행할 예정이며')+', 세부 내용은 다음과 같습니다.',
      ENDING:bundle?'제출합니다.':'제출하겠습니다. 끝.', ATTACH1:'붙임  1. 용역 견적서 1부.', ATTACH2:'2. 용역 수행 결과보고서 1부.  끝.',
      Q1:'· 본 견적의 근거는 '+basis+'입니다.', Q3:'· 용역 내역: '+s.PERF+' '+common.place+' 수행.',
      R_SAFE:'· '+safe, PROMOTION:'당사 홍보 채널에 수행 내용을 '+(common.promotion.status==='posted'?'게시하였습니다.':'게시할 예정입니다.')
    });
    if (calculation.reduced) {
      s.C3='3. 귀사 지분율 '+company.share.toFixed(1)+'%를 적용한 산입 인원은 '+calculation.calculatedHeadcount+'명이나, 귀사와 별도 합의한 산입한도에 따라 귀사의 고용산입 인원은 '+s.N+'명입니다.';
      s.C3N+=' 귀사와 별도 합의한 산입한도 '+s.N+'명 적용.';
      s.Q2=s.Q2.replace('× 산입 '+s.N+'명','× 산입 '+s.N+'명(별도 합의 산입한도 적용)');
    }
    const photos = {safety:common.safety.mode==='outdoor'?'현장 안전교육':'실내 안전교육',site:common.place.replace(/\s*일원$/,''),group:'단체사진'};
    s.R_PHOTO='· 현장 사진자료 별도 첨부 ('+common.photoSets.map(key=>photos[key]).join(' / ')+')';
    return pages.map(page=>{
      s.DATE=core.dateLabel({C:common.noticeDate,Q:common.quoteDate,Rlast:common.reportDate}[page]).dot;
      let xml=template[page].replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, paragraph=>{
        if (!bundle && /{{ATTACH[12]}}/.test(paragraph)) return '';
        if (!common.photoSets.length && paragraph.includes('{{R_PHOTO}}')) return '';
        if (common.promotion.status==='none' && paragraph.includes('{{PROMOTION}}')) return '';
        return paragraph;
      });
      if (pages.length===1) xml=xml.replace(template.noticeSection,'');
      return fill(xml,content,true);
    }).join('');
  }

  async function createDocx({ JSZip = root.JSZip, template, packageBytes, common, companies, stage, plan, settings, type = 'blob' } = {}) {
    if (!JSZip || !template || !packageBytes || !Array.isArray(companies) || !companies.length) throw new Error('MISSING_DOCX_DEPENDENCY');
    const staged = template.version === 'monthly-stages-1';
    if (staged && (companies.length !== 1 || !companies[0].enabled)) throw new Error('단계별 파일은 선택한 회사 한 곳만 지원합니다.');
    if (!staged && !['C', 'Q', 'R', 'Rlast', 'sectR'].every(key => typeof template[key] === 'string')) throw new Error('INVALID_DOCX_TEMPLATE');
    const legacy = !template.version || template.version === 'claude-template-1';
    if (!staged && !legacy && template.version !== TEMPLATE_VERSION) throw new Error('UNSUPPORTED_DOCUMENT_TEMPLATE');
    if (!staged && !legacy) { const warnings = core.layoutWarnings(common, companies); if (warnings.length) throw new Error(warnings.join(' ')); }
    const seenSequences = new Set();
    let body = staged ? stageBody(template, common, companies[0], stage, plan, settings) : '';
    if (!staged) companies.forEach((company, index) => {
      if (!company.enabled) throw new Error('DOCX_COMPANY_DISABLED');
      if (seenSequences.has(company.seq)) throw new Error('DUPLICATE_DOCUMENT_SEQUENCE');
      seenSequences.add(company.seq);
      const calculation = core.calculate(common, company);
      if (calculation.warnings.length) throw new Error('DOCX_CALCULATION_WARNING');
      const content = core.buildContent(common, company, calculation, { legacy });
      const isLast = index === companies.length - 1;
      body += fill(template.C, content, !legacy) + fill(template.Q, content, !legacy) + fill(isLast ? template.Rlast : template.R, content, !legacy);
    });
    const documentXml = `${template.prefix}${body}${staged && stage === 'notice' ? template.noticeSection : template.sectR}</w:body></w:document>`;
    if (/\{\{\w+\}\}/.test(documentXml)) throw new Error('UNREPLACED_DOCX_TOKEN');
    const zip = await JSZip.loadAsync(packageBytes);
    zip.file('word/document.xml', documentXml);
    if (!legacy) {
      const styles = await zip.file('word/styles.xml').async('string');
      zip.file('word/styles.xml', styles.replace('<w:pPrDefault/>', '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="288" w:lineRule="exact"/></w:pPr></w:pPrDefault>'));
    }
    return zip.generateAsync({ type, compression: 'DEFLATE' });
  }

  async function loadAssets(version = TEMPLATE_VERSION) {
    if (!supportsTemplate(version)) throw new Error('UNSUPPORTED_DOCUMENT_TEMPLATE');
    const [templateResponse, packageResponse] = await Promise.all([
      fetch(version === 'monthly-stages-1' ? 'assets/monthly-client-document-template-stages.json' : version === 'claude-template-1' ? 'assets/monthly-client-document-template-v1.json' : 'assets/monthly-client-document-template.json'),
      fetch('assets/monthly-client-document-package.zip'),
    ]);
    if (!templateResponse.ok || !packageResponse.ok) throw new Error('DOCX_ASSET_LOAD_FAILED');
    return { template: await templateResponse.json(), packageBytes: await packageResponse.arrayBuffer() };
  }

  function filename(common, companies) {
    core.validateCommon(common);
    if (!Array.isArray(companies) || !companies.length) throw new Error('NO_SELECTED_COMPANIES');
    const label = companies.length === 4 ? '모회사 4사 전체' : companies.map(company => company.key).join('·');
    return `${String(common.year).slice(2)}년 ${common.month}월_${label}_공문+견적서+결과보고서.docx`;
  }

  return Object.freeze({ TEMPLATE_VERSION, supportsTemplate, createDocx, loadAssets, filename, fill });
});

