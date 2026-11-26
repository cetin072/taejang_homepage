(() => {
  'use strict';

  const core = window.TaejangMonthEndPayrollCore;
  const format = new Intl.NumberFormat('ko-KR');
  const money = n => format.format(n) + '원';
  const monthText = value => value.slice(0,4) + '년 ' + Number(value.slice(5)) + '월';
  const build = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const button = (label, action, secondary = false) => {
    const node = build('button', label, 'button' + (secondary ? ' button-quiet' : ''));
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const field = (label, control) => {
    const node = build('label', label, 'pme-field');
    node.append(control);
    return node;
  };
  const input = (type, value = '') => {
    const node = build('input');
    node.type = type;
    node.value = value;
    return node;
  };
  const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date());
  const koreaDate = value => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date(value));
  let activeRoot;
  let dirty = false;

  function table(headers, rows, label) {
    const box = build('div', null, 'pme-table-box');
    box.tabIndex = 0;
    box.setAttribute('aria-label', label);
    const table = build('table');
    const head = table.createTHead().insertRow();
    headers.forEach(label => {
      const th = build('th', label);
      th.scope = 'col';
      head.append(th);
    });
    const body = table.createTBody();
    rows.forEach(cells => {
      const row = body.insertRow();
      cells.forEach(value => {
        const cell = row.insertCell();
        if (value instanceof Node) cell.append(value);
        else cell.textContent = value ?? '';
      });
    });
    box.append(table);
    return box;
  }

  function downloadDraft(month, draft, revision) {
    const bytes = core.draftWorkbook(month, draft, revision, window.TaejangAttendanceMonthlyXlsx);
    const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const a = build('a');
    a.href = url;
    a.download = `태장_급여대장_${month}_초안_v${revision}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function renderSlip(slip, month, revision) {
    const page = build('article', null, 'pme-slip');
    const title = build('h2', monthText(month) + ' 급여명세서');
    const basics = build('dl', null, 'pme-slip-basics');
    for (const [label, value] of [['회사','농업회사법인 태장 주식회사'],['성명',slip.name],['사번',slip.employee_id],
      ['지급일',core.monthEnd(month)],['입사일',slip.hired_on],['퇴사일',slip.departed_on]]) {
      if (value) basics.append(build('dt', label), build('dd', value));
    }
    const amounts = build('div', null, 'pme-slip-amounts');
    for (const [label, items, total] of [['지급 내역',slip.earnings,slip.gross],['공제 내역',slip.deductions,slip.deduction]]) {
      const part = build('section');
      part.append(build('h3', label),
        table(['항목','금액'], [...items.map(({label,amount}) => [label, money(amount)]), ['합계',money(total)]], label));
      amounts.append(part);
    }
    const net = build('p', null, 'pme-net');
    net.append(build('span','실지급액'), build('strong',money(slip.net)));
    page.append(title, basics, amounts, net, build('h3','산출 근거'), build('p',slip.basis,'pme-basis'),
      build('p','발행 버전 ' + revision,'pme-print-rev'));
    return page;
  }

  async function showSlip(slip, month, revision) {
    const page = renderSlip(slip, month, revision);
    const dialog = build('dialog', null, 'pme-dialog');
    dialog.setAttribute('aria-label', slip.name + ' 급여명세서');
    const actions = build('div', null, 'pme-actions pme-dialog-actions');
    const print = button('인쇄 · PDF 저장', async () => {
      const {printErpPdf} = await import('./erp-pdf.mjs');
      const printSize = build('style', '@page { size: A4 portrait; margin: 16mm; }');
      document.head.append(printSize);
      document.body.classList.add('pme-printing');
      const cleanup = () => {
        document.body.classList.remove('pme-printing');
        printSize.remove();
      };
      try {
        printErpPdf(`태장_${month}_급여명세서_${slip.name}`, core.monthEnd(month), cleanup);
      } catch {
        cleanup();
      }
    });
    actions.append(button('닫기', () => dialog.close(), true), print);
    dialog.append(actions, page);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    dialog.showModal();
  }

  function friendly(error) {
    const code = String(error?.message || error);
    const messages = {
      PAYROLL_MONTH_END_FORBIDDEN:'현재 계정의 급여 업무 권한을 확인해 주세요.',
      PAYROLL_MONTH_END_STALE:'이 달의 자료가 다른 화면에서 변경됐습니다. 조회해서 최신 버전을 열어 주세요.',
      PAYROLL_MONTH_END_MISMATCH:'회신본과 ERP 검토본에 확인할 차이가 남아 있습니다.',
      PAYROLL_MONTH_END_BAD_ROWS:'대상자, 세무 사번, 근태 또는 급여 입력 내용을 다시 확인해 주세요.',
      PAYROLL_MONTH_END_BASIS_REQUIRED:'명세서에 들어갈 산출 근거를 입력해 주세요.',
      PAYROLL_MONTH_END_CUTOFF:'근태 기준일은 선택한 급여월의 날짜여야 합니다.',
      PAYROLL_MONTH_END_ATTENDANCE_REVIEW:'근태가 바뀌었거나 확인이 필요합니다. 발송 이후 근태를 다시 대조해 주세요.',
      PAYROLL_MONTH_END_REASON_REQUIRED:'확정 후 재정산 사유를 입력해 주세요.',
    };
    return messages[code] || (/^[가-힣]/.test(code) ? code : '처리하지 못했습니다. 입력을 확인하고 다시 시도해 주세요.');
  }

  function mount(root, {rpc, manage, month = today().slice(0,7)}) {
    activeRoot = root;
    dirty = false;
    root.classList.add('payroll-month-end');
    let tab = manage ? 0 : 2;
    let data = {};
    let draftRows = [];
    let review = null;
    let cutoff = '';
    let busy = false;
    let editComparison = false;
    let correctionsDraft = null;
    let loadedCutoff = '';
    let revisionReason = null;
    let reviewedDetails = false;
    let attendanceReview = null;
    let selectedFile = null;

    const heading = build('header', null, 'pme-heading');
    heading.append(build('h1',manage ? '급여 관리' : '급여명세서'),
      build('p',manage ? '월별 초안을 만들고 세무 회신을 대조한 뒤 직원 명세서를 확정합니다.' : '확정된 직원 명세서를 열고 인쇄해 교부합니다.'));
    const monthInput = input('month', month);
    const controls = build('div', null, 'pme-actions pme-month');
    controls.append(field('급여월',monthInput), button('조회', () => load(monthInput.value), true));
    heading.append(controls);
    const nav = build('nav', null, 'pme-steps');
    nav.setAttribute('aria-label','급여 업무 단계');
    const notice = build('p', '', 'pme-notice');
    notice.setAttribute('role','status');
    notice.hidden = true;
    const body = build('section', null, 'pme-body');
    root.replaceChildren(heading,nav,notice,body);
    monthInput.addEventListener('input', () => {
      const requiresLoad = monthInput.value !== month;
      body.inert = requiresLoad;
      nav.inert = requiresLoad;
      message(requiresLoad ? '선택한 급여월의 자료를 보려면 조회를 눌러 주세요.' : '');
    });

    function message(text, error = false) {
      notice.textContent = text;
      notice.hidden = !text;
      notice.dataset.error = String(error);
    }
    function update(job) {
      if (busy) return;
      busy = true;
      root.setAttribute('aria-busy','true');
      // Freeze interactive inputs during write and read operations to preserve the captured values.
      const controls = [...root.querySelectorAll('button, input, textarea')].filter(node => !node.disabled);
      controls.forEach(node => {node.disabled = true;});
      message('처리 중입니다.');
      Promise.resolve().then(job).catch(error => { if (root.isConnected) message(friendly(error), true); }).finally(() => {
        controls.forEach(node => {node.disabled = false;});
        busy = false;
        root.removeAttribute('aria-busy');
      });
    }
    function clearSensitive() {
      if (activeRoot !== root) return;
      data = {};
      draftRows = [];
      review = null;
      dirty = false;
      document.querySelector('.pme-dialog')?.close();
      selectedFile = null;
      correctionsDraft = null;
      root.replaceChildren(build('p','급여 화면 권한을 다시 확인해 주세요.','message'));
      activeRoot = null;
    }
    const openTab = index => {
      if (tab === index) return;
      tab = index; message(''); render();
    };
    const change = () => { dirty = true; };
    function monthChanged() {
      if (monthInput.value !== month) throw new Error('급여월을 바꾼 뒤 조회해 주세요.');
    }
    const request = (action, values = {}) =>
      rpc('payroll_month_end', {p_month:month + '-01',p_action:action,p_data:values});
    function load(selected = month) {
      if (!/^\d{4}-\d{2}$/.test(selected)) { message('급여월을 선택해 주세요.', true); return; }
      if (dirty && !window.confirm('저장하지 않은 급여 입력을 버리고 조회할까요?')) {
        monthInput.value = month;
        body.inert = nav.inert = false;
        message('');
        return;
      }
      update(async () => {
        const response = await rpc('payroll_month_end',{p_month:selected+'-01',p_action:'read',p_data:{}});
        if (!root.isConnected) return;
        month = selected;
        monthInput.value = month;
        data = response;
        cutoff = data.latest?.draft?.cutoff || (today() < core.monthEnd(month) && today().startsWith(month) ? today() : core.monthEnd(month));
        draftRows = (data.latest?.draft?.rows || []).map(row => ({...row, selected:true}));
        review = data.latest?.review || null;
        editComparison = false;
        correctionsDraft = null;
        selectedFile = null;
        revisionReason = null;
        reviewedDetails = review?.details_reviewed === true;
        attendanceReview = review?.attendance || null;
        loadedCutoff = data.latest?.draft?.cutoff || '';
        body.inert = nav.inert = false;
        dirty = false;
        message('');
        render();
      });
    }

    function render() {
      nav.replaceChildren();
      nav.hidden = !manage;
      if (manage) ['1. 급여대장 초안','2. 세무 회신 대조','3. 직원 명세서 교부'].forEach((name,index) => {
        const step = button(name, () => openTab(index), true);
        if (index === tab) step.setAttribute('aria-current','step');
        nav.append(step);
      });
      body.replaceChildren();
      if (tab === 0) renderDraft();
      else if (tab === 1) renderReview();
      else renderIssue();
    }

    function renderDraft() {
      const saved = data.latest;
      body.append(build('h2','세무사무실에 보낼 급여대장'));
      const tools = build('div', null, 'pme-actions');
      const picker = input('date',cutoff);
      picker.min = month + '-01';
      picker.max = core.monthEnd(month);
      const cutoffHint = build('p', '', 'pme-help');
      const controlsDraft = [];
      picker.addEventListener('input', () => {
        cutoff = picker.value;
        change();
        const stale = loadedCutoff !== cutoff;
        controlsDraft.forEach(node => { node.disabled = stale; });
        cutoffHint.textContent = stale ? '근태 기준일이 바뀌었습니다. 출근부를 다시 불러와 주세요.' : '';
        cutoffHint.hidden = !stale;
      });
      tools.append(field('근태 기준일',picker), button('출근부 불러오기', () => update(async () => {
        monthChanged();
        const response = await request('attendance',{cutoff});
        loadedCutoff = cutoff;
        const previous = new Map(draftRows.map(row => [row.employee_id,row]));
        draftRows = response.rows.map(row => {
          const old = previous.get(row.employee_id);
          if (!old) return {...row, selected:row.gross != null && row.gross > 0};
          return {...row, selected:old.selected, tax_id:old.tax_id, gross:old.gross, deduction:old.deduction, basis:old.basis};
        });
        change();
        render();
        message(`${draftRows.length}명 근태를 불러왔습니다. 지급 대상과 금액을 확인해 주세요.`);
      })));
      if (saved) tools.append(button(`저장 초안 다운로드 · v${saved.revision}`, () =>
        downloadDraft(month,saved.draft,saved.revision), true));
      if (saved?.confirmed_at && revisionReason === null) {
        const reason = input('text');
        reason.maxLength = 250;
        tools.replaceChildren(button(`저장 초안 다운로드 · v${saved.revision}`,() => downloadDraft(month,saved.draft,saved.revision),true));
        body.append(tools,build('p',`확정된 급여월입니다. v${saved.revision} 명세서는 교부 화면에서 열 수 있습니다.`,'pme-empty'));
        body.append(field('재정산 시작 사유',reason),button('재정산 시작',() => {
          if (!reason.value.trim()) { message('재정산 사유를 입력해 주세요.',true); return; }
          revisionReason = reason.value.trim();
          change();
          render();
        },true));
        return;
      }
      cutoffHint.hidden = !loadedCutoff || loadedCutoff === cutoff;
      if (!cutoffHint.hidden) cutoffHint.textContent = '근태 기준일이 바뀌었습니다. 출근부를 다시 불러와 주세요.';
      body.append(tools,cutoffHint);
      if (!draftRows.length) {
        body.append(build('p','근태 기준일을 선택하고 출근부를 불러오세요.','pme-empty'));
        return;
      }
      body.append(build('p','근태 기록과 예정분을 확인하고 세무 사번, 급여 금액, 산출 근거를 입력해 주세요.','pme-help'));
      const editor = (row, prop, label, mode) => {
        const box = input('text',row[prop] ?? '');
        box.setAttribute('aria-label',row.name + ' ' + label);
        if (mode) box.inputMode = mode;
        box.maxLength = prop === 'basis' ? 600 : 18;
        box.addEventListener('input', () => { row[prop] = box.value; change(); });
        return box;
      };
      body.append(table(['포함','직원','근태','세무 사번','지급합계','공제합계','산출 근거'], draftRows.map(row => {
        const include = input('checkbox');
        include.checked = Boolean(row.selected);
        include.setAttribute('aria-label',row.name + ' 지급 대상 포함');
        include.addEventListener('change', () => { row.selected = include.checked; change(); });
        const details = build('details');
        const pending = row.days.filter(day => day.label === '확인 필요').length;
        const planned = row.days.filter(day => day.label.startsWith('예정')).length;
        details.append(build('summary',`예정 ${planned}일 · 확인 ${pending}일`), build('p', row.days
          .map(day => day.date.slice(5)+' '+day.label+(day.minutes == null?'':' '+day.minutes+'분')).join('\n'),'pme-days'));
        const employee = build('div',null,'pme-identity');
        employee.append(build('strong',row.name + (row.staff ? '' : ' · 임원')),build('span',row.employee_id));
        return [include,employee,details,editor(row,'tax_id','세무 사번','numeric'),
          editor(row,'gross','지급합계','numeric'),editor(row,'deduction','공제합계','numeric'),editor(row,'basis','산출 근거')];
      }), '급여대장 입력'));
      const saveDraft = button('초안 저장·엑셀 다운로드', () => update(async () => {
        monthChanged();
        if (loadedCutoff !== cutoff) throw new Error('출근부를 다시 불러와 주세요.');
        const selected = draftRows.filter(row => row.selected);
        if (!selected.length) throw new Error('급여 지급 대상자를 선택해 주세요.');
        const rows = selected.map(row => {
          if (!/^\d{1,16}$/.test(core.compact(row.tax_id))) throw new Error(row.name + ' 직원의 세무 사번을 확인해 주세요.');
          return {employee_id:row.employee_id,tax_id:core.taxId(row.tax_id),gross:core.won(row.gross),
            deduction:core.won(row.deduction),basis:String(row.basis || '').trim()};
        });
        if (new Set(rows.map(row => row.tax_id)).size !== rows.length) throw new Error('두 직원에게 같은 세무 사번이 입력되어 있습니다.');
        if (rows.some(row => row.gross < 0 || row.gross - row.deduction < 0)) throw new Error('지급합계와 실지급액을 확인해 주세요.');
        const revision = await request('save_draft',{cutoff,rows,version:saved?.id ?? null,reason:revisionReason});
        if (!root.isConnected) return;
        data.latest = revision;
        draftRows = revision.draft.rows.map(row => ({...row,selected:true}));
        review = revision.review || null;
        correctionsDraft = null;
        selectedFile = null;
        attendanceReview = review?.attendance || null;
        reviewedDetails = review?.details_reviewed === true;
        revisionReason = null;
        dirty = false;
        downloadDraft(month,revision.draft,revision.revision);
        openTab(1);
        message(`초안 v${revision.revision}을 저장하고 엑셀로 내려받았습니다.`);
      }));
      saveDraft.disabled = loadedCutoff !== cutoff;
      controlsDraft.push(saveDraft);
      body.append(saveDraft);
    }

    function renderReview() {
      body.append(build('h2','세무 회신과 대조'));
      const saved = data.latest;
      if (!saved) {
        body.append(build('p','급여대장 초안을 저장하면 회신 파일을 대조할 수 있습니다.','pme-empty'));
        return;
      }
      if (saved.confirmed_at) {
        body.append(build('p',`초안 v${saved.revision}의 세무 회신을 확정했습니다.`,'pme-empty'),
          button('직원 명세서 보기',() => openTab(2)));
        return;
      }
      body.append(build('p',`초안 v${saved.revision} · 근태 기준일 ${saved.draft.cutoff} · 지급일 ${core.monthEnd(month)}`,'pme-help'));
      const file = input('file');
      file.accept = '.xlsx,.xls';
      const pending = build('div',null,'pme-actions');
      const pendingName = build('span',null,'pme-help');
      let syncButtons = () => {};
      const clearFile = button('선택 취소',() => {
        selectedFile = null;
        file.value = '';
        updatePending();
        file.focus();
      },true);
      pending.append(pendingName,clearFile);
      const updatePending = () => {
        pending.hidden = !selectedFile;
        pendingName.textContent = selectedFile ? '선택한 파일 · '+selectedFile.name : '';
        syncButtons();
      };
      file.addEventListener('change',() => {
        selectedFile = file.files[0] || null;
        change();
        updatePending();
      });
      const loadReply = button('회신 엑셀 대조',() => update(async () => {
        monthChanged();
        const chosen = selectedFile;
        if (!chosen || chosen.size > 4 * 1024 * 1024) throw new Error('4MB 이하의 세무사 회신 엑셀을 선택해 주세요.');
        let reply;
        try {
          const parsed = await window.TaejangPayrollAttendanceXlsx.parseXlsxFile(chosen);
          reply = core.parseTaxLedger(parsed.sheets,month);
        } catch (error) {
          const previous = review ? ' 기존 대조 내용은 보관했습니다.' : '';
          throw new Error(friendly(error) + previous);
        }
        const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await chosen.arrayBuffer())),
          byte => byte.toString(16).padStart(2,'0')).join('');
        review = {reply, filename:chosen.name, fingerprint, changes:review?.changes || {}};
        reviewedDetails = false;
        selectedFile = null;
        editComparison = false;
        change();
        render();
        message('회신 파일을 읽었습니다. 직원과 차이 항목을 확인해 주세요.');
      }));
      const source = build('div', null, 'pme-actions pme-import');
      source.append(field(review ? '회신 파일 교체' : '세무사 회신 엑셀',file),loadReply);
      body.append(source,pending);
      updatePending();
      if (!review) return;
      const expected = saved.draft.rows.map(row => ({...row,...review.changes[row.employee_id]}));
      const differences = core.compare(expected,review.reply);
      const unresolved = differences.filter(row => row.status !== '일치');
      body.append(build('p',`${review.filename} · 일치 ${differences.length-unresolved.length}명 · 확인 필요 ${unresolved.length}명`,'pme-result'));
      const summarize = (label, rows) => {
        const gross = rows.reduce((total,row) => total+row.gross,0);
        const deduction = rows.reduce((total,row) => total+row.deduction,0);
        return [label,rows.length+'명',money(gross),money(deduction),money(gross-deduction)];
      };
      body.append(table(['월 합계','대상','지급','공제','실지급'],[
        summarize('ERP 검토본',expected),summarize('세무 회신',review.reply)
      ],'월 급여 합계 대조'));
      if (unresolved.some(row => row.status !== '금액 차이')) {
        body.append(build('p','대상자나 이름 차이는 초안의 세무 사번 또는 회신 파일을 확인해 주세요.','pme-help'));
      }
      const amounts = (value, other) => {
        if (!value) return '—';
        const stack = build('dl',null,'pme-amount-stack');
        const values = item => [item.gross,item.deduction,item.gross-item.deduction];
        ['지급','공제','실지급'].forEach((label,index) => {
          const amount = values(value)[index];
          const changed = other && values(other)[index] !== amount;
          stack.append(build('dt',label),build('dd',money(amount),changed?'pme-difference':null));
        });
        return stack;
      };
      body.append(table(['직원','대조','ERP 검토본','세무 회신','직원 명세서'], differences.map(row => {
        const detail = row.received && build('details');
        if (detail) {
          const lines = list => list.length ? list.map(item => item.label+' '+money(item.amount)).join(' · ') : '없음';
          detail.append(build('summary','회신 항목 보기'),
            build('p','지급 · '+lines(row.received.earnings)),
            build('p','공제 · '+lines(row.received.deductions)),build('p','산출 근거 · '+(row.expected?.basis || '미입력')));
        }
        const tax = build('div');
        const figures = amounts(row.received,row.expected);
        if (figures instanceof Node) tax.append(figures, detail);
        else tax.textContent = figures;
        return [row.expected?.name || row.received.name,build('span',row.status,row.status === '일치'?'pme-tag':'pme-tag pme-alert'),
          amounts(row.expected,row.received),tax,row.expected ? row.expected.staff ? '대상' : '제외 · 임원' : '—'];
      }), 'ERP와 세무 회신 대조표'));
      const changesPanel = build('div',null,'pme-attendance-review');
      const refreshAttendance = button('발송 이후 근태 대조', () => update(async () => {
        monthChanged();
        attendanceReview = await request('attendance_review',{version:saved.id});
        reviewedDetails = false;
        change();
        render();
        message('발송 후 근태 변경을 조회했습니다.');
      }),true);
      changesPanel.append(build('h3','발송 이후 근태'),refreshAttendance);
      if (attendanceReview) {
        changesPanel.append(build('p',`${attendanceReview.cutoff} 기준 · 변경 ${attendanceReview.differences.length}건`));
        if (attendanceReview.differences.length) changesPanel.append(table(
          ['직원','날짜','발송 초안','현재 근태'],
          attendanceReview.differences.map(item => [item.name,item.date,item.before || '기록 없음',item.after || '기록 없음']),
          '발송 이후 근태 차이'));
      }
      body.append(changesPanel);
      const approval = input('checkbox');
      approval.checked = reviewedDetails;
      body.append(field('회신의 지급·공제 항목, 산출 근거 및 근태 변경을 확인했습니다.',approval));
      const actions = build('div',null,'pme-actions');
      actions.append(button(editComparison ? 'ERP 검토본 접기' : 'ERP 검토본 정정', () => {
        editComparison = !editComparison; render();
      }, true));
      const storeReview = button('대조 내용 저장',() => saveReview(false),true);
      actions.append(storeReview);
      const finalize = button('회신 확정 및 직원 명세서 생성', () => {
        if (window.confirm(monthText(month) + ' 세무 회신을 확정하고 직원 명세서를 생성할까요?')) saveReview(true);
      });
      syncButtons = () => {
        storeReview.disabled = editComparison || Boolean(selectedFile);
        finalize.disabled = unresolved.length > 0 || editComparison || !reviewedDetails || !attendanceReview || Boolean(selectedFile);
      };
      approval.addEventListener('change',() => { reviewedDetails = approval.checked; change(); syncButtons(); });
      syncButtons();
      actions.append(finalize);
      if (editComparison) showReviewEditor(expected);
      body.append(actions);
    }

    function showReviewEditor(expected) {
      const corrections = new Map();
      body.append(build('h3','ERP 검토본 정정'),build('p','확인한 지급·공제 금액과 정정 사유를 입력하세요. 초안 파일은 처음 상태로 보관됩니다.','pme-help'));
      body.append(table(['직원','지급합계','공제합계','명세서 산출 근거','정정 사유'], expected.map(row => {
        const controls = {};
        for (const [key,label] of [['gross','정정 지급합계'],['deduction','정정 공제합계'],['basis','산출 근거'],['reason','정정 사유']]) {
          const control = input('text',correctionsDraft?.[row.employee_id]?.[key] ?? row[key] ?? '');
          control.maxLength = key === 'basis' ? 600 : key === 'reason' ? 250 : 18;
          control.setAttribute('aria-label',row.name + ' ' + label);
          control.addEventListener('input',() => {
            correctionsDraft ||= {};
            correctionsDraft[row.employee_id] ||= {};
            correctionsDraft[row.employee_id][key] = control.value;
            change();
          });
          if (key === 'gross' || key === 'deduction') control.inputMode = 'numeric';
          controls[key] = control;
        }
        corrections.set(row.employee_id,controls);
        return [row.name,controls.gross,controls.deduction,controls.basis,controls.reason];
      }), 'ERP 검토본 정정'));
      body.append(button('변경 반영',() => {
        try {
          const changes = {};
          for (const row of data.latest.draft.rows) {
            const c = corrections.get(row.employee_id);
            const values = {gross:core.won(c.gross.value),deduction:core.won(c.deduction.value),
              basis:c.basis.value.trim(),reason:c.reason.value.trim()};
            if (row.gross === values.gross && row.deduction === values.deduction && row.basis === values.basis) continue;
            if (!values.reason) throw new Error(row.name + ' 직원의 정정 사유를 입력해 주세요.');
            if (values.gross < 0 || values.gross-values.deduction < 0) throw new Error(row.name + ' 직원의 금액을 확인해 주세요.');
            changes[row.employee_id] = values;
          }
          review = {...review,changes};
          correctionsDraft = null;
          reviewedDetails = false;
          editComparison = false;
          change();
          message('ERP 검토본을 다시 대조했습니다.');
          render();
        } catch (error) { message(friendly(error),true); }
      },true));
    }

    function saveReview(confirm) {
      update(async () => {
        monthChanged();
        if (selectedFile) throw new Error('선택한 회신 파일을 먼저 대조해 주세요.');
        const result = await request(confirm ? 'finalize' : 'save_review',
          {version:data.latest.id, updated_at:data.latest.updated_at, ...review, attendance:attendanceReview, details_reviewed:reviewedDetails});
        if (!root.isConnected) return;
        data.latest = result.latest;
        data.publication = result.publication;
        review = result.latest.review;
        reviewedDetails = review?.details_reviewed === true;
        attendanceReview = review?.attendance || null;
        dirty = false;
        if (confirm) openTab(2);
        render();
        message(confirm ? '확정했습니다. 직원 명세서를 교부할 수 있습니다.' : '회신 파일과 대조 내용을 저장했습니다.');
      });
    }

    function renderIssue() {
      body.append(build('h2','확정 직원 급여명세서'));
      const publication = data.publication;
      if (!publication?.slips?.length) {
        body.append(build('p','이 달에 확정된 직원 명세서가 없습니다.','pme-empty'));
        return;
      }
      body.append(build('p',`${monthText(month)} · v${publication.revision} · 직원 ${publication.slips.length}명`,'pme-help'));
      const list = build('ul',null,'pme-issue-list');
      publication.slips.forEach(slip => {
        const issued = publication.issued?.[slip.employee_id];
        const row = build('li',null,'pme-issue-row');
        const identity = build('div',null,'pme-identity');
        identity.append(build('strong',slip.name),build('span',slip.employee_id));
        const view = button('명세서 열기',() => {
          if (monthInput.value === month) showSlip(slip,month,publication.revision);
        },true);
        view.setAttribute('aria-label',slip.name + ' 명세서 열기');
        view.dataset.previewEmployee = slip.employee_id;
        const actions = build('div',null,'pme-actions');
        actions.append(view);
        if (!issued) {
          const mark = button('교부 완료 처리',() => {
            if (monthInput.value !== month || !window.confirm(slip.name + ' 직원에게 인쇄한 명세서를 전달했나요?')) return;
            update(async () => {
              data.publication = await request('mark_issued',{version:publication.id,employee_id:slip.employee_id});
              if (!root.isConnected) return;
              render();
              body.querySelector(`[data-preview-employee="${CSS.escape(slip.employee_id)}"]`)?.focus();
              message(slip.name + ' 직원의 교부를 기록했습니다.');
            });
          },true);
          mark.setAttribute('aria-label',slip.name + ' 교부 완료 처리');
          actions.append(mark);
        }
        row.append(identity,build('span',issued ? `교부 완료 · ${koreaDate(issued)}` : '교부 전',issued?'pme-tag':null),actions);
        list.append(row);
      });
      body.append(list);
    }

    load();
    return {clearSensitive};
  }

  let workspace;
  let authorityMode;
  function invalidateWorkspace() {
    if (!activeRoot) return;
    const app = window.TaejangApp;
    const key = authorityMode ? 'payroll.manage' : 'payslip.issue';
    const role = authorityMode ? 'operations_manager' : 'promotion_lead';
    if (!activeRoot.isConnected || app?.getRoute?.() !== role || !app?.can?.(key)
      || window.TaejangMenuAuthority?.allowed(key,true) === false) workspace?.clearSensitive();
  }
  function open(manage) {
    const app = window.TaejangApp;
    if (!app || (manage ? !app.can('payroll.manage') : !app.can('payslip.issue'))) return;
    const main = document.getElementById('dashboard-main');
    if (!main) return;
    workspace?.clearSensitive();
    const root = build('section');
    main.replaceChildren(root);
    authorityMode = manage;
    workspace = mount(root,{manage,rpc:app.rpc.bind(app)});
  }
  for (const event of ['taejang-menu-authority-changed','taejang-capabilities-ready','taejang-app-ready']) {
    document.addEventListener(event, invalidateWorkspace);
  }
  window.TaejangMonthEndPayroll = {
    open, mount, close:() => workspace?.clearSensitive(),
    hasUnsavedChanges: () => Boolean(activeRoot?.isConnected && dirty),
  };
})();
