'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('../app/assets/vendor/jszip-3.10.1.min.js');
const core = require('../app/assets/monthly-client-document-core.js');
const docx = require('../app/assets/monthly-client-document-docx.js');

const companies = [
  { id: 'beomhan', key: '범한메카텍', enabled: true, name: '범한메카텍 주식회사', share: 19, cap: 7, override: 6, pay: 7, seq: 1, note: '' },
  { id: 'samhyeon', key: '삼현', enabled: true, name: '주식회사 삼현', share: 19, cap: 7, override: '', pay: 10, seq: 2, note: '' },
  { id: 'cheongwoo-bj', key: '청우비제이', enabled: true, name: '주식회사 청우 비제이', share: 13, cap: 5, override: '', pay: 10, seq: 3, note: '' },
  { id: 'hyundai-bng-steel', key: '현대비앤지스틸', enabled: true, name: '현대비앤지스틸 주식회사', share: 17.5, cap: 7, override: '', pay: 10, seq: 4, note: '' },
];
const common = () => ({
  year: 2026, month: 9, docDate: '2026-09-30', perfDate: '2026-09-22', place: '창원 팔용근린공원 일원',
  safety: 'outdoor', severe: 20, mildF: 0, mildM: 3, base: 1295000, rate: 70, note: '',
  extras: [{ name: '환경보호 캠페인 버스킹', description: '시민 대상 환경보호 인식 개선을 위한 거리 공연' }],
});

test('September 2026 four-company calculation golden matches the supplied source values', () => {
  const expected = [
    [41, 7, 6, 906500, 5439000, 543900, 5982900],
    [41, 7, 7, 906500, 6345500, 634550, 6980050],
    [41, 5, 5, 906500, 4532500, 453250, 4985750],
    [41, 7, 7, 906500, 6345500, 634550, 6980050],
  ];
  assert.deepEqual(companies.map(company => {
    const result = core.calculate(common(), company);
    return [result.totalCredit, result.calculatedHeadcount, result.appliedHeadcount, result.unitPrice,
      result.supplyAmount, result.vatAmount, result.totalAmount];
  }), expected);
});

test('October 2026 scenario keeps the source numbering, weekday, no-program output and DOCX filename', async () => {
  const input = { ...common(), month: 10, docDate: '2026-10-30', perfDate: '2026-10-20', extras: [] };
  const result = core.calculate(input, companies[0]);
  const content = core.buildContent(input, companies[0], result);
  assert.equal(result.supplyAmount, 5439000);
  assert.equal(result.vatAmount, 543900);
  assert.equal(result.totalAmount, 5982900);
  assert.equal(content.simple.SEQ, '2026-10-01');
  assert.equal(content.simple.PERF, '2026년 10월 20일(화)');
  assert.doesNotMatch(content.simple.C2, /버스킹/);
  assert.match(content.simple.C2, /지역사회 환경정비/);
  assert.equal(content.listC.length, 2);
  assert.match(content.listC[0], /야외 현장 안전교육/);
  assert.match(content.listC[1], /지역사회 환경정비/);
  assert.equal(docx.filename(input, [companies[0]]), '26년 10월_범한메카텍_공문+견적서+결과보고서.docx');
});

test('DOCX source wording restores reduced quote punctuation and outdoor safety check', () => {
  const input = common();
  const reduced = core.buildContent(input, companies[0], core.calculate(input, companies[0])).simple;
  assert.match(reduced.Q1, /용역 제공 기준\)에 의거하며, 귀사 지분율 19(?:\.0)?%/);
  assert.doesNotMatch(reduced.Q1, /,,/);
  assert.equal(reduced.R_SAFE, '· 작업 전 야외 현장 안전교육 실시 및 보호장구 점검, 참석 확인 서명 징구');
  for (const note of [null, 1, {}]) assert.throws(() => core.calculate({ ...input, note }, companies[0]), /INVALID_COMMON_NOTE/);
});

test('strict ISO dates are timezone independent and reject impossible days', () => {
  assert.equal(core.dateLabel('2026-09-22').kor, '2026년 9월 22일(화)');
  assert.equal(core.dateLabel('2026-10-20').kor, '2026년 10월 20일(화)');
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-9-22', '']) {
    assert.throws(() => core.validateDate(date), /INVALID_DATE/);
  }
});

