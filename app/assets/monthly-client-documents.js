/* Operations-only monthly client document workflow. Database RPCs remain authoritative. */
(() => {
  'use strict';
  const CAPABILITY = 'monthly_client_documents.manage';
  const ids = ['beomhan', 'samhyeon', 'cheongwoo-bj', 'hyundai-bng-steel'];
  const el = (tag, value = '', className = '') => {
    const node = document.createElement(tag);
    if (value !== undefined && value !== null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  };
  const field = (labelText, value, type, onChange, options = {}) => {
    const label = el('label', undefined, 'mcd-field'); label.append(el('span', labelText));
    let input;
    if (type === 'textarea') { input = el('textarea'); input.value = value ?? ''; }
    else if (type === 'select') {
      input = el('select'); options.choices.forEach(([choice, text]) => { const option = el('option', text); option.value = choice; input.append(option); });
      input.value = value ?? '';
    } else { input = el('input'); input.type = type || 'text'; input.value = value ?? ''; }
    input.required = Boolean(options.required);
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step !== undefined) input.step = options.step;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.checked !== undefined) input.checked = options.checked;
    input.addEventListener('input', () => onChange(input.type === 'checkbox' ? input.checked : input.value));
    input.addEventListener('change', () => onChange(input.type === 'checkbox' ? input.checked : input.value));
    label.append(input); return label;
  };
  const button = (label, action, primary = false) => {
    const node = el('button', label, `button mcd-button${primary ? ' primary' : ''}`);
    node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
  const currentCapability = () => window.TaejangApp?.hasCapabilityContract?.() && window.TaejangApp.can?.(CAPABILITY) === true;
  let root, statusNode, state, record = null, revision = 0, savedFingerprint = '', busy = false, emailState = null;
  const emailDrafts = new Map();

  function commonFromDefaults(year, month) {
    return { year, month, docDate: '', perfDate: '', place: '창원 팔용근린공원 일원', safety: 'outdoor', severe: 20, mildF: 0, mildM: 3,
      base: 1295000, rate: 70, note: '', extras: [] };
  }
  function defaultsToMonth(defaults, year, month) {
    return { common: commonFromDefaults(year, month), companies: defaults.map(company => ({ ...company, enabled: true, override: company.override ?? '', note: '' })) };
  }
  function report(message, error = false) {
    statusNode.textContent = message; statusNode.classList.toggle('error', error); statusNode.hidden = !message;
  }
  function fingerprint() { return JSON.stringify(state); }
  function latestCalculations() {
    const active = state.companies.filter(company => company.enabled);
    const used = new Set();
    const results = [];
    active.forEach(company => {
      const calculation = window.MonthlyClientDocumentCore.calculate(state.common, company);
      if (used.has(company.seq)) throw new Error('문서 순번이 중복되었습니다. 회사별 순번을 확인하세요.');
      used.add(company.seq);
      results.push({ company, calculation });
    });
    if (!results.length) throw new Error('회사 한 곳 이상을 선택하세요.');
    const warnings = results.flatMap(({ company, calculation }) => calculation.warnings.map(item => `${company.key}: ${item}`));
    return { results, warnings };
  }
  function updateEmailStaleness() {
    if (!emailState) return;
    if (emailState.sourceFingerprint !== fingerprint()) {
      emailState.stale = true;
      const stale = emailState.dialog.querySelector('[data-mcd-email-stale]');
      if (stale) stale.hidden = false;
    }
  }
  function changed() { updateEmailStaleness(); drawSummary(); }
  function editableInput() { return record?.status !== 'confirmed'; }

  function drawSummary() {
    const target = root.querySelector('[data-mcd-summary]');
    const warningsTarget = root.querySelector('[data-mcd-warnings]');
    target.replaceChildren(); warningsTarget.replaceChildren();
    let ready = true;
    const versionsMatch = !record || (record.calculationVersion === window.MonthlyClientDocumentCore.VERSION
      && record.templateVersion === window.MonthlyClientDocumentDocx.TEMPLATE_VERSION);
    if (!versionsMatch) {
      ready = false;
      warningsTarget.append(el('p', '이 월은 현재 계산/문서 원본 버전과 달라 출력할 수 없습니다. 기존 snapshot을 보존하고 호환 버전을 준비해야 합니다.', 'mcd-warning'));
    }
    try {
      const { results, warnings } = latestCalculations();
      const tableWrap = el('div', undefined, 'mcd-table-wrap'); const table = el('table', undefined, 'mcd-table');
      const header = el('tr'); ['회사', '계산 최대', '적용', '공급가액', '부가세', '합계', '공문 번호'].forEach(text => header.append(el('th', text))); table.append(header);
      results.forEach(({ company, calculation }) => {
        const row = el('tr');
        [company.key, `${calculation.calculatedHeadcount}명`, `${calculation.appliedHeadcount}명`,
          `${window.MonthlyClientDocumentCore.formatAmount(calculation.supplyAmount)}원`,
          `${window.MonthlyClientDocumentCore.formatAmount(calculation.vatAmount)}원`,
          `${window.MonthlyClientDocumentCore.formatAmount(calculation.totalAmount)}원`,
          `태장 제${state.common.year}-${String(state.common.month).padStart(2,'0')}-${String(company.seq).padStart(2,'0')}호`].forEach(text => row.append(el('td', text)));
        table.append(row);
      });
      tableWrap.append(table); target.append(tableWrap);
      if (warnings.length) { ready = false; warnings.forEach(message => warningsTarget.append(el('p', `⚠ ${message}`, 'mcd-warning'))); }
    } catch (error) { ready = false; warningsTarget.append(el('p', `⚠ ${error.message || '계산 입력을 확인하세요.'}`, 'mcd-warning')); }
    const confirmed = record?.status === 'confirmed';
    root.querySelector('[data-mcd-confirm]').disabled = !ready || confirmed || busy || !record || fingerprint() !== savedFingerprint;
    root.querySelector('[data-mcd-docx-all]').disabled = !ready || !confirmed || busy;
    root.querySelectorAll('[data-mcd-docx-one]').forEach(node => {
      const company = state.companies.find(item => item.id === node.dataset.companyId);
      node.disabled = !ready || !confirmed || busy || !company?.enabled;
    });
    root.querySelector('[data-mcd-save]').disabled = confirmed || busy;
    root.querySelector('[data-mcd-unconfirm]').disabled = !confirmed || busy;
    root.querySelectorAll('.mcd-field input,.mcd-field textarea,.mcd-field select').forEach(node => { node.disabled = confirmed || busy; });
    root.querySelector('[data-mcd-confirm]').setAttribute('aria-describedby', 'mcd-warnings');
  }

  async function downloadCompanies(companies) {
    if (!currentCapability()) throw new Error('이 문서를 만들 권한이 없습니다.');
    if (!record || record.status !== 'confirmed' || fingerprint() !== savedFingerprint) throw new Error('저장된 확정 월만 DOCX를 받을 수 있습니다. 먼저 저장하고 확정하세요.');
    if (record.calculationVersion !== window.MonthlyClientDocumentCore.VERSION
      || record.templateVersion !== window.MonthlyClientDocumentDocx.TEMPLATE_VERSION) throw new Error('이 월은 저장 당시 문서 원본 버전과 달라 DOCX를 재현할 수 없습니다.');
    const { warnings } = latestCalculations();
    if (warnings.length) throw new Error(warnings.join(' '));
    const assets = await window.MonthlyClientDocumentDocx.loadAssets();
    const blob = await window.MonthlyClientDocumentDocx.createDocx({ template: assets.template, packageBytes: assets.packageBytes,
      common: state.common, companies, type: 'blob' });
    const filename = window.MonthlyClientDocumentDocx.filename(state.common, companies);
    const url = URL.createObjectURL(blob); const anchor = el('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    report(`DOCX를 만들었습니다: ${filename}`);
  }

  function emailFor(company, calculation, includePhotos = true) {
    return window.MonthlyClientDocumentEmail.generate({
      monthly: { yearMonth: calculation.yearMonth, serviceDate: state.common.perfDate, serviceLocation: state.common.place,
        safetyEducation: state.common.safety, programs: state.common.extras.filter(extra => extra.name.trim()).map(extra => ({ name: extra.name, enabled: true })) },
      company: { id: company.id, name: company.name, attachmentDisplayName: company.key,
        attachmentLabel: `01. ${String(state.common.year).slice(2)}년 ${state.common.month}월 장애인 고용산입 현황 및 용역비 안내_${company.key}` },
      calculation: { yearMonth: calculation.yearMonth, companyId: company.id, totalCredit: calculation.totalCredit,
        equityRate: company.share, appliedHeadcount: calculation.appliedHeadcount, supplyAmount: calculation.supplyAmount,
        vatIncludedAmount: calculation.totalAmount, unitPrice: calculation.unitPrice, errors: calculation.warnings },
      includePhotos,
    });
  }
  function showEmail(company) {
    if (!currentCapability() || record?.status !== 'confirmed' || fingerprint() !== savedFingerprint) {
      report('저장 후 확정된 월에서 메일 초안을 열 수 있습니다.', true); return;
    }
    let calculation;
    try { calculation = window.MonthlyClientDocumentCore.calculate(state.common, company); }
    catch (error) { report(error.message, true); return; }
    if (calculation.warnings.length) { report(calculation.warnings.join(' '), true); return; }
    const generated = emailFor(company, calculation);
    const draftKey = `${company.id}:${calculation.yearMonth}`;
    if (emailState) emailDrafts.set(`${emailState.companyId}:${emailState.yearMonth}`, emailState);
    emailState = emailDrafts.get(draftKey) || null;
      if (emailState?.dirty && emailState.sourceFingerprint !== fingerprint()) {
        emailState.stale = true;
        report('문서 데이터가 변경되었습니다. 수동 편집 초안은 보존했습니다.', true);
        return showEmailDialog(company, generated, calculation);
    }
    showEmailDialog(company, generated, calculation);
  }
  function showEmailDialog(company, generated, calculation) {
    let dialog = emailState?.companyId === company.id ? emailState.dialog : null;
    const existingState = emailState?.companyId === company.id ? emailState : null;
    if (!dialog) {
      dialog = el('dialog', undefined, 'mcd-email-dialog'); dialog.setAttribute('aria-labelledby', 'mcd-email-title');
      const form = el('form'); form.method = 'dialog';
      form.append(el('h2', `${company.key} 메일 초안`, '',));
      form.firstChild.id = 'mcd-email-title';
      const stale = el('p', '문서 데이터가 변경되었습니다. 새 자동초안을 적용할 수 있습니다.', 'mcd-warning'); stale.dataset.mcdEmailStale = '1'; stale.hidden = true; form.append(stale);
      const subjectLabel = el('label', undefined, 'mcd-field'); subjectLabel.append(el('span', '제목'));
      const subject = el('input'); subject.type = 'text'; subject.dataset.emailSubject = '1'; subjectLabel.append(subject); form.append(subjectLabel);
      const bodyLabel = el('label', undefined, 'mcd-field'); bodyLabel.append(el('span', '본문'));
      const body = el('textarea'); body.rows = 18; body.dataset.emailBody = '1'; bodyLabel.append(body); form.append(bodyLabel);
      const includePhotos = el('input'); includePhotos.type = 'checkbox'; includePhotos.checked = true; includePhotos.dataset.emailPhotos = '1';
      const photoLabel = el('label', undefined, 'mcd-check'); photoLabel.append(includePhotos, el('span', '현장사진 첨부 안내 포함')); form.append(photoLabel);
      const attachments = el('ul'); attachments.dataset.emailAttachments = '1'; form.append(el('h3', '첨부 예정 목록'), attachments);
      const actions = el('div', undefined, 'mcd-actions');
      actions.append(button('새 자동초안 적용', () => applyNewEmailDraft(company, calculation), false),
        button('제목 복사', () => copyText(subject.value), false), button('본문 복사', () => copyText(body.value), false),
        button('닫기', () => dialog.close(), false)); form.append(actions); dialog.append(form); document.body.append(dialog);
      emailState = { companyId: company.id, yearMonth: calculation.yearMonth, dialog, dirty: false, stale: false, sourceFingerprint: fingerprint() };
      emailDrafts.set(`${company.id}:${calculation.yearMonth}`, emailState);
      subject.addEventListener('input', () => { emailState.dirty = true; emailState.subject = subject.value; });
      body.addEventListener('input', () => { emailState.dirty = true; emailState.body = body.value; });
      includePhotos.addEventListener('change', () => {
        if (emailState.dirty) {
          emailState.stale = true; dialog.querySelector('[data-mcd-email-stale]').hidden = false;
          return;
        }
        const nextCalculation = window.MonthlyClientDocumentCore.calculate(state.common, company);
        const next = emailFor(company, nextCalculation, includePhotos.checked);
        subject.value = next.subject; body.value = next.body;
        dialog.querySelector('[data-email-attachments]').replaceChildren(...next.attachments.map(item => el('li', item)));
        emailState.subject = next.subject; emailState.body = next.body; emailState.sourceFingerprint = fingerprint();
      });
    }
    emailState.companyId = company.id;
    emailState.yearMonth = calculation.yearMonth;
    emailDrafts.set(`${company.id}:${calculation.yearMonth}`, emailState);
    const subject = dialog.querySelector('[data-email-subject]'), body = dialog.querySelector('[data-email-body]');
    const dirtyDataChanged = Boolean(existingState?.dirty && existingState.sourceFingerprint !== fingerprint());
    if (!existingState?.dirty) {
      subject.value = generated.subject; body.value = generated.body;
      emailState.subject = generated.subject; emailState.body = generated.body; emailState.sourceFingerprint = fingerprint();
      dialog.querySelector('[data-email-photos]').checked = true;
      dialog.querySelector('[data-email-attachments]').replaceChildren(...generated.attachments.map(item => el('li', item)));
      emailState.stale = false;
    }
    if (dirtyDataChanged || emailState.stale) {
      emailState.stale = true; dialog.querySelector('[data-mcd-email-stale]').hidden = false;
    } else dialog.querySelector('[data-mcd-email-stale]').hidden = true;
    dialog.showModal();
  }
  function applyNewEmailDraft(company, calculation) {
    const currentCalculation = window.MonthlyClientDocumentCore.calculate(state.common, company);
    const includePhotos = emailState.dialog.querySelector('[data-email-photos]').checked;
    const generated = emailFor(company, currentCalculation, includePhotos), dialog = emailState.dialog;
    dialog.querySelector('[data-email-subject]').value = generated.subject;
    dialog.querySelector('[data-email-body]').value = generated.body;
    dialog.querySelector('[data-email-attachments]').replaceChildren(...generated.attachments.map(item => el('li', item)));
    emailState.subject = generated.subject; emailState.body = generated.body; emailState.dirty = false;
    emailState.stale = false; emailState.sourceFingerprint = fingerprint(); dialog.querySelector('[data-mcd-email-stale]').hidden = true;
  }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); report('클립보드에 복사했습니다.'); }
    catch { report('클립보드에 접근할 수 없습니다. 텍스트를 선택해 직접 복사해 주세요.', true); }
  }

  function render() {
    if (!currentCapability()) { report('월별 거래처 문서 관리 권한이 없습니다.', true); return; }
    root.replaceChildren();
    root.append(el('header', undefined, 'mcd-header'));
    root.querySelector('.mcd-header').append(el('p', '업무 운영 · 월별 문서', 'eyebrow'), el('h2', '거래처 문서 관리'),
      el('p', '월별 snapshot을 저장하고 확정한 뒤 회사별 또는 4사 DOCX를 생성합니다.'));
    const top = el('section', undefined, 'mcd-panel'); top.append(el('h3', '기준 월'));
    const pickers = el('div', undefined, 'mcd-grid');
    pickers.append(field('연도', state.common.year, 'number', value => { state.common.year = Number(value); changed(); }, { min: 2000, max: 9999, required: true }),
      field('월', state.common.month, 'number', value => { state.common.month = Number(value); changed(); }, { min: 1, max: 12, required: true }));
    top.append(pickers);
    const select = el('select'); select.dataset.mcdHistory = '1';
    const options = [...state.history].sort((a,b) => `${b.year}-${b.month}`.localeCompare(`${a.year}-${a.month}`));
    options.forEach(item => { const option = el('option', `${item.year}년 ${item.month}월 · ${item.status === 'confirmed' ? '확정' : '작성중'}`); option.value = monthKey(item.year,item.month); select.append(option); });
    select.value = monthKey(state.common.year, state.common.month);
    select.addEventListener('change', () => {
      if (fingerprint() !== savedFingerprint && !window.confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 다른 월을 불러올까요?')) {
        render(); return;
      }
      loadMonth(...select.value.split('-').map(Number));
    });
    top.append(field('저장된 월 불러오기', '', '', () => {})); top.lastChild.replaceChildren(el('span', '저장된 월 불러오기'), select);
    top.append(el('p', `상태: ${record?.status === 'confirmed' ? '확정' : '작성중'} · revision ${revision}`, 'mcd-status-line'));
    const actions = el('div', undefined, 'mcd-actions');
    actions.append(button('지난달 기준 새 월 복사', copyPrevious), button('회사 기본값 저장', saveDefaults)); top.append(actions); root.append(top);

    const commonPanel = el('section', undefined, 'mcd-panel'); commonPanel.append(el('h3', '공통 입력'));
    const grid = el('div', undefined, 'mcd-grid');
    const commonField = (label, key, type = 'text', opts = {}) => grid.append(field(label, state.common[key], type,
      value => { state.common[key] = type === 'number' ? (value === '' ? '' : Number(value)) : value; changed(); }, opts));
    commonField('문서 작성일', 'docDate', 'date', { required: true }); commonField('수행일', 'perfDate', 'date', { required: true });
    commonField('수행 장소', 'place', 'text', { required: true });
    grid.append(field('안전교육 방식', state.common.safety, 'select', value => { state.common.safety = value; changed(); }, { choices: [['outdoor','야외 현장 안전교육'], ['indoor','실내 안전교육(영상 교육)']] }));
    commonField('중증 근로자(명)', 'severe', 'number', { min: 0, required: true }); commonField('경증 여성(명)', 'mildF', 'number', { min: 0, required: true });
    commonField('경증 남성(명)', 'mildM', 'number', { min: 0, required: true }); commonField('부담기초액(원)', 'base', 'number', { min: 0, required: true });
    commonField('지원비율(%)', 'rate', 'number', { min: 0, max: 100, step: '0.1', required: true });
    commonPanel.append(grid, field('공문 2항 공통 문구', state.common.note, 'textarea', value => { state.common.note = value; changed(); }));
    const extras = el('div', undefined, 'mcd-extras');
    state.common.extras.forEach((extra,index) => {
      const row = el('div', undefined, 'mcd-grid mcd-extra');
      const remove = button('삭제', () => { state.common.extras.splice(index,1); render(); }); remove.disabled = !editableInput() || busy;
      row.append(field('추가 프로그램 이름', extra.name, 'text', value => { extra.name=value; changed(); }),
        field('설명', extra.description, 'text', value => { extra.description=value; changed(); }),
        remove); extras.append(row);
    });
    const addExtra = button('+ 프로그램 추가', () => { state.common.extras.push({ name:'', description:'' }); render(); });
    addExtra.disabled = !editableInput() || busy; extras.append(addExtra); commonPanel.append(extras); root.append(commonPanel);

    const companyPanel = el('section', undefined, 'mcd-panel'); companyPanel.append(el('h3', '회사별 snapshot 설정'));
    state.companies.forEach((company,index) => {
      const card = el('article', undefined, `mcd-company${company.enabled ? '' : ' off'}`);
      const title = el('h4'); const enabled = el('input'); enabled.type='checkbox'; enabled.checked=company.enabled;
      enabled.disabled = record?.status === 'confirmed' || busy;
      enabled.addEventListener('change', () => { company.enabled=enabled.checked; changed(); }); title.append(enabled, el('span', ` ${company.key}`)); card.append(title);
      const fields = el('div', undefined, 'mcd-grid');
      const companyField = (label,key,type='text',opts={}) => fields.append(field(label,company[key],type,value=>{company[key]=type==='number'?(value===''?'':Number(value)):value;changed();},opts));
      companyField('수신 상호(등록증 표기)','name','text',{required:true}); companyField('지분율(%)','share','number',{min:0,max:100,step:'0.1',required:true});
      companyField('계약 상한(명)','cap','number',{min:0,required:true}); companyField('적용 인원 override (비우면 자동)','override','number',{min:0});
      companyField('지급기한(일)','pay','number',{min:1,required:true}); companyField('문서 순번','seq','number',{min:1,max:99,required:true});
      companyField('공문 2항 개별 문구','note','textarea'); card.append(fields);
      const companyActions = el('div', undefined, 'mcd-actions');
      const getCalculation = () => window.MonthlyClientDocumentCore.calculate(state.common,company);
    const companyDocx = button('DOCX 받기', async () => { try { await downloadCompanies([company]); } catch (error) { report(error.message,true); } });
      companyDocx.dataset.mcdDocxOne = '1'; companyDocx.dataset.companyId = company.id; companyDocx.disabled = !company.enabled;
      const emailButton = button('메일 초안', () => showEmail(company)); emailButton.disabled = !company.enabled;
      companyActions.append(companyDocx, emailButton); card.append(companyActions); companyPanel.append(card);
    }); root.append(companyPanel);
    const resultPanel = el('section', undefined, 'mcd-panel'); resultPanel.append(el('h3', '계산 요약'));
    const warnings = el('div'); warnings.id='mcd-warnings'; warnings.dataset.mcdWarnings='1'; warnings.setAttribute('role','alert'); resultPanel.append(warnings);
    const summary = el('div'); summary.dataset.mcdSummary='1'; resultPanel.append(summary);
    const outputActions = el('div', undefined, 'mcd-actions');
    const save = button('저장', saveMonth, true); save.dataset.mcdSave='1';
    const confirm = button('확정', confirmMonth, true); confirm.dataset.mcdConfirm='1';
    const unconfirm = button('확정 해제', unconfirmMonth); unconfirm.dataset.mcdUnconfirm='1';
    const docxAll = button('선택 회사 DOCX 합본', async () => { try { const active = state.companies.filter(company=>company.enabled); await downloadCompanies(active); } catch(error){ report(error.message,true); } }); docxAll.dataset.mcdDocxAll='1';
    outputActions.append(save,confirm,unconfirm,docxAll); resultPanel.append(outputActions); root.append(resultPanel);
    const notice = el('p', undefined, 'mcd-inline-status'); notice.dataset.mcdStatus='1'; notice.hidden=true; root.append(notice); statusNode = notice;
    drawSummary();
  }

  async function rpc(name, args = {}) {
    if (!currentCapability()) throw new Error('FORBIDDEN');
    return window.TaejangApp.rpc(name, args);
  }
  async function loadData() {
    if (!currentCapability()) throw new Error('FORBIDDEN');
    const data = await rpc('monthly_client_documents_get');
    state = { defaults: data.defaults || [], history: data.months || [], common: null, companies: null };
    if (!ids.every(id => state.defaults.some(item => item.id === id))) throw new Error('회사 기본값을 불러오지 못했습니다.');
    const now = new Date(); const month = now.getMonth() + 1;
    await loadMonth(now.getFullYear(), month, false);
  }
  async function loadMonth(year, month, redraw = true) {
    if (month < 1 || month > 12 || year < 2000 || year > 9999) return report('연도와 월을 확인하세요.', true);
    const result = await rpc('monthly_client_documents_get_month', { p_year: year, p_month: month });
    record = result || null; revision = Number(record?.revision || 0);
    const payload = record?.payload;
    const values = payload?.common ? payload : defaultsToMonth(state.defaults,year,month);
    state.common = { ...commonFromDefaults(year,month), ...values.common, year, month, extras: Array.isArray(values.common.extras) ? values.common.extras : [] };
    state.companies = ids.map(id => ({ ...state.defaults.find(item=>item.id===id), ...(values.companies || []).find(item=>item.id===id), enabled: (values.companies || []).find(item=>item.id===id)?.enabled ?? true }));
    savedFingerprint = fingerprint();
    if (redraw && root) render();
  }
  async function saveMonth() {
    let message = '', isError = false;
    try {
      busy=true; drawSummary();
      const response = await rpc('monthly_client_documents_save', { p_year: state.common.year, p_month: state.common.month,
        p_payload: { common: state.common, companies: state.companies }, p_expected_revision: revision });
      record = response; revision = Number(response.revision); state.history = await rpc('monthly_client_documents_list');
      savedFingerprint = fingerprint(); message = '월별 snapshot을 저장했습니다.';
    } catch(error) { message = `저장 실패: ${error.message || error}`; isError = true; }
    finally { busy=false; render(); report(message, isError); }
  }
  async function confirmMonth() {
    try {
      const { warnings } = latestCalculations(); if(warnings.length) throw new Error(warnings.join(' '));
      busy=true; drawSummary(); record = await rpc('monthly_client_documents_confirm',{p_year:state.common.year,p_month:state.common.month,p_expected_revision:revision});
      revision=Number(record.revision); state.history=await rpc('monthly_client_documents_list'); savedFingerprint=fingerprint(); report('월을 확정했습니다.');
    } catch(error) { report(`확정 실패: ${error.message || error}`,true); }
    finally { busy=false; render(); }
  }
  async function unconfirmMonth() {
    try { busy=true; drawSummary(); record=await rpc('monthly_client_documents_unconfirm',{p_year:state.common.year,p_month:state.common.month,p_expected_revision:revision}); revision=Number(record.revision); state.history=await rpc('monthly_client_documents_list'); savedFingerprint=fingerprint(); report('확정을 해제했습니다.'); }
    catch(error){report(`확정 해제 실패: ${error.message || error}`,true);} finally{busy=false;render();}
  }
  async function copyPrevious() {
    if (fingerprint() !== savedFingerprint && !window.confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 지난달 snapshot에서 새 월을 만들까요?')) return;
    try { busy=true; const year=state.common.year,month=state.common.month; record=await rpc('monthly_client_documents_copy_previous',{p_year:year,p_month:month}); revision=Number(record.revision); await loadMonth(year,month,false); state.history=await rpc('monthly_client_documents_list'); report('지난달 snapshot에서 새 작성중 월을 만들었습니다.'); render(); }
    catch(error){report(`월 복사 실패: ${error.message || error}`,true);} finally{busy=false;}
  }
  async function saveDefaults() {
    try { await rpc('monthly_client_documents_save_company_defaults',{p_company_defaults:state.companies}); state.defaults=await rpc('monthly_client_documents_company_defaults'); report('회사 기본값을 저장했습니다. 현재 월 snapshot은 유지됩니다.'); }
    catch(error){report(`기본값 저장 실패: ${error.message || error}`,true);}
  }
  async function open() {
    const main=document.getElementById('dashboard-main'); if(!main) return;
    main.replaceChildren(); root=el('div',undefined,'monthly-client-documents'); main.append(root);
    statusNode=el('p','정보를 불러오는 중입니다.','mcd-inline-status'); root.append(statusNode);
    try { await loadData(); render(); } catch(error){ report(`화면을 불러오지 못했습니다: ${error.message || error}`,true); }
  }
  document.addEventListener('taejang-monthly-client-documents-open', open);
  window.MonthlyClientDocuments = Object.freeze({ open });
})();
