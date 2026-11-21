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
    input.setAttribute('aria-label', labelText);
    input.required = Boolean(options.required);
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step !== undefined) input.step = options.step;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.checked !== undefined) input.checked = options.checked;
    input.dataset.mcdScope = options.scope || 'snapshot';
    input.addEventListener('input', () => onChange(input.type === 'checkbox' ? input.checked : input.value));
    input.addEventListener('change', () => onChange(input.type === 'checkbox' ? input.checked : input.value));
    label.append(input); return label;
  };
  const button = (label, action, primary = false) => {
    const node = el('button', label, `button mcd-button${primary ? ' primary' : ''}`);
    node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
  const currentCapability = () => {
    const legacy = window.TaejangApp?.hasCapabilityContract?.() && window.TaejangApp.can?.(CAPABILITY) === true;
    return window.TaejangMenuAuthority?.allowed(CAPABILITY, legacy) ?? legacy;
  };
  let root, statusNode, state, record = null, revision = 0, savedFingerprint = '', activeMonthKey = '', loadSequence = 0,
    busy = false, emailState = null, performanceReady = false;
  let outputSelection = new Set(ids);
  const emailDrafts = new Map();
  let authoritySequence = 0;

  function commonFromDefaults(year, month) {
    return { year, month, docDate: '', perfDate: '', place: '', safety: 'outdoor', severe: 20, mildF: 0, mildM: 3,
      base: 1295000, rate: 70, note: '', extras: [] };
  }
  function defaultsToMonth(defaults, year, month) {
    return { common: commonFromDefaults(year, month), companies: defaults.map(company => ({ ...company, enabled: true, override: company.override ?? '', note: '' })) };
  }
  function report(message, error = false) {
    if (!currentCapability() || !statusNode?.isConnected) return;
    statusNode.textContent = message; statusNode.classList.toggle('error', error); statusNode.hidden = !message;
  }
  function fingerprint() { return JSON.stringify({ common: state.common, companies: state.companies }); }
  function assertActiveMonth() {
    const key = monthKey(state.common.year, state.common.month);
    if (key !== activeMonthKey || (record && monthKey(record.year, record.month) !== key) || (!record && revision !== 0)) {
      throw new Error('MONTH_IDENTITY_MISMATCH');
    }
  }
  function friendlyError(error) {
    const message = error?.message || String(error);
    const guidance = {REVISION_CONFLICT:'다른 곳에서 수정했습니다. 월을 다시 열어 주세요.',REQUIRED_WORK_DESCRIPTION:'수행 내용를 입력해 주세요.',INVALID_SERVICE_DATE:'모든 수행일을 올바른 날짜로 입력해 주세요.',INVALID_SERVICE_DATES:'수행일의 중복과 순서를 확인해 주세요.',REQUIRED_SERVICE_DATES:'추가한 수행일을 입력하거나 빈 칸을 삭제해 주세요.',INVALID_DOCUMENT_DATE:'문서 작성일을 입력해 주세요.',DOCUMENT_LAYOUT_LIMIT:'3쪽 양식 범위를 넘었습니다. 초안은 보존되며 내용 검토 후 확정·출력할 수 있습니다.'};
    if (guidance[message]) return guidance[message];
    return message.includes('MONTH_ALREADY_EXISTS') ? '이미 저장된 월입니다. 저장된 월 불러오기를 사용하세요.' : (/[A-Z]{2,}_/.test(message)?'입력 내용과 저장 상태를 확인해 주세요.':message);
  }
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
    if (state.common.perfDates !== undefined) warnings.push(...window.MonthlyClientDocumentCore.layoutWarnings(state.common, active));
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
  function editableInput() { return record?.status !== 'confirmed'; }

  function drawSummary() {
    const target = root.querySelector('[data-mcd-summary]');
    const warningsTarget = root.querySelector('[data-mcd-warnings]');
    target.replaceChildren(); warningsTarget.replaceChildren();
    let ready = true;
    const versionsMatch = !record || (record.calculationVersion === window.MonthlyClientDocumentCore.VERSION
      && window.MonthlyClientDocumentDocx?.supportsTemplate?.(record.templateVersion));
    if (!versionsMatch) {
      ready = false;
      warningsTarget.append(el('p', '이 달의 서류는 저장 당시 양식을 확인한 뒤 출력할 수 있습니다.', 'mcd-warning'));
    }
    try {
      const { results, warnings } = latestCalculations();
      const tableWrap = el('div', undefined, 'mcd-table-wrap'); const table = el('table', undefined, 'mcd-table');
      const labels=['회사', '계산 최대', '적용', '공급가액', '부가세', '합계', '공문 번호'];
      const header = el('tr'); labels.forEach(text => header.append(el('th', text))); table.append(header);
      results.filter(({company})=>selectedTab==='common'||company.id===selectedTab).forEach(({ company, calculation }) => {
        const row = el('tr');
        [company.key, `${calculation.calculatedHeadcount}명`, `${calculation.appliedHeadcount}명`,
          `${window.MonthlyClientDocumentCore.formatAmount(calculation.supplyAmount)}원`,
          `${window.MonthlyClientDocumentCore.formatAmount(calculation.vatAmount)}원`,
          `${window.MonthlyClientDocumentCore.formatAmount(calculation.totalAmount)}원`,
          `태장 제${state.common.year}-${String(state.common.month).padStart(2,'0')}-${String(company.seq).padStart(2,'0')}호`].forEach((text,index) => { const cell=el('td',text);cell.dataset.label=labels[index];row.append(cell); });
        table.append(row);
      });
      tableWrap.append(table);
      if(selectedTab==='common'){
        const details=el('details');details.append(el('summary','회사별 금액 보기'),tableWrap);target.append(details);
      } else target.append(tableWrap);
      if (warnings.length) { ready = false; warnings.forEach(message => warningsTarget.append(el('p', `⚠ ${message.replaceAll('환경정비·작업 상세','수행 내용')}`, 'mcd-warning'))); }
    } catch (error) { ready = false; warningsTarget.append(el('p', `⚠ ${friendlyError(error) || '계산 입력을 확인하세요.'}`, 'mcd-warning')); }
    const confirmed = record?.status === 'confirmed';
    root.querySelector('[data-mcd-confirm]').disabled = !ready || confirmed || busy || !record || fingerprint() !== savedFingerprint;
    root.querySelector('[data-mcd-docx-all]').disabled = !ready || !confirmed || busy
      || !state.companies.some(company => company.enabled && outputSelection.has(company.id));
    root.querySelectorAll('[data-mcd-docx-one]').forEach(node => {
      const company = state.companies.find(item => item.id === node.dataset.companyId);
      node.disabled = !ready || !confirmed || busy || !company?.enabled;
    });
    root.querySelector('[data-mcd-save]').disabled = confirmed || busy;
    root.querySelectorAll('[data-mcd-unconfirm]').forEach(node => { node.disabled = !confirmed || busy; });
    root.querySelectorAll('[data-mcd-scope="new-month"], [data-mcd-new-month]').forEach(node => { node.disabled = busy; });
    root.querySelectorAll('[data-mcd-scope="snapshot"]').forEach(node => { node.disabled = confirmed || busy; });
    root.querySelectorAll('[data-mcd-scope="company-default"]').forEach(node => { node.disabled = busy; });
    root.querySelector('[data-mcd-confirm]').setAttribute('aria-describedby', 'mcd-warnings');
  }

  async function downloadCompanies(companies) {
    if (!currentCapability()) throw new Error('이 문서를 만들 권한이 없습니다.');
    if (!record || record.status !== 'confirmed' || fingerprint() !== savedFingerprint) throw new Error('월별 서류를 저장하고 확정하면 내려받을 수 있습니다.');
    if (record.calculationVersion !== window.MonthlyClientDocumentCore.VERSION
      || !window.MonthlyClientDocumentDocx?.supportsTemplate?.(record.templateVersion)) throw new Error('이 달의 서류는 저장 당시 양식을 확인한 뒤 출력할 수 있습니다.');
    const { warnings } = latestCalculations();
    if (warnings.length) throw new Error(warnings.join(' '));
    const request = authoritySequence;
    const assets = await window.MonthlyClientDocumentDocx.loadAssets(record.templateVersion);
    if (request !== authoritySequence || !currentCapability() || !root?.isConnected) return;
    const blob = await window.MonthlyClientDocumentDocx.createDocx({ template: assets.template, packageBytes: assets.packageBytes,
      common: state.common, companies, type: 'blob' });
    if (request !== authoritySequence || !currentCapability() || !root?.isConnected) return;
    const filename = window.MonthlyClientDocumentDocx.filename(state.common, companies);
    const url = URL.createObjectURL(blob); const anchor = el('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    report(`워드 파일을 만들었습니다. ${filename}`);
  }

  function openCompanyOutput(company) {
    const dialog=el('dialog'), form=el('div',undefined,'mcd-panel');
    dialog.className='mcd-email-dialog app-authoring-dialog';dialog.style.cssText='width:min(96vw,1020px);max-height:92vh;overflow:auto';
    const model=structuredClone(state.common), sourceMonth=activeMonthKey, sourceRevision=revision, owner=authoritySequence;
    const available=()=>dialog.isConnected && owner===authoritySequence && currentCapability() && activeMonthKey===sourceMonth && revision===sourceRevision;
    const output=model.documentOutput?.month===sourceMonth ? model.documentOutput : {};
    const shared=output.shared || {};
    const saved=company ? output.companies?.[company.id] : null;
    const options={stage:'notice',mode:model.safety?.mode || (model.safety==='outdoor'?'outdoor':'indoor_video'),
      noticeDate:model.noticeDate || model.docDate,quoteDate:model.quoteDate || model.docDate,reportDate:model.reportDate || model.docDate,
      promotion:model.promotion?.status || 'none',photos:(model.photoSets || []).slice(),item:'지역사회 환경정화 용역',name:model.month+'월 지역사회 환경정화(청소) 용역',
      actual:(model.actualPerfDates?.length ? model.actualPerfDates : model.perfDates || [model.perfDate]).join(', '),work:model.workDescription || '',...shared,...saved};
    const original=structuredClone(options);
    const controls=el('div',undefined,'mcd-grid'),feedback=el('p'),actions=el('div',undefined,'mcd-actions');
    const frame=el('iframe');frame.title='발송 문서 미리보기';frame.style.cssText='width:100%;height:58vh;border:1px solid #ddd';frame.hidden=true;
    let pair=null,sequence=0;
    function invalidate(){sequence++;pair=null;frame.hidden=true;word.disabled=print.disabled=true;}
    let group=controls;
    function section(name){const details=el('details');details.append(el('summary',name));group=el('div',undefined,'mcd-grid');details.append(group);controls.append(details);}
    const add=(label,key,type,choices)=>group.append(field(label,options[key],type,val=>{options[key]=val;invalidate();},{choices}));
    const word=button('Word 받기',()=>{
      if(!pair || !available())return;
      const url=URL.createObjectURL(pair.blob),a=el('a');a.download=pair.name+'.docx';a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    const print=button('인쇄 · PDF로 저장',()=>{if(pair && available())frame.contentWindow.print();});
    invalidate();
    add('발행 문서','stage','select',[['notice','공문'],['result','견적서·결과보고서'],['skipped','견적서·결과보고서 (공문 생략)'],['bundle','공문·견적서·결과보고서 합본']]);
    section('문서 날짜');
    for(const [key,label] of [['noticeDate','공문일'],['quoteDate','견적일'],['reportDate','결과보고일']])add(label,key,'date');
    section('수행 내용과 품목');
    add('수행 내용 (줄마다 한 항목)','work','textarea');
    add('견적 품목','item','text');add('결과보고서 용역명','name','text');
    section('교육·홍보·사진');
    add('안전교육','mode','select',[['outdoor','현장 안전교육'],['indoor_hq','본사 실내 안전교육'],['indoor_video','영상 안전교육']]);
    add('홍보 게시','promotion','select',[['none','기재 생략'],['planned','게시 예정'],['posted','게시 완료']]);
    add('실제 수행일 (여러 날은 쉼표로 구분)','actual','text');
    for(const [key,label] of [['safety','안전교육 사진'],['site','현장 사진'],['group','단체사진']]){
      const wrap=el('label',undefined,'mcd-check'),cb=el('input');cb.type='checkbox';cb.checked=options.photos.includes(key);
      cb.onchange=()=>{options.photos=options.photos.filter(x=>x!==key);if(cb.checked)options.photos.push(key);invalidate();};wrap.append(cb,label);group.append(wrap);
    }
    controls.className='mcd-output-sections';
    const preview=button('미리보기',async()=>{
      invalidate();const request=sequence;
      try{
        const stage=options.stage==='notice'?'notice':'result',plan=options.stage==='bundle'?'single_bundle':options.stage==='skipped'?'notice_skipped':'three_step';
        const common={...model,noticeDate:options.noticeDate,quoteDate:options.quoteDate,reportDate:options.reportDate,
          perfDates:model.perfDates || [model.perfDate],actualPerfDates:options.actual.split(',').map(x=>x.trim()).filter(Boolean),
          serviceType:'custom',customService:{item:options.item,report:options.name,work:options.work.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)},workDescription:options.work.trim(),safety:{mode:options.mode},promotion:{status:options.promotion},photoSets:options.photos};
        const renderer=window.MonthlyClientDocumentDocx,assets=await renderer.loadAssets('monthly-stages-1');
        const blob=await renderer.createDocx({...assets,common,companies:[company],stage,plan,settings:{contract_basis_text:'계약 별첨2(용역 제공 기준)'}});
        const name=String(model.year).slice(2)+'년 '+model.month+'월 '+({notice:'공문',result:'견적서·용역 수행 결과보고서',skipped:'견적서·용역 수행 결과보고서',bundle:'공문·견적서·용역 수행 결과보고서'}[options.stage])+'_'+company.key;
        const {previewWord}=await import('./monthly-client-document-preview.mjs');
        const bytes=await blob.arrayBuffer();
        if(!available()||request!==sequence)return;
        await previewWord(frame,bytes,name);
        if(!available()||request!==sequence)return;
        pair={blob,name};frame.hidden=false;word.disabled=print.disabled=record?.status!=='confirmed';
        feedback.textContent=word.disabled?'저장한 월을 확정하면 Word와 인쇄를 사용할 수 있습니다.':'';
      }catch(error){if(available()&&request===sequence)feedback.textContent=friendlyError(error);}
    },true);
    if (record?.status!=='confirmed') actions.append(button(company?'이 회사 출력 설정 저장':'전체 회사에 적용',async()=>{
      if (!available() || busy) return;
      const companies=structuredClone(output.companies || {});
      if(company){
        const individual={...saved};
        for(const key of Object.keys(options))if(JSON.stringify(options[key])!==JSON.stringify(original[key]))individual[key]=options[key];
        companies[company.id]=individual;
      } else {
        for(const key of Object.keys(options))if(JSON.stringify(options[key])!==JSON.stringify(original[key])){
          shared[key]=options[key];for(const individual of Object.values(companies))delete individual[key];
        }
      }
      state.common.documentOutput={month:sourceMonth,shared,companies};
      dialog.close();
      await saveMonth();
    }));
    if(company)actions.append(preview,word,print);
    actions.append(button('닫기',()=>dialog.close()));
    form.append(el('h3',company?company.name+' 발송 서류':'서류 공통 설정'),controls,actions,feedback,frame);
    dialog.append(form);root.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  }

  function emailFor(company, calculation, includePhotos = true) {
    return window.MonthlyClientDocumentEmail.generate({
      monthly: { yearMonth: calculation.yearMonth, serviceDate: state.common.perfDate, serviceDates: state.common.perfDates, serviceLocation: state.common.place,
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
    catch (error) { report(friendlyError(error), true); return; }
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
      dialog = el('dialog', undefined, 'mcd-email-dialog app-authoring-dialog'); dialog.setAttribute('aria-labelledby', 'mcd-email-title');
      const form = el('form', undefined, 'app-authoring'); form.method = 'dialog';
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

  let selectedTab = 'common', monthSource = '';
  function editor(title, build, apply) {
    const dialog = el('dialog', undefined, 'mcd-email-dialog app-authoring-dialog');
    dialog.setAttribute('aria-label', title);
    const form = el('form', undefined, 'app-authoring');
    const grid = el('div', undefined, 'mcd-grid');
    build(grid);
    const actions = el('div', undefined, 'mcd-actions');
    actions.append(button('취소', () => dialog.close()));
    const submit = el('button', '적용', 'button primary'); submit.type = 'submit'; actions.append(submit);
    form.append(el('h3', title), grid, actions);
    form.onsubmit = event => {
      event.preventDefault();
      if (!currentCapability() || busy) return;
      dialog.close(); apply();
    };
    dialog.append(form); root.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once:true}); dialog.showModal();
  }
  function editFields(title, target, definitions, after) {
    const draft = structuredClone(target);
    editor(title, grid => {
      for (const [label,key,type='text',opts={}] of definitions) {
        grid.append(field(label,draft[key],type,value => {
          draft[key] = type==='number' && value!=='' ? Number(value) : value;
        },opts));
      }
    }, () => { Object.assign(target,draft); after(); });
  }
  const contractFields = [
    ['수신 회사명','name','text',{required:true}], ['지분율(%)','share','number',{min:0,max:100,step:'any',required:true}],
    ['계약 상한(명)','cap','number',{min:0,required:true}], ['적용 인원(자동 계산 시 비워 두세요)','override','number',{min:0}],
    ['지급기한(일)','pay','number',{min:1,required:true}], ['문서 순번','seq','number',{min:1,max:99,required:true}]
  ];
  function editWork() {
    const draft = structuredClone(state.common);
    const dates = [...(draft.perfDates || [draft.perfDate])];
    editor('수행 내용 수정', grid => {
      grid.append(field('문서 작성일',draft.docDate,'date',v=>draft.docDate=v),
        field('수행 장소',draft.place,'text',v=>draft.place=v));
      const dateBox=el('div',undefined,'mcd-service-dates');grid.append(dateBox);
      function drawDates() {
        dateBox.replaceChildren();
        dates.forEach((date,i)=>{
          const row=el('div',undefined,'mcd-actions');
          row.append(field('수행일 '+(i+1),date,'date',v=>dates[i]=v));
          if(dates.length>1)row.append(button('삭제',()=>{dates.splice(i,1);drawDates();}));
          dateBox.append(row);
        });
        if(performanceReady && dates.length<4) dateBox.append(button('+ 수행일 추가',()=>{dates.push('');drawDates();}));
      }
      drawDates();
      if(performanceReady)grid.append(field('수행 내용',draft.workDescription,'textarea',v=>draft.workDescription=v));
      grid.append(field('안전교육 방식',draft.safety,'select',v=>draft.safety=v,{choices:[['outdoor','현장 안전교육'],['indoor','영상 안전교육']]}),
        field('공문 공통 문구',draft.note,'textarea',v=>draft.note=v));
    },()=>{
      draft.perfDate=dates[0]; if(performanceReady)draft.perfDates=dates;
      const output=draft.documentOutput;
      if(output) {
        for(const settings of [output.shared,...Object.values(output.companies||{})].filter(Boolean)) {
          if(draft.workDescription!==state.common.workDescription)delete settings.work;
          if(draft.safety!==state.common.safety)delete settings.mode;
          if(JSON.stringify(dates)!==JSON.stringify(state.common.perfDates||[state.common.perfDate]))delete settings.actual;
          if(draft.docDate!==state.common.docDate)for(const k of ['noticeDate','quoteDate','reportDate'])delete settings[k];
        }
      }
      state.common=draft;render();
    });
  }
  function editPrograms() {
    const extras=structuredClone(state.common.extras);
    editor('추가 프로그램',grid=>{
      function draw(){
        grid.replaceChildren();
        extras.forEach((extra,i)=>grid.append(field('프로그램 이름',extra.name,'text',v=>extra.name=v),
          field('설명',extra.description,'text',v=>extra.description=v),button('삭제',()=>{extras.splice(i,1);draw();})));
        grid.append(button('프로그램 추가',()=>{extras.push({name:'',description:''});draw();}));
      }
      draw();
    },()=>{state.common.extras=extras;render();});
  }
  function render() {
    if (!currentCapability() || !root?.isConnected || !state?.common) return;
    updateEmailStaleness();
    root.replaceChildren();
    const common=state.common,locked=!editableInput();
    const top=el('section',undefined,'mcd-panel');
    top.append(el('h2','참여기업 월간 서류'));
    const picker=el('input');picker.type='month';picker.value=activeMonthKey;picker.disabled=busy;picker.setAttribute('aria-label','기준 월');
    picker.onchange=async()=>{
      const next=picker.value;picker.value=activeMonthKey;
      if(!next || next===activeMonthKey || busy)return;
      const change=()=>loadMonth(...next.split('-').map(Number)).catch(e=>report(friendlyError(e),true));
      if(fingerprint()!==savedFingerprint) editor('저장하지 않고 월을 변경할까요?',g=>g.append(el('p','현재 월의 변경사항이 사라집니다.')),change);
      else await change();
    };
    top.append(picker,el('p',record?(locked?'확정된 월':'작성 중'):monthSource,'mcd-status-line'));
    const tabs=el('nav',undefined,'mcd-tabs');tabs.setAttribute('aria-label','입력 구분');
    for(const [key,label] of [['common','공통 입력'],...state.companies.map(c=>[c.id,c.key])]){
      const tab=button(label,()=>{selectedTab=key;render();});tab.setAttribute('aria-pressed',String(selectedTab===key));tabs.append(tab);
    }
    top.append(tabs);root.append(top);
    const panel=el('section',undefined,'mcd-panel app-authoring');root.append(panel);
    const actions=el('div',undefined,'mcd-actions');
    const edit=(label,fn)=>{const b=button(label,fn);b.disabled=locked||busy;actions.append(b);};
    if(selectedTab==='common'){
      panel.append(el('h3','전체 회사 공통 입력'),el('p',[common.place||'장소 미입력',...(common.perfDates||[common.perfDate]).filter(Boolean)].join(' · ')));
      edit('수행 내용 수정',editWork);
      edit('서류 공통 설정',()=>openCompanyOutput(null));
      edit('계산 기준 수정',()=>editFields('계산 기준 수정',common,[
        ['중증 근로자(명)','severe'],['경증 여성(명)','mildF'],['경증 남성(명)','mildM'],['부담기초액(원)','base'],['지원비율(%)','rate']
      ].map(([l,k])=>[l,k,'number',{min:0,required:true,...(k==='rate'?{max:100,step:'any'}:{})}]),render));
      edit('추가 프로그램',editPrograms);
    } else {
      const company=state.companies.find(c=>c.id===selectedTab);
      panel.append(el('h3',company.name),el('p',`지분율 ${company.share}% · 계약 상한 ${company.cap}명 · 지급기한 ${company.pay}일`));
      const enabled=field('이번 달 작성 대상','','checkbox',v=>{company.enabled=v;if(v)outputSelection.add(company.id);else outputSelection.delete(company.id);render();},{checked:company.enabled});
      panel.append(enabled);
      edit('이번 달 회사 정보 수정',()=>editFields('이번 달 회사 정보 수정',company,[...contractFields,['회사별 공문 문구','note','textarea']],render));
      const defaults=state.defaultsDraft.find(c=>c.id===company.id);
      actions.append(button('회사 기본값 수정',()=>editFields(company.key+' 기본값 수정',defaults,contractFields,saveDefaults)));
      const output=button('발송 서류 미리보기',()=>openCompanyOutput(company));output.disabled=!company.enabled;
      const email=button('메일 초안',()=>showEmail(company));email.disabled=!locked||!company.enabled;
      const check=field('합본에 포함','','checkbox',v=>{if(v)outputSelection.add(company.id);else outputSelection.delete(company.id);drawSummary();},{scope:'selection',checked:outputSelection.has(company.id)});
      check.querySelector('input').disabled=!company.enabled;
      const word=button('회사 서류 모음 받기',()=>downloadCompanies([company]).catch(e=>report(friendlyError(e),true)));
      word.dataset.mcdDocxOne='1';word.dataset.companyId=company.id;
      panel.append(check);actions.append(output,email,word);
    }
    panel.append(actions);
    const resultPanel = el('section', undefined, 'mcd-panel app-authoring'); resultPanel.append(el('h3', '계산 요약'));
    const warnings = el('div'); warnings.id='mcd-warnings'; warnings.dataset.mcdWarnings='1'; warnings.setAttribute('role','alert'); resultPanel.append(warnings);
    const summary = el('div'); summary.dataset.mcdSummary='1'; resultPanel.append(summary);
    const outputActions = el('div', undefined, 'mcd-actions');
    const save = button('저장', saveMonth, true); save.dataset.mcdSave='1';
    const confirm = button('확정', confirmMonth, true); confirm.dataset.mcdConfirm='1';
    const unconfirm = button('확정 해제', unconfirmMonth); unconfirm.dataset.mcdUnconfirm='1';
    const docxAll = button('선택 회사 서류 모음', async () => { try {
      const selected = state.companies.filter(company => company.enabled && outputSelection.has(company.id));
      await downloadCompanies(selected);
    } catch(error){ report(friendlyError(error),true); } }); docxAll.dataset.mcdDocxAll='1';
    outputActions.append(...(locked?[unconfirm]:[save,confirm]),docxAll); if(locked){confirm.hidden=true;save.hidden=true;outputActions.append(confirm,save);} resultPanel.append(outputActions); root.append(resultPanel);
    const notice = el('p', undefined, 'mcd-inline-status'); notice.dataset.mcdStatus='1'; notice.hidden=true; root.append(notice); statusNode = notice;
    drawSummary();
  }

  function enablePerformanceInputs() {
    if (!Array.isArray(state.common.perfDates)) state.common.perfDates = [state.common.perfDate || ''];
    if (state.common.workDescription === undefined) state.common.workDescription = '';
  }

  async function rpc(name, args = {}) {
    if (!currentCapability()) throw new Error('FORBIDDEN');
    const request = authoritySequence;
    const result = await window.TaejangApp.rpc(name, args);
    if (request !== authoritySequence || !currentCapability()) throw new Error('MENU_AUTHORITY_CHANGED');
    return result;
  }
  async function loadData() {
    if (!currentCapability()) throw new Error('FORBIDDEN');
    const data = await rpc('monthly_client_documents_get');
    performanceReady = data.performanceVersion === 2;
    state = { defaults: data.defaults || [], defaultsDraft: (data.defaults || []).map(item => ({ ...item })), history: data.months || [], common: null, companies: null };
    if (!ids.every(id => state.defaults.some(item => item.id === id))) throw new Error('회사 기본값을 불러오지 못했습니다.');
    const now = new Date(); const month = now.getMonth() + 1;
    await loadMonth(now.getFullYear(), month, false);
  }
  async function loadMonth(year, month, redraw = true) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2000 || year > 9999) return report('연도와 월을 확인하세요.', true);
    const request = ++loadSequence;
    const updateScreen = redraw && root && state?.common;
    if (updateScreen) { busy=true; drawSummary(); }
    try {
      const result = await rpc('monthly_client_documents_get_month', { p_year: year, p_month: month });
      if (request !== loadSequence) return;
      let values=result?.payload || defaultsToMonth(state.defaults,year,month);
      monthSource='새 월 · 회사별 기본값 적용';
      if(!result){
        const prevMonth=month===1?12:month-1,prevYear=month===1?year-1:year;
        const previous=await rpc('monthly_client_documents_get_month',{p_year:prevYear,p_month:prevMonth});
        if(request!==loadSequence)return;
        if(previous?.payload?.common){
          const prior=structuredClone(previous.payload.common),key=monthKey(year,month);
          const shift=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'') ? key+'-'+String(Math.min(Number(date.slice(-2)),new Date(year,month,0).getDate())).padStart(2,'0') : '';
          for(const k of ['docDate','perfDate','noticeDate','quoteDate','reportDate'])if(prior[k])prior[k]=shift(prior[k]);
          for(const k of ['perfDates','actualPerfDates'])if(Array.isArray(prior[k]))prior[k]=[...new Set(prior[k].map(shift))];
          if(prior.documentOutput){
            prior.documentOutput.month=key;
            for(const settings of [prior.documentOutput.shared,...Object.values(prior.documentOutput.companies||{})].filter(Boolean)){
              for(const k of ['noticeDate','quoteDate','reportDate'])if(settings[k])settings[k]=shift(settings[k]);
              if(settings.actual)settings.actual=[...new Set(settings.actual.split(',').map(d=>shift(d.trim())).filter(Boolean))].join(', ');
              if(settings.name===prevMonth+'월 지역사회 환경정화(청소) 용역')delete settings.name;
            }
          }
          values.common=prior;
          for(const company of values.companies)company.note=previous.payload.companies?.find(c=>c.id===company.id)?.note || '';
          monthSource='새 월 · 전월 공통 기록과 회사별 기본값 적용';
        }
      }
      record = result || null; revision = Number(record?.revision || 0);
      state.common = { ...commonFromDefaults(year,month), ...values.common, year, month, extras: Array.isArray(values.common.extras) ? values.common.extras : [] };
      if (performanceReady && (!record || record.status !== 'confirmed' || record.templateVersion === 'client-template-2')) enablePerformanceInputs();
      state.companies = ids.map(id => ({ ...state.defaults.find(item=>item.id===id), ...(values.companies || []).find(item=>item.id===id), enabled: (values.companies || []).find(item=>item.id===id)?.enabled ?? true }));
      outputSelection = new Set(state.companies.filter(company => company.enabled).map(company => company.id));
      activeMonthKey = monthKey(year, month);
      savedFingerprint = fingerprint();
    } finally {
      if (updateScreen && request === loadSequence) { busy=false; render(); }
    }
  }
  async function saveMonth() {
    let message = '', isError = false;
    try {
      assertActiveMonth();
      if (state.common.perfDates !== undefined && !performanceReady) throw new Error('여러 수행일을 저장할 수 없습니다. 월을 다시 열어 주세요.');
      state.common = window.MonthlyClientDocumentCore.normalizeCommon(state.common, {requireReady:false});
      busy=true; drawSummary();
      const response = await rpc('monthly_client_documents_save', { p_year: state.common.year, p_month: state.common.month,
        p_payload: { common: state.common, companies: state.companies }, p_expected_revision: revision });
      record = response; revision = Number(response.revision); state.history = await rpc('monthly_client_documents_list');
      savedFingerprint = fingerprint(); message = '월별 서류를 저장했습니다.';
    } catch(error) { message = `저장 실패: ${friendlyError(error)}`; isError = true; }
    finally { busy=false; render(); report(message, isError); }
  }
  async function confirmMonth() {
    let message = '', isError = false;
    try {
      assertActiveMonth();
      const { warnings } = latestCalculations(); if(warnings.length) throw new Error(warnings.join(' '));
      busy=true; drawSummary(); record = await rpc('monthly_client_documents_confirm',{p_year:state.common.year,p_month:state.common.month,p_expected_revision:revision});
      revision=Number(record.revision); state.history=await rpc('monthly_client_documents_list'); savedFingerprint=fingerprint(); message='월을 확정했습니다.';
    } catch(error) { message=`확정 실패: ${friendlyError(error)}`; isError=true; }
    finally { busy=false; render(); report(message,isError); }
  }
  async function unconfirmMonth() {
    if (busy) return;
    let message = '', isError = false;
    try { assertActiveMonth(); busy=true; drawSummary(); const response=await rpc('monthly_client_documents_unconfirm',{p_year:state.common.year,p_month:state.common.month,p_expected_revision:revision});
      if (!response || response.status !== 'draft' || !Number.isInteger(Number(response.revision))) throw new Error('확정 해제 응답을 확인하지 못했습니다. 새로 불러와 상태를 확인하세요.');
      record=response; revision=Number(response.revision); if (performanceReady) enablePerformanceInputs(); state.history=state.history.map(item => monthKey(item.year,item.month) === activeMonthKey ? {...item,status:record.status,revision} : item); savedFingerprint=fingerprint(); message='확정을 해제했습니다.'; }
    catch(error){message=`확정 해제 실패: ${friendlyError(error)}`;isError=true;} finally{busy=false;render();report(message,isError);}
  }
  async function saveDefaults() {
    let message='',isError=false;
    try { await rpc('monthly_client_documents_save_company_defaults',{p_company_defaults:state.defaultsDraft.map(({id,key,name,share,cap,override,pay,seq})=>({id,key,name,share,cap,override,pay,seq}))}); state.defaults=await rpc('monthly_client_documents_company_defaults'); state.defaultsDraft=state.defaults.map(item=>({...item})); message='현재 회사 기본값을 저장했습니다. 다음 새 월부터 적용됩니다.'; }
    catch(error){message=`기본값 저장 실패: ${friendlyError(error)}`;isError=true;}
    render(); report(message,isError);
  }
  async function open() {
    if (!currentCapability()) return;
    const request = ++authoritySequence;
    const main=document.getElementById('dashboard-main'); if(!main) return;
    main.replaceChildren(); root=el('div',undefined,'monthly-client-documents'); main.append(root);
    statusNode=el('p','정보를 불러오는 중입니다.','mcd-inline-status'); root.append(statusNode);
    try { await loadData(); if (request === authoritySequence) render(); }
    catch(error){ if (request === authoritySequence) report(`화면을 불러오지 못했습니다. ${friendlyError(error)}`,true); }
  }
  document.addEventListener('taejang-menu-authority-changed', () => {
    if (window.TaejangMenuAuthority?.allowed(CAPABILITY, true) !== false) return;
    ++authoritySequence; ++loadSequence;
    for (const draft of new Set([...emailDrafts.values(), emailState])) {
      if (draft?.dialog?.open) draft.dialog.close();
      draft?.dialog?.remove();
    }
    emailDrafts.clear(); emailState = null; state = null; record = null;
    revision = 0; savedFingerprint = ''; activeMonthKey = ''; selectedTab='common';
    outputSelection.clear(); busy = false; performanceReady = false;
    if (root?.isConnected) root.replaceChildren(el('p', '참여기업 월간 서류 권한이 회수되었거나 확인되지 않습니다.', 'message'));
    root = null; statusNode = null;
  });
  document.addEventListener('taejang-monthly-client-documents-open', open);
  window.MonthlyClientDocuments = Object.freeze({ open, hasUnsavedChanges:()=>Boolean(state?.common && root?.isConnected && fingerprint()!==savedFingerprint) });
})();