test('invalid calculation inputs and client/contract overages are blocked', () => {
  for (const [key, value] of [['share', 101], ['share', -1], ['cap', 1.5], ['override', -1], ['override', 2.5], ['seq', 0]]) {
    const company = { ...companies[0], [key]: value };
    assert.throws(() => core.calculate(common(), company));
  }
  for (const [key, value] of [['month', 13], ['severe', -1], ['mildM', 1.5], ['rate', 101], ['base', Infinity]]) {
    assert.throws(() => core.calculate({ ...common(), [key]: value }, companies[0]));
  }
  assert.ok(core.calculate(common(), { ...companies[0], override: 8 }).warnings.length);
  assert.ok(core.calculate(common(), { ...companies[0], cap: 5 }).warnings.length);
});

test('DOCX generation replaces every token and does not mix companies in single-company files', async () => {
  const root = path.resolve(__dirname, '..');
  const template = JSON.parse(await fs.readFile(path.join(root, 'app/assets/monthly-client-document-template.json'), 'utf8'));
  const packageBytes = await fs.readFile(path.join(root, 'app/assets/monthly-client-document-package.zip'));
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'monthly-client-docx-'));
  const expectedNames = companies.map(company => company.name);
  try {
    for (let index = 0; index < companies.length; index += 1) {
      const company = companies[index];
      const buffer = await docx.createDocx({ JSZip, template, packageBytes, common: common(), companies: [company], type: 'nodebuffer' });
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml').async('string');
      assert.ok(xml.includes(company.name));
      assert.ok(xml.includes(`2026-09-0${index + 1}`));
      assert.ok(xml.includes('906,500'));
      assert.ok(xml.includes('야외 현장 안전교육'));
      assert.ok(xml.includes('보호장구 점검, 참석 확인 서명 징구'));
      assert.ok(xml.includes('창원 팔용근린공원 일원'));
      assert.ok(xml.includes('2026. 9. 30.'));
      assert.ok(xml.includes('2026년 9월 22일(화)'));
      if (index === 0) {
        assert.ok(xml.includes('5,439,000'));
        assert.ok(xml.includes('용역 제공 기준)에 의거하며, 귀사 지분율'));
        assert.ok(!xml.includes('의거하며,,'));
      }
      if (index === 1) assert.ok(xml.includes('6,345,500'));
      if (index === 2) assert.ok(xml.includes('4,532,500'));
      if (index === 3) assert.ok(xml.includes('6,345,500'));
      assert.ok(xml.includes('환경보호 캠페인 버스킹'));
      assert.equal((xml.match(/<w:sectPr/g) || []).length, 3, 'one C/Q/R section per output page');
      assert.doesNotMatch(xml, /\{\{\w+\}\}/);
      expectedNames.filter(name => name !== company.name).forEach(name => assert.ok(!xml.includes(name), `${name} leaked into ${company.key}`));
      const filename = path.join(scratch, `${company.id}.docx`);
      await fs.writeFile(filename, buffer);
      assert.ok((await fs.stat(filename)).size > 1000);
      assert.match(xml, /<w:sectPr/);
    }
    const all = await docx.createDocx({ JSZip, template, packageBytes, common: common(), companies, type: 'nodebuffer' });
    const allZip = await JSZip.loadAsync(all);
    const allXml = await allZip.file('word/document.xml').async('string');
    for (const company of companies) assert.ok(allXml.includes(company.name));
    assert.equal((allXml.match(/<w:sectPr/g) || []).length, 12, 'four C/Q/R groups preserve 12 document sections');
    assert.doesNotMatch(allXml, /\{\{\w+\}\}/);
    assert.equal(docx.filename(common(), companies), '26년 9월_모회사 4사 전체_공문+견적서+결과보고서.docx');
    const october = { ...common(), month: 10, docDate: '2026-10-30', perfDate: '2026-10-20', extras: [] };
    const octoberBuffer = await docx.createDocx({ JSZip, template, packageBytes, common: october, companies, type: 'nodebuffer' });
    const octoberZip = await JSZip.loadAsync(octoberBuffer);
    const octoberXml = await octoberZip.file('word/document.xml').async('string');
    companies.forEach(company => assert.ok(octoberXml.includes(company.name)));
    assert.equal((octoberXml.match(/<w:sectPr/g) || []).length, 12);
    assert.match(octoberXml, /2026년 10월 20일\(화\)/);
    assert.doesNotMatch(octoberXml, /버스킹|\{\{\w+\}\}/);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
