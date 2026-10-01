/* DOCX composition from the approved WordprocessingML tokens and package skeleton. */
(function (root, factory) {
  'use strict';
  const core = root.MonthlyClientDocumentCore || (typeof require === 'function' ? require('./monthly-client-document-core.js') : null);
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonthlyClientDocumentDocx = api;
})(typeof globalThis === 'object' ? globalThis : this, function (core) {
  'use strict';
  if (!core) throw new Error('MONTHLY_DOCUMENT_CORE_REQUIRED');
  const TEMPLATE_VERSION = 'claude-template-1';

  function expandList(xml, token, items) {
    const tokenText = `{{${token}}}`;
    const escaped = tokenText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<w:p\\b[^>]*>(?:(?!</w:p>)[\\s\\S])*?${escaped}[\\s\\S]*?</w:p>`));
    if (!match) throw new Error(`MISSING_LIST_TOKEN_${token}`);
    const paragraph = match[0];
    const result = items.map((item, index) => {
      let output = paragraph.replace(tokenText, core.esc(item));
      if (token === 'LIST_C' && index === items.length - 1) output = output.replace('w:after="60"', 'w:after="180"');
      return output;
    }).join('');
    return xml.replace(paragraph, () => result);
  }

  function fill(xml, content) {
    if (xml.includes('{{LIST_C}}')) xml = expandList(xml, 'LIST_C', content.listC);
    if (xml.includes('{{LIST_R}}')) xml = expandList(xml, 'LIST_R', content.listR);
    return xml.replace(/\{\{(\w+)\}\}/g, (token, key) => {
      if (!Object.prototype.hasOwnProperty.call(content.simple, key)) throw new Error(`UNKNOWN_DOCX_TOKEN_${key}`);
      return core.esc(content.simple[key]);
    });
  }

  async function createDocx({ JSZip = root.JSZip, template, packageBytes, common, companies, type = 'blob' } = {}) {
    if (!JSZip || !template || !packageBytes || !Array.isArray(companies) || !companies.length) throw new Error('MISSING_DOCX_DEPENDENCY');
    if (!['C', 'Q', 'R', 'Rlast', 'sectR'].every(key => typeof template[key] === 'string')) throw new Error('INVALID_DOCX_TEMPLATE');
    const seenSequences = new Set();
    let body = '';
    companies.forEach((company, index) => {
      if (!company.enabled) throw new Error('DOCX_COMPANY_DISABLED');
      if (seenSequences.has(company.seq)) throw new Error('DUPLICATE_DOCUMENT_SEQUENCE');
      seenSequences.add(company.seq);
      const calculation = core.calculate(common, company);
      if (calculation.warnings.length) throw new Error('DOCX_CALCULATION_WARNING');
      const content = core.buildContent(common, company, calculation);
      const isLast = index === companies.length - 1;
      body += fill(template.C, content) + fill(template.Q, content) + fill(isLast ? template.Rlast : template.R, content);
    });
    const documentXml = `${template.prefix}${body}${template.sectR}</w:body></w:document>`;
    if (/\{\{\w+\}\}/.test(documentXml)) throw new Error('UNREPLACED_DOCX_TOKEN');
    const zip = await JSZip.loadAsync(packageBytes);
    zip.file('word/document.xml', documentXml);
    return zip.generateAsync({ type, compression: 'DEFLATE' });
  }

  async function loadAssets() {
    const [templateResponse, packageResponse] = await Promise.all([
      fetch('assets/monthly-client-document-template.json'),
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

  return Object.freeze({ TEMPLATE_VERSION, createDocx, loadAssets, filename, fill });
});
