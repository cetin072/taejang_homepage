'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const email = require('../app/assets/monthly-client-document-email.js');

// Supplied September mail numbers. Company/location below are synthetic labels,
// not verified September contract or location data.
function fixture() {
  return {
    monthly: {
      yearMonth: '2026-09', serviceDate: '2026-09-22', serviceLocation: '[TEST] 수행 장소',
      safetyEducation: 'outdoor', programs: [{ name: '환경보호 캠페인 버스킹', enabled: true }],
    },
    company: { id: 'test-a', name: '[TEST] 회사 A', pdfFilename: '2026-09_[TEST] 회사 A_공문견적결과보고서.pdf' },
    calculation: {
      yearMonth: '2026-09', companyId: 'test-a', totalCredit: 41, equityRate: 17.5,
      appliedHeadcount: 7, supplyAmount: 6345500, vatIncludedAmount: 6980050, unitPrice: 906500,
    },
    includePhotos: true,
  };
}

test('user supplied September mail golden: numbers, weekday and core wording', () => {
  const output = email.generate(fixture());
  assert.equal(output.subject, '[태장] 2026년 9월 장애인 고용산입 현황 및 용역 수행 자료 송부');
  for (const expected of [
    '농업회사법인 태장 주식회사 김형철 전무이사입니다.', '당사 총 산입 41명에',
    '귀사 지분율 17.5%', '고용산입 인원은 7명입니다.', '공급가액 6,345,500원(부가가치세 별도)',
    '합계 6,980,050원입니다.', '단가 906,500원 × 산입 7명', '2026년 9월 22일(화)',
    '야외 현장 안전교육', '환경보호 캠페인 버스킹', '시민 대상 인식 개선 활동',
    '현장 사진은 압축파일로 함께 보내드립니다.', '세금계산서는 별도 발행할 예정',
  ]) assert.ok(output.body.includes(expected), expected);
  assert.deepEqual(output.attachments, ['1. 2026-09_[TEST] 회사 A_공문견적결과보고서.pdf 1부', '2. 9월 현장 사진자료 압축파일 1건']);
});

test('removing or disabling a program removes every busking mention', () => {
  for (const programs of [[], [{ name: '환경보호 캠페인 버스킹', enabled: false }]]) {
    const input = fixture(); input.monthly.programs = programs;
    const body = email.generate(input).body;
    assert.match(body, /지역사회 환경정비 용역과 야외 현장 안전교육을 수행했습니다\./);
    assert.doesNotMatch(body, /버스킹|시민 대상 인식 개선/);
  }
});

test('indoor video education replaces outdoor wording', () => {
  const input = fixture(); input.monthly.safetyEducation = 'indoor_video';
  const body = email.generate(input).body;
  assert.match(body, /실내 영상 안전교육/); assert.doesNotMatch(body, /야외/);
});

test('photos OFF removes photo paragraph, ESG paragraph and ZIP attachment together', () => {
  const input = fixture(); input.includePhotos = false;
  const output = email.generate(input);
  assert.doesNotMatch(output.body, /사진|압축파일|ESG|홍보 연계/);
  assert.equal(output.attachments.length, 1);
  assert.match(output.body, /\.pdf 1부/);
});

test('October scenario changes every month, date, weekday and filename without September text', () => {
  const input = fixture();
  input.monthly = { ...input.monthly, yearMonth: '2026-10', serviceDate: '2026-10-22', programs: [], safetyEducation: 'indoor_video' };
  input.calculation.yearMonth = '2026-10'; input.company.pdfFilename = '2026-10_[TEST] 회사 A_공문견적결과보고서.pdf';
  const output = email.generate(input);
  assert.match(output.subject, /2026년 10월/); assert.match(output.body, /2026년 10월 22일\(목\)/);
  assert.match(output.body, /10월 현장 사진자료/); assert.doesNotMatch(output.body, /9월|2026-09|버스킹/);
});

