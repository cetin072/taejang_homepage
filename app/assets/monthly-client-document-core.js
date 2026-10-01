/* Shared deterministic calculation and formatting for monthly client documents. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonthlyClientDocumentCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'claude-core-1';
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
  const companyIds = new Set(['beomhan', 'samhyeon', 'cheongwoo-bj', 'hyundai-bng-steel']);

  function finite(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
      || (integer && !Number.isSafeInteger(value))) throw new Error(`INVALID_${field}`);
    return value;
  }

  function validateDate(value, field = 'DATE') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`INVALID_${field}`);
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new Error(`INVALID_${field}`);
    }
    return date;
  }

  function dateLabel(value) {
    const date = validateDate(value, 'SERVICE_DATE');
    const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate();
    const weekday = weekdays[date.getUTCDay()];
    return { dot: `${year}. ${month}. ${day}.`, kor: `${year}년 ${month}월 ${day}일(${weekday})`, dotw: `${year}. ${month}. ${day}.(${weekday})` };
  }

  function validateCommon(common) {
    if (!common || typeof common !== 'object') throw new Error('MISSING_COMMON_INPUT');
    finite(common.year, 'YEAR', { min: 2000, max: 9999, integer: true });
    finite(common.month, 'MONTH', { min: 1, max: 12, integer: true });
    validateDate(common.docDate, 'DOCUMENT_DATE');
    validateDate(common.perfDate, 'SERVICE_DATE');
    if (typeof common.place !== 'string' || !common.place.trim()) throw new Error('INVALID_PLACE');
    if (!['outdoor', 'indoor'].includes(common.safety)) throw new Error('INVALID_SAFETY');
    if (typeof common.note !== 'string') throw new Error('INVALID_COMMON_NOTE');
    for (const key of ['severe', 'mildF', 'mildM']) finite(common[key], key.toUpperCase(), { integer: true });
    finite(common.base, 'BASE');
    finite(common.rate, 'RATE', { max: 100 });
    if (!Array.isArray(common.extras)) throw new Error('INVALID_EXTRAS');
    common.extras.forEach((extra, index) => {
      if (!extra || typeof extra.name !== 'string' || typeof extra.description !== 'string'
        || (!extra.name.trim() && extra.description.trim())) {
        throw new Error(`INVALID_EXTRA_${index}`);
      }
    });
    return common;
  }

  function validateCompany(company) {
    if (!company || !companyIds.has(company.id)) throw new Error('INVALID_COMPANY');
    if (typeof company.enabled !== 'boolean') throw new Error('INVALID_COMPANY_ENABLED');
    if (typeof company.name !== 'string' || !company.name.trim()) throw new Error('INVALID_COMPANY_NAME');
    finite(company.share, 'SHARE', { max: 100 });
    finite(company.cap, 'CAP', { integer: true });
    if (company.override !== '' && company.override !== null) finite(company.override, 'OVERRIDE', { integer: true });
    finite(company.pay, 'PAY', { min: 1, max: 365, integer: true });
    finite(company.seq, 'SEQ', { min: 1, max: 99, integer: true });
    if (typeof company.note !== 'string') throw new Error('INVALID_COMPANY_NOTE');
    return company;
  }

  function calculate(common, company) {
    validateCommon(common);
    validateCompany(company);
    const A = common.severe, F = common.mildF, Mn = common.mildM;
    const totalCredit = Math.floor(A * 2 + F + Mn * 0.5 + 1e-9);
    if (!Number.isSafeInteger(totalCredit)) throw new Error('INVALID_TOTAL_CREDIT');
    const calculatedHeadcount = Math.floor(totalCredit * company.share / 100 + 1e-9);
    const decimalCredit = (Math.floor(totalCredit * company.share + 1e-9) / 100).toFixed(2);
    const appliedHeadcount = company.override === '' || company.override === null
      ? Math.min(calculatedHeadcount, company.cap) : company.override;
    const unitPrice = Math.floor(common.base * common.rate / 100 + 1e-9);
    const supplyAmount = unitPrice * appliedHeadcount;
    const vatAmount = Math.floor(supplyAmount * 0.1 + 1e-9);
    const totalAmount = supplyAmount + vatAmount;
    if (![unitPrice, supplyAmount, vatAmount, totalAmount].every(Number.isSafeInteger)) throw new Error('INVALID_AMOUNT');
    const warnings = [];
    if (appliedHeadcount > calculatedHeadcount) warnings.push(`적용 ${appliedHeadcount}명이 계산상 최대 ${calculatedHeadcount}명보다 많습니다.`);
    if (appliedHeadcount > company.cap) warnings.push(`적용 ${appliedHeadcount}명이 계약 상한 ${company.cap}명을 넘습니다.`);
    return Object.freeze({
      yearMonth: `${common.year}-${String(common.month).padStart(2, '0')}`, companyId: company.id,
      totalCredit, calculatedHeadcount, decimalCredit, cap: company.cap, appliedHeadcount,
      unitPrice, supplyAmount, vatAmount, totalAmount, reduced: appliedHeadcount < calculatedHeadcount,
      warnings, errors: [],
    });
  }

  function formatAmount(value) { return numberFormat.format(value); }
  function esc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function koreanNumber(number) {
    const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    const units = ['', '십', '백', '천'], large = ['', '만', '억', '조'];
    let rest = number, groups = [], index = 0;
    if (!Number.isSafeInteger(rest) || rest < 0) throw new Error('INVALID_KOREAN_NUMBER');
    if (rest === 0) return '영';
    while (rest > 0) {
      const group = rest % 10000; rest = Math.floor(rest / 10000);
      let text = '';
      for (let power = 3; power >= 0; power--) {
        const digit = Math.floor(group / (10 ** power)) % 10;
        if (digit) text += (digit === 1 && power > 0 ? '' : digits[digit]) + units[power];
      }
      if (text) groups.unshift(text + large[index]);
      index++;
    }
    return groups.join('');
  }

  function particle(word, withFinal, withoutFinal) {
    const code = word.trim().slice(-1).charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return withFinal;
    return (code - 0xac00) % 28 ? withFinal : withoutFinal;
  }

  function buildContent(common, company, calculation) {
    validateCommon(common); validateCompany(company);
    if (!calculation || calculation.yearMonth !== `${common.year}-${String(common.month).padStart(2, '0')}` || calculation.companyId !== company.id) {
      throw new Error('CALCULATION_DOCUMENT_MISMATCH');
    }
    const date = dateLabel(common.docDate), service = dateLabel(common.perfDate);
    const { year, month } = common, ym = `${year}년 ${month}월`;
    const A = common.severe, F = common.mildF, Mn = common.mildM, workers = A + F + Mn, mild = F + Mn;
    const extras = common.extras.filter(item => item.name.trim());
    const seq = `${year}-${String(month).padStart(2, '0')}-${String(company.seq).padStart(2, '0')}`;
    const share = company.share.toFixed(1), n = calculation.appliedHeadcount;
    const breakdown = [`중증 ${A}명 × 2배수`].concat(F > 0 ? [`경증 여성 ${F}명 × 1`] : [], Mn > 0 ? [`경증 남성 ${Mn}명 × 1/2`] : []).join(' + ');
    let c2;
    if (company.note.trim()) c2 = company.note.trim().replace(/^2\.\s*/, '');
    else if (common.note?.trim()) c2 = common.note.trim().replace(/^2\.\s*/, '');
    else if (extras.length) {
      const names = extras.map(item => item.name.trim()).join('·');
      c2 = `${month}월 회차에는 ${names}${particle(names, '을', '를')} 추가하여 지역사회 환경정비와 함께 수행하였습니다.`;
    } else c2 = `${ym} 지역사회 환경정비 용역을 수행하였으며, 수행 결과와 용역비를 안내드립니다.`;
    const c3 = !calculation.reduced
      ? `${ym} 현재 당사가 고용한 장애인 근로자는 ${workers}명(중증 ${A}명, 경증 ${mild}명)이며, 귀사 지분율 ${share}%를 적용한 귀사의 고용산입 인원은 ${n}명입니다.`
      : `${ym} 현재 당사 고용 장애인 근로자는 ${workers}명(중증 ${A}명, 경증 ${mild}명)이며, 귀사 지분율 ${share}% 기준 산입 가능 인원은 최대 ${calculation.calculatedHeadcount}명입니다. 협의에 따라 ${month}월분은 ${n}명을 적용합니다.`;
    const c3n = `※ 산정근거: 당사 총 산입 ${calculation.totalCredit}명(${breakdown}) × 귀사 지분율 ${share}% = ${calculation.decimalCredit} → ${calculation.reduced ? '최대 ' : ''}${calculation.calculatedHeadcount}명, 각 단계 소수점 이하 버림(장애인고용촉진 및 직업재활법 제22조 제3항·제4항, 한국장애인고용공단 산정 기준).`;
    const c4 = `4. 관련 용역은 ${service.kor} ${common.place}에서 지역사회 환경정비 용역으로 수행하였으며, 세부 프로그램은 다음과 같습니다.`;
    const c5n = `※ 산정근거: ${year}년도 장애인 고용부담금 부담기초액 ${formatAmount(common.base)}원(고용노동부 고시) × 지원비율 ${common.rate}% = 1인당 ${formatAmount(calculation.unitPrice)}원. 이에 ${calculation.reduced ? '적용' : '산입'} 인원 ${n}명을 곱하여 공급가액 ${formatAmount(calculation.supplyAmount)}원(= ${formatAmount(calculation.unitPrice)}원 × ${n}명)으로 산정하였습니다.`;
    const education = common.safety === 'outdoor' ? '야외 현장 안전교육' : '실내 안전교육(영상 교육)';
    const programLines = [common.safety === 'outdoor' ? '야외 현장 안전교육 — 작업 전 현장에서 실시하는 안전수칙 교육 및 보호장구 점검' : '실내 안전교육(영상 교육) — 작업 전 안전수칙 교육 및 참석 확인 서명',
      ...extras.map(item => item.description.trim() ? `${item.name.trim()} — ${item.description.trim()}` : item.name.trim()), '지역사회 환경정비 — 공원·거리 일원 폐기물 수거 및 환경 정비'];
    const listC = programLines.map((value, index) => `${'가나다라마바사아'[index]}. ${value}`);
    const reducedNote = calculation.reduced ? ` 귀사 지분율 ${share}% 기준 최대 산입 ${calculation.calculatedHeadcount}명 중 귀사와 협의한 ${n}명을 적용하였습니다.` : ' 실제 산입 인원을 기준으로 정산합니다.';
    const simple = {
      NAME: company.name, SEQ: seq, DATE: date.dot, YM: ym, YY: String(year).slice(2), M: String(month), PERF: service.kor,
      PLACE: common.place, SUPPLY: formatAmount(calculation.supplyAmount), VAT: formatAmount(calculation.vatAmount),
      TOTAL: formatAmount(calculation.totalAmount), KOR: koreanNumber(calculation.totalAmount), N: String(n), PAY: String(company.pay),
      C2: `2. ${c2}`, C3: `3. ${c3}`, C3N: c3n, C4: c4, C5N: c5n,
      Q1: `· 본 견적은 자회사형 장애인 표준사업장 용역계약(별첨2, 용역 제공 기준)에 의거하며,${reducedNote}`,
      Q2: `· 1인당 단가 ${formatAmount(calculation.unitPrice)}원(부담기초액 ${formatAmount(common.base)}원 × ${common.rate}%) × 산입 ${n}명 = 공급가액 ${formatAmount(calculation.supplyAmount)}원.`,
      Q3: `· 용역 내역: ${[education, ...extras.map(item => item.name.trim()), '지역사회 환경정비(폐기물 수거)'].join(', ')} — ${service.dotw} 수행.`,
      R_SAFE: common.safety === 'outdoor'
        ? '· 작업 전 야외 현장 안전교육 실시 및 보호장구 점검, 참석 확인 서명 징구'
        : '· 작업 전 실내 안전교육(영상 교육) 실시 및 참석 확인 서명 징구',
      R_PHOTO: `· 현장 사진자료 별도 첨부 — 압축파일 1건 (${[common.safety === 'outdoor' ? '야외 안전교육' : '실내 안전교육', ...extras.map(item => item.name.trim()), common.place.replace(/\s*일원$/, ''), '단체사진'].join(' / ')})`,
    };
    const listR = [common.safety === 'outdoor' ? '야외 현장 안전교육 및 보호장구 점검' : '실내 안전교육(영상 교육)',
      ...extras.map(item => item.description.trim() ? `${item.name.trim()} — ${item.description.trim()}` : item.name.trim()),
      '공원 및 주변 보행로 구역 환경정비(청소)', '수거 폐기물 분리 및 규정에 따른 배출'].map(item => `· ${item}`);
    return { simple, listC, listR };
  }

  return Object.freeze({ VERSION, calculate, validateCommon, validateCompany, validateDate, dateLabel, buildContent, formatAmount, koreanNumber, esc });
});
