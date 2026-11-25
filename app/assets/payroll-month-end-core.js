(function (root) {
  'use strict';

  const taxEarnings = [[0,3,'기본급'],[0,4,'직책수당'],[0,5,'월차수당'],[0,6,'식대'],
    [0,7,'자가운전보조금'],[0,8,'야간근로수당'],[0,9,'기타수당'],[1,3,'보육수당']];
  const taxDeductions = [[0,10,'국민연금'],[0,11,'건강보험'],[0,12,'장기요양보험'],[0,13,'소득세'],
    [0,14,'지방소득세'],[1,10,'고용보험'],[1,11,'국민연금 정산'],[2,14,'농특세']];
  const compact = value => String(value ?? '').normalize('NFC').replace(/\s/gu, '');
  const taxId = value => compact(value).replace(/^0+(?=\d)/, '');
  const sum = items => items.reduce((total, item) => total + item.amount, 0);

  function won(value, blank = false) {
    const s = String(value ?? '').trim();
    if (blank && !s) return 0;
    if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)) throw new Error('원 단위 정수 금액을 확인해 주세요.');
    const amount = Number(s.replace(/,/g, ''));
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1_000_000_000) throw new Error('급여 금액 범위를 확인해 주세요.');
    return amount;
  }

  function monthEnd(month) {
    const [year, number] = month.split('-').map(Number);
    return month + '-' + new Date(Date.UTC(year, number, 0)).getUTCDate();
  }

  function parseTaxLedger(sheets, month) {
    const candidates = sheets.map(sheet => sheet.matrix).filter(matrix =>
      matrix.some(row => compact(row?.[1]) === '사원번호' && compact(row?.[9]) === '기타수당'));
    if (candidates.length !== 1) throw new Error('세무사무실 급여대장 시트 한 개를 확인해 주세요.');
    const matrix = candidates[0];
    const titles = matrix.flatMap(row => row || []).filter(value => typeof value === 'string');
    const periods = new Set(titles.map(text => text.match(/(\d{4})년\s*(\d{1,2})월분\s*급여대장/))
      .filter(Boolean).map(m => m[1] + '-' + m[2].padStart(2, '0')));
    const dates = new Set(titles.map(text => text.match(/지급일\s*[:：]\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/))
      .filter(Boolean).map(m => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0')));
    if (periods.size !== 1 || !periods.has(month)) throw new Error('회신 Excel의 급여월이 선택한 월과 다릅니다.');
    if (dates.size !== 1 || !dates.has(monthEnd(month))) throw new Error('회신 Excel의 지급일을 선택한 월의 말일과 확인해 주세요.');
    const records = [];
    const seen = new Set();
    let layout = false;
    matrix.forEach((row, index) => {
      if (compact(row?.[1]) === '사원번호') {
        const h = offset => matrix[index + offset] || [];
        layout = compact(h(0)[2]) === '성명' && compact(h(2)[9]) === '지급합계'
          && compact(h(1)[15]) === '공제합계' && compact(h(2)[15]) === '차인지급액'
          && [...taxEarnings, ...taxDeductions].every(([off, col, name]) => compact(h(off)[col]) === compact(name));
        if (!layout) throw new Error('세무 급여대장의 항목 배치가 기존 양식과 다릅니다.');
        return;
      }
      if (!layout || !/^\d{1,16}$/.test(compact(row?.[1]))) return;
      const tax_id = taxId(row[1]);
      const name = String(row[2] || '').trim();
      if (!name || seen.has(tax_id)) throw new Error('세무 사번이 중복되거나 직원명이 비어 있습니다.');
      seen.add(tax_id);
      const cell = (offset, col) => matrix[index + offset]?.[col];
      const amounts = items => items.map(([offset, col, label]) => ({label, amount: won(cell(offset, col), true)}))
        .filter(item => item.amount !== 0);
      const earnings = amounts(taxEarnings);
      const deductions = amounts(taxDeductions);
      const gross = won(cell(2,9));
      const deduction = won(cell(1,15), true);
      const net = won(cell(2,15));
      if (gross - deduction !== net || gross !== sum(earnings) || deduction !== sum(deductions)) {
        throw new Error(`회신 Excel ${index + 1}행의 지급·공제 합계를 확인해 주세요.`);
      }
      records.push({tax_id, name, gross, deduction, net, earnings, deductions});
    });
    if (!records.length) throw new Error('회신 Excel에서 급여 지급 행을 찾지 못했습니다.');
    return records;
  }

  function compare(rows, reply) {
    const taxRows = new Map(reply.map(row => [taxId(row.tax_id), row]));
    const result = rows.map(expected => {
      const key = taxId(expected.tax_id);
      const received = taxRows.get(key);
      taxRows.delete(key);
      const status = !received ? '회신 누락'
        : compact(received.name) !== compact(expected.name) ? '이름 불일치'
        : received.gross !== expected.gross || received.deduction !== expected.deduction ? '금액 차이'
        : '일치';
      return {expected, received, status};
    });
    for (const received of taxRows.values()) result.push({received, status: 'ERP 대상 없음'});
    return result.sort((a, b) => Number(a.status === '일치') - Number(b.status === '일치'));
  }

  function draftWorkbook(month, draft, version, exporter) {
    const workDates = [...new Set(draft.rows.flatMap(row => row.days.map(day => day.date)))].sort();
    return exporter.buildTableWorkbookXlsx([
      { name: '급여대장 초안', title: month + ' 급여대장 초안', note: `지급일 ${monthEnd(month)} · 근태 기준일 ${draft.cutoff} · 버전 ${version}`,
        headers: ['ERP 사번','세무 사번','성명','구분','지급합계','공제합계','실지급액','산출 근거 및 정산 메모'],
        rows: draft.rows.map(row => [row.employee_id,row.tax_id,row.name,row.staff ? '직원' : '임원',row.gross,row.deduction,row.gross-row.deduction,row.basis]),
        widths: [17,14,15,12,16,16,16,46] },
      { name: '일자별 근태', title: month + ' 월중 근태', note: '괄호 안 숫자는 분 단위입니다. 예정과 근태 확인 필요를 구분했습니다.',
        headers: ['ERP 사번','성명',...workDates],
        rows: draft.rows.map(row => {
          const byDate = new Map(row.days.map(day => [day.date,day]));
          return [row.employee_id,row.name,...workDates.map(date => {
            const day = byDate.get(date);
            return day ? day.label + (day.minutes == null ? '' : ` (${day.minutes})`) : '';
          })];
        }), widths: [17,15,...workDates.map(() => 19)] },
    ]);
  }

  const api = { parseTaxLedger, compare, monthEnd, won, compact, taxId, draftWorkbook };
  root.TaejangMonthEndPayrollCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