test('changing company never mixes company, amounts or attachment from previous generation', () => {
  const first = fixture(); const before = email.generate(first); const second = fixture();
  second.company = { id: 'test-b', name: '[TEST] 회사 B', pdfFilename: '2026-09_[TEST] 회사 B_공문견적결과보고서.pdf' };
  second.calculation = { ...second.calculation, companyId: 'test-b', equityRate: 10, appliedHeadcount: 4, supplyAmount: 3626000, vatIncludedAmount: 3988600 };
  const after = email.generate(second);
  assert.equal(after.companyId, 'test-b');
  assert.match(after.body, /고용산입 인원은 4명/); assert.match(after.body, /3,626,000원/);
  assert.match(after.body, /3,988,600원/); assert.match(after.body, /지분율 10%/);
  assert.doesNotMatch(after.body, /회사 A|6,345,500|6,980,050|17\.5%/);
  assert.equal(email.generate(first).body, before.body);
});

test('mail uses supplied calculation outputs unchanged, without its own money calculation', () => {
  const input = fixture(); input.calculation.appliedHeadcount = 5;
  input.calculation.supplyAmount = 1234567; input.calculation.vatIncludedAmount = 1358024;
  const output = email.generate(input);
  assert.match(output.body, /1,234,567원/); assert.match(output.body, /1,358,024원/);
  assert.match(output.body, /906,500원 × 산입 5명/);
  assert.equal(input.calculation.supplyAmount, 1234567);
});

test('stale calculation from another company or month is rejected', () => {
  for (const change of [{ companyId: 'test-b' }, { yearMonth: '2026-10' }]) {
    const input = fixture(); Object.assign(input.calculation, change);
    assert.throws(() => email.generate(input), /CALCULATION_DOCUMENT_MISMATCH/);
  }
});

test('strict date validation and weekday stay independent of timezone', () => {
  assert.equal(email.dateLabel('2026-09-22'), '2026년 9월 22일(화)');
  assert.equal(email.dateLabel('2028-02-29'), '2028년 2월 29일(화)');
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-9-22', '', null, '2026-09-22T00:00:00Z']) {
    assert.throws(() => email.dateLabel(date), /INVALID_SERVICE_DATE/);
  }
});

test('invalid, missing and unsafe numeric values never become a plausible mail', () => {
  for (const value of [null, undefined, '', '7', NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture(); input.calculation.appliedHeadcount = value;
    assert.throws(() => email.generate(input), /INVALID_APPLIED_HEADCOUNT/);
  }
  for (const equityRate of [-1, 101, '17.5']) {
    const input = fixture(); input.calculation.equityRate = equityRate;
    assert.throws(() => email.generate(input), /INVALID_EQUITY_RATE/);
  }
  const input = fixture(); input.calculation.errors = ['CAP_EXCEEDED'];
  assert.throws(() => email.generate(input), /INVALID_CALCULATION/);
});

test('incorrect PDF filename cannot produce another company or month attachment', () => {
  for (const filename of ['2026-09_other.pdf', '2026-10_[TEST] 회사 A.pdf', '2026-09_[TEST] 회사 A.txt', '2026-09_[TEST] 회사 A.pdf\nsecret']) {
    const input = fixture(); input.company.pdfFilename = filename;
    assert.throws(() => email.generate(input), /INVALID_PDF_FILENAME/);
  }
});

test('unknown education, invalid month and ambiguous ON/OFF values are rejected', () => {
  const input = fixture(); input.monthly.safetyEducation = 'unknown';
  assert.throws(() => email.generate(input), /INVALID_SAFETY_EDUCATION/);
  input.monthly.safetyEducation = 'outdoor'; input.includePhotos = 'false';
  assert.throws(() => email.generate(input), /INVALID_INCLUDE_PHOTOS/);
  input.includePhotos = false;
  for (const yearMonth of ['2026-13', '2026-1', '0000-09']) {
    input.monthly.yearMonth = yearMonth;
    assert.throws(() => email.generate(input), /INVALID_YEAR_MONTH/);
  }
});

test('additional program wording uses the natural Korean object particle', () => {
  assert.match(email.activityParagraph('outdoor', [{ name: '음악 연주', enabled: true }]), /음악 연주를 함께 진행/);
  assert.match(email.activityParagraph('indoor_video', [{ name: '환경 정비', enabled: true }, { name: '문화 공연', enabled: true }]), /환경 정비, 문화 공연을 함께 진행/);
});
