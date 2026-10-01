/* Pure monthly client mail template. The caller owns authorization and calculation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonthlyClientDocumentEmail = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 20 });
  const educationLabels = Object.freeze({
    outdoor: '야외 현장 안전교육',
    indoor: '실내 안전교육(영상 교육)',
  });

  function requiredText(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`INVALID_${field}`);
    return value.trim();
  }

  function number(value, field, integer = true) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || (integer && !Number.isSafeInteger(value))) throw new Error(`INVALID_${field}`);
    return numberFormat.format(value);
  }

  function dateLabel(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('INVALID_SERVICE_DATE');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value
      || date.getUTCFullYear() < 1) throw new Error('INVALID_SERVICE_DATE');
    return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일(${weekdays[date.getUTCDay()]})`;
  }

  function activityParagraph(safetyEducation, programs = []) {
    const education = educationLabels[safetyEducation === 'indoor_video' ? 'indoor' : safetyEducation];
    if (!education) throw new Error('INVALID_SAFETY_EDUCATION');
    if (!Array.isArray(programs)) throw new Error('INVALID_PROGRAMS');
    const enabled = programs.filter(program => {
      if (!program || typeof program.enabled !== 'boolean') throw new Error('INVALID_PROGRAM_ENABLED');
      return program.enabled;
    });
    const names = enabled.map(program => requiredText(program.name, 'PROGRAM_NAME'));
    if (!names.length) return `지역사회 환경정비 용역과 ${education}을 수행했습니다.`;
    const activities = names.join(', ');
    const finalCode = names[names.length - 1].charCodeAt(names[names.length - 1].length - 1);
    const particle = finalCode >= 0xAC00 && finalCode <= 0xD7A3 && (finalCode - 0xAC00) % 28 === 0 ? '를' : '을';
    const outcome = names.includes('환경보호 캠페인 버스킹')
      ? '지역사회 환경정비와 시민 대상 인식 개선 활동을 같이 수행했습니다.'
      : '지역사회 환경정비와 추가 프로그램을 함께 수행했습니다.';
    return `이번 회차에는 ${education}과\n${activities}${particle} 함께 진행하여,\n${outcome}`;
  }

  function generate({ monthly, company, calculation, includePhotos = true } = {}) {
    if (!monthly || !company || !calculation) throw new Error('MISSING_DOCUMENT_DATA');
    if (typeof includePhotos !== 'boolean') throw new Error('INVALID_INCLUDE_PHOTOS');
    const yearMonth = requiredText(monthly.yearMonth, 'YEAR_MONTH');
    if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) throw new Error('INVALID_YEAR_MONTH');
    const [year, month] = yearMonth.split('-').map(Number);
    const companyId = requiredText(company.id, 'COMPANY_ID');
    const companyName = requiredText(company.name, 'COMPANY_NAME');
    if (calculation.yearMonth !== yearMonth || calculation.companyId !== companyId) {
      throw new Error('CALCULATION_DOCUMENT_MISMATCH');
    }
    if (calculation.errors !== undefined
      && (!Array.isArray(calculation.errors) || calculation.errors.length)) throw new Error('INVALID_CALCULATION');
    const totalCredit = number(calculation.totalCredit, 'TOTAL_CREDIT');
    const equityRate = number(calculation.equityRate, 'EQUITY_RATE', false);
    if (calculation.equityRate > 100) throw new Error('INVALID_EQUITY_RATE');
    const appliedHeadcount = number(calculation.appliedHeadcount, 'APPLIED_HEADCOUNT');
    const supplyAmount = number(calculation.supplyAmount, 'SUPPLY_AMOUNT');
    const vatIncludedAmount = number(calculation.vatIncludedAmount, 'VAT_INCLUDED_AMOUNT');
    const unitPrice = number(calculation.unitPrice, 'UNIT_PRICE');
    const serviceDate = dateLabel(monthly.serviceDate);
    const location = requiredText(monthly.serviceLocation, 'SERVICE_LOCATION');
    const activity = activityParagraph(monthly.safetyEducation, monthly.programs);
    const attachmentDisplayName = company.attachmentDisplayName === undefined
      ? companyName : requiredText(company.attachmentDisplayName, 'ATTACHMENT_DISPLAY_NAME');
    const attachmentLabel = company.attachmentLabel === undefined
      ? `${String(year).slice(2)}년 ${month}월 장애인 고용산입 현황 및 용역비 안내_${attachmentDisplayName}`
      : requiredText(company.attachmentLabel, 'ATTACHMENT_LABEL');
    if (/[\r\n]/.test(attachmentLabel) || !attachmentLabel.includes(String(month)) || !attachmentLabel.includes(attachmentDisplayName)) {
      throw new Error('INVALID_ATTACHMENT_LABEL');
    }
    const attachments = [`1. ${attachmentLabel} 1부`];
    if (includePhotos) attachments.push(`2. ${month}월 현장 사진자료 압축파일 1건`);
    const photoParagraph = includePhotos
      ? '\n\n현장 사진은 압축파일로 함께 보내드립니다.\n귀사 ESG 활동 자료로 활용하실 수 있으며,\n별도 홍보 연계가 필요하시면 말씀해 주시기 바랍니다.'
      : '';
    const subject = `[태장] ${year}년 ${month}월 장애인 고용산입 현황 및 용역 수행 자료 송부`;
    const body = `안녕하십니까.
농업회사법인 태장 주식회사 김형철 전무이사입니다.

${year}년 ${month}월분 장애인 고용산입 현황과 용역비 안내,
그리고 ${month}월 용역 수행 결과를 송부드립니다.

1. 고용산입 인원

당사 총 산입 ${totalCredit}명에
귀사 지분율 ${equityRate}%를 적용하여
귀사에 인정되는 고용산입 인원은 ${appliedHeadcount}명입니다.

2. ${month}월분 용역비

공급가액 ${supplyAmount}원(부가가치세 별도),
합계 ${vatIncludedAmount}원입니다.
1인당 단가 ${unitPrice}원 × 산입 ${appliedHeadcount}명 기준입니다.

3. 용역 수행

${serviceDate}
${location}에서 수행하였습니다.

${activity}${photoParagraph}

[첨부]
${attachments.join('\n')}

세금계산서는 별도 발행할 예정이며,
품목 표기나 발행 시기에 요청사항이 있으시면
회신 주시기 바랍니다.

감사합니다.`;
    return { subject, body, companyId, companyName, yearMonth, attachments };
  }

  return Object.freeze({ generate, dateLabel, activityParagraph });
});
