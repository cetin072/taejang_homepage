(() => {
  'use strict';
  const arr = value => Array.isArray(value) ? value : [];

  function connectionReviewIds(employees) {
    const groups = new Map();
    for (const employee of arr(employees)) {
      const name = String(employee.full_name || '').trim().normalize('NFC');
      if (!name || !employee.hired_on) continue;
      const key = JSON.stringify([name, employee.hired_on]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(employee);
    }
    const ids = new Set();
    for (const group of groups.values()) {
      if (group.some(e => e.linked_profile) && group.some(e => !e.linked_profile)) {
        group.forEach(e => ids.add(e.id));
      }
    }
    return ids;
  }

  function accountState(employee, reviewIds) {
    const profile = employee.linked_profile;
    const status = profile?.account_status;
    const linked = Boolean(profile);
    const review = reviewIds.has(employee.id) || (linked && !['active', 'inactive', 'suspended', 'deleted'].includes(status));
    const label = !linked ? '앱 미연결' : status === 'active' ? '앱 연결됨'
      : ['inactive', 'suspended', 'deleted'].includes(status) ? '계정 비활성' : '연결 확인 필요';
    return { linked, review, label };
  }

  function filterEmployees(employees, state, reviewIds) {
    const query = state.search.trim().toLowerCase();
    return arr(employees).filter(employee => {
      const account = accountState(employee, reviewIds);
      return (!query || [employee.full_name, employee.employee_id].some(value => String(value || '').toLowerCase().includes(query)))
        && (!state.employment || (state.employment === 'departed' ? employee.employment_status === 'departed' : ['active', 'leave'].includes(employee.employment_status)))
        && (!state.account || (state.account === 'review' ? account.review : state.account === 'linked' ? account.linked : !account.linked))
        && (!state.photo || (state.photo === 'yes' ? Boolean(employee.profile_photo_path) : !employee.profile_photo_path));
    });
  }

  const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true });

  function positionRanks(positions) {
    // The existing RPC orders positions by DB sort_order (with general_worker
    // first for the new-hire default), but currently omits the numeric field.
    const rows = arr(positions);
    return new Map(rows.map((position, index) => [position.id, {
      ...position, rank: Number.isFinite(position.sort_order) ? position.sort_order : index
    }]));
  }

  function positionIssue(employee, ranks) {
    if (!employee.position_id) return '직책 미지정';
    const position = ranks.get(employee.position_id);
    if (!position || (employee.position_name && employee.position_name !== position.name)) return '직책 정보 확인 필요';
    return '';
  }

  function sortEmployees(employees, positions, sort = 'position') {
    const ranks = positionRanks(positions);
    const byId = (a, b) => compareText(a.employee_id, b.employee_id) || compareText(a.id, b.id);
    return arr(employees).slice().sort((a, b) => {
      const departed = Number(a.employment_status === 'departed') - Number(b.employment_status === 'departed');
      if (departed) return departed;
      // Unknown/mismatched positions are a separate group, never guessed.
      const unknown = Number(Boolean(positionIssue(a, ranks))) - Number(Boolean(positionIssue(b, ranks)));
      if (unknown) return unknown;
      if (sort === 'employee_desc') return -byId(a, b);
      if (sort === 'name') return compareText(a.full_name, b.full_name) || byId(a, b);
      if (sort === 'department') return compareText(a.department_name, b.department_name) || byId(a, b);
      if (sort === 'hired') return compareText(b.hired_on, a.hired_on) || byId(a, b);
      if (sort === 'employee_asc') return byId(a, b);
      if (positionIssue(a, ranks) || positionIssue(b, ranks)) return byId(a, b);
      const ap = ranks.get(a.position_id), bp = ranks.get(b.position_id);
      return Number(ap?.code === 'general_worker') - Number(bp?.code === 'general_worker')
        || (ap?.rank ?? Infinity) - (bp?.rank ?? Infinity) || byId(a, b);
    });
  }

  // The controller owns state and all RPCs. Views only build DOM and call its actions.
  function create({ el, button, input, select, field, setAvatar, statusLabel, listState, selectEmployee, backToList, makeEmployeeForm, photoPicker, sensitiveIdentityPanel, residentNumberPanel, insuranceDeductionPanel, nationalPensionAgeLabel, employmentInsuranceAgeLabel, requestLabel, requestSummary, saveEmployeeAppCheck, passwordResetPanel }) {
    function avatar(employee, path, label = '업무용 사진') {
      const placeholder = el('span', employee.full_name?.slice(0, 1) || '직', 'employee-avatar employee-avatar-placeholder');
      if (!path) return placeholder;
      const image = el('img', null, 'employee-avatar'); image.alt = `${employee.full_name} ${label}`;
      image.loading = 'lazy';
      image.addEventListener('error', () => image.replaceWith(placeholder), { once: true });
      // Keep an initial while private media is unavailable or signing fails.
      const wrap = el('span', null, 'employee-avatar-frame'); wrap.append(placeholder);
      setAvatar(image, path, wrap);
      return wrap;
    }

    function badge(label, warning = false) {
      return el('span', label, `employee-badge${warning ? ' employee-badge-warning' : ''}`);
    }

    function meta(pairs) {
      const dl = el('dl', null, 'employee-meta app-summary-list');
      pairs.forEach(([label, value]) => {
        const row = el('div'); row.append(el('dt', label), el('dd', value ?? '—')); dl.append(row);
      });
      return dl;
    }

    function employeeList(context) {
      const section = el('section', null, 'dashboard-section');
      const employees = arr(context.employees), reviewIds = connectionReviewIds(employees);
      const count = el('h2');
      const filters = el('div', null, 'employee-filters');
      const search = input('search', listState.search); search.placeholder = '이름 또는 직원번호';
      const employment = select([{ id:'active', name:'재직 (휴직 포함) · 기본' }, { id:'', name:'전체' }, { id:'departed', name:'퇴직' }], listState.employment);
      const account = select([{ id:'', name:'전체' }, { id:'linked', name:'앱 연결' }, { id:'unlinked', name:'앱 미연결' }, { id:'review', name:'연결 확인 필요' }], listState.account);
      const photo = select([{ id:'', name:'전체' }, { id:'yes', name:'사진 있음' }, { id:'no', name:'사진 없음' }], listState.photo);
      const sort = select([
        { id:'position', name:'직책 높은 순 (기본)' }, { id:'employee_asc', name:'직원번호 오름차순' },
        { id:'employee_desc', name:'직원번호 내림차순' }, { id:'name', name:'이름 가나다순' },
        { id:'department', name:'부서별' }, { id:'hired', name:'입사일 최신순' }
      ], listState.sort || 'position');
      filters.append(field('직원 검색', search), field('재직 상태', employment), field('앱 계정', account), field('업무용 사진', photo), field('정렬', sort));
      const head = el('div', null, 'employee-list-head'); head.setAttribute('aria-hidden', 'true');
      ['사진', '직원번호', '이름', '부서', '직책', '재직', '앱 계정', '근태', '사진', '점검'].forEach(label => head.append(el('span', label)));
      const list = el('div', null, 'employee-list');
      const render = () => {
        const filtered = filterEmployees(employees, listState, reviewIds);
        count.textContent = `직원 목록 · ${filtered.length}명 / 전체 ${employees.length}명`;
        list.replaceChildren();
        if (!filtered.length) list.append(el('p', '조건에 맞는 직원이 없습니다.', 'empty'));
        let rows = null;
        const ordered = sortEmployees(filtered, context.positions, listState.sort);
        const ranks = positionRanks(context.positions);
        ordered.forEach((employee, index) => {
          const departed = employee.employment_status === 'departed';
          const issue = positionIssue(employee, ranks);
          const previousIssue = ordered[index - 1] && positionIssue(ordered[index - 1], ranks);
          if (!rows || departed !== (ordered[index - 1]?.employment_status === 'departed') || Boolean(issue) !== Boolean(previousIssue)) {
            const group = el('section', null, departed ? 'employee-list-departed' : 'employee-list-employed');
            if (!listState.employment || issue) group.append(el('h3', `${departed ? '퇴직 직원' : '재직 직원'}${issue ? ' · 직책 확인 필요' : ''}`, 'employee-list-group-title'));
            rows = el('div'); rows.setAttribute('role', 'list'); group.append(rows); list.append(group);
          }
          const item = el('div'); item.setAttribute('role', 'listitem');
          const row = button('', () => selectEmployee(employee.id)); row.className = 'employee-list-row'; row.dataset.employeeId = employee.id;
          const account = accountState(employee, reviewIds);
          row.setAttribute('aria-label', `${employee.full_name} · ${employee.employee_id} · ${statusLabel(employee.employment_status)} · ${account.label}${account.review ? ' · 연결 확인 필요' : ''} 인사카드 열기`);
          row.append(avatar(employee, employee.profile_photo_path));
          [
            [employee.employee_id, 'id'], [employee.full_name, 'name'], [employee.department_name || '미배정', 'department'],
            [issue || employee.position_name || ranks.get(employee.position_id)?.name || '미지정', 'position'], [statusLabel(employee.employment_status), 'employment']
          ].forEach(([value, name]) => row.append(el('span', value, `employee-list-${name}`)));
          const accountCell = el('span', null, 'employee-list-account'); accountCell.append(badge(account.label, account.review)); row.append(accountCell);
          row.append(el('span', employee.attendance_required ? '근태 대상' : '근태 제외', 'employee-list-attendance'));
          row.append(el('span', employee.profile_photo_path ? '사진 있음' : '사진 없음', 'employee-list-photo'));
          const review = el('span', null, 'employee-list-review');
          review.append(account.review ? badge('연결 확인 필요', true) : el('span', '—')); row.append(review);
          item.append(row); rows.append(item);
        });
      };
      [[search, 'search', 'input'], [employment, 'employment', 'change'], [account, 'account', 'change'], [photo, 'photo', 'change'], [sort, 'sort', 'change']].forEach(([control, key, event]) => {
        control.addEventListener(event, () => { listState[key] = control.value; render(); });
      });
      render(); section.append(count, filters, head, list); return section;
    }

    function employeeProfile(context, employee) {
      const card = el('article', null, 'employee-profile'); card.dataset.employeeProfile = employee.id;
      const account = accountState(employee, connectionReviewIds(context.employees));
      const back = button('← 직원 목록', backToList, true);
      const head = el('header', null, 'employee-profile-head');
      const title = el('div'); const heading = el('h2', employee.full_name); heading.tabIndex = -1; heading.dataset.employeeHeading = '1';
      title.append(heading, el('p', employee.employee_id), el('p', `${employee.department_name || '미배정'} · ${employee.position_name || '미지정'}`));
      const badges = el('div', null, 'employee-badges'); badges.append(badge(statusLabel(employee.employment_status)), badge(account.label), badge(employee.attendance_required ? '근태 대상' : '근태 제외'));
      if (account.review) badges.append(badge('연결 확인 필요', true)); title.append(badges);
      head.append(avatar(employee, employee.profile_photo_path), title); card.append(back, head);
      const section = (label, className = '') => {
        const node = el('section', null, `employee-profile-section ${className}`); node.append(el('h3', label)); card.append(node); return node;
      };

      const basic = section('기본 인사정보', 'employee-section-basic');
      const values = meta([
        ['이름', employee.full_name], ['직원번호', employee.employee_id], ['부서', employee.department_name || '미배정'], ['직책', employee.position_name],
        ['입사일', employee.hired_on], ['퇴사일', employee.departed_on || '—'], ['재직상태', statusLabel(employee.employment_status)], ['근태대상', employee.attendance_required ? '대상' : '제외']
      ]); basic.append(values);
      const isGlobalLead = context.access_level === 'promotion_lead_global';
      const canEditInThisCard = context.access_level === 'operations_manager'
        || (!employee.protected
          && (!isGlobalLead || employee.can_edit_basic
            || employee.department_id === context.department_id));
      if (canEditInThisCard) {
        const edit = button('수정', () => {
          const form = makeEmployeeForm(context, employee, context.access_level !== 'operations_manager'); form.dataset.employeeEditForm = '1';
          const cancel = button('취소', () => { form.remove(); values.hidden = false; edit.hidden = false; edit.focus(); }, true);
          form.querySelector('.quick-links').append(cancel); edit.hidden = true; values.hidden = true; basic.append(form); form.querySelector('input')?.focus();
        }, true);
        const basicTitle = el('div', null, 'employee-basic-title');
        basicTitle.append(basic.querySelector('h3'), edit); basic.prepend(basicTitle);
      } else basic.append(el('p', '관리자·보호 직원 또는 타 부서 직책 변경은 운영총괄에서 처리합니다.', 'employee-protected-note'));

      const appSection = section('앱 계정', 'employee-section-account');
      const profile = employee.linked_profile;
      const profileStatus = ({ active:'활성', inactive:'비활성', suspended:'정지', deleted:'삭제', pending:'승인 대기' })[profile?.account_status] || '확인 필요';
      appSection.append(meta([
        ['연결 상태', profile ? '앱 연결됨' : '앱 미연결'], ['앱 계정 상태', profile ? account.label : '연결 계정 없음'],
        ['연결된 Profile', profile?.display_name || '—'], ['Profile 상태', profile ? profileStatus : '—'],
        ['이메일', profile?.work_email || '표시 가능한 정보 없음'], ['연결 점검', account.review ? '연결 확인 필요' : '현재 조회 범위에서 추가 경고 없음']
      ]));
      if (!profile) appSection.append(el('p','계정 발급 필요','help'));
      else if (!account.review && profile.account_status==='active' && employee.employment_status==='active' && passwordResetPanel)
        appSection.append(passwordResetPanel(employee));
      const photos = section('사진', 'employee-section-photos'); const photoGrid = el('div', null, 'employee-photo-grid');
      [['profile', '업무용 사진', employee.profile_photo_path], ['id_photo', '증명사진', employee.id_photo_path]].forEach(([type, label, path]) => {
        const box = el('div'); box.append(el('h4', label));
        const privateHidden = type === 'id_photo' && context.access_level !== 'operations_manager';
        if (!privateHidden) box.append(avatar(employee, path, label));
        box.append(el('p', privateHidden ? '현재 권한으로 등록 상태·사진 조회 불가' : path ? '등록됨' : '미등록', 'employee-photo-status'));
        if (type === 'profile' || context.access_level === 'operations_manager'
          || (!employee.protected
            && (context.access_level !== 'promotion_lead_global'
              || employee.department_id === context.department_id)))
          box.append(photoPicker(employee, type, context));
        photoGrid.append(box);
      }); photos.append(photoGrid);

      // Keep the staff audit inside the existing card instead of a second menu.
      if ((context.access_level === 'promotion_lead_global'
           || context.access_level === 'operations_manager') && saveEmployeeAppCheck) {
        const visit = section('앱 설치 및 현장 확인', 'employee-audit-inside-card employee-section-audit');
        visit.append(el('p','계정 연결 및 출퇴근 기록만으로 실제 앱 설치를 확정하지 않습니다. 직원 휴대폰에서 확인해 주세요.','help'));
        const auditForm = el('form',null,'employee-app-audit-form employee-form app-compact-container app-authoring');
        const confirmation = input('checkbox');
        confirmation.checked=Boolean(employee.identity_verified);
        const install=select([
          {id:'unchecked',name:'설치 미확인'},
          {id:'installed',name:'현장 설치 및 로그인 확인'},
          {id:'not_installed',name:'미설치 · 설치 안내 필요'},
          {id:'login_error',name:'로그인 오류 · 지원 필요'}
        ],employee.app_install_status || 'unchecked');
        const note=input('text',employee.audit_note || '');note.maxLength=300;
        note.placeholder='설치 안내나 로그인 오류 등 비민감 메모';
        const save=button('현장 확인 저장',()=>{});save.type='submit';
        const feedback=el('p','', 'help');feedback.setAttribute('role','status');

        const fields = el('div',null,'app-compact-fields');
        fields.append(field('인적사항 대조 완료',confirmation),field('앱 설치 상태',install),field('현장 메모',note));
        const actions = el('div',null,'quick-links'); actions.append(save);
        auditForm.append(fields,actions,feedback);
        auditForm.addEventListener('submit',async ev=>{
          ev.preventDefault();save.disabled=true;
          try{
            await saveEmployeeAppCheck(employee,{verified:confirmation.checked,status:install.value,note:note.value});
          } catch(error){
            feedback.textContent=error.message||'현장 확인을 저장하지 못했습니다.';
            feedback.classList.add('error');save.disabled=false;
          }
        });
        visit.append(auditForm);
      }

      if (context.can_manage_resident_number) {
        if (context.access_level === 'promotion_lead_global') {
          const resident = section('주민등록번호 등록·조회', 'employee-sensitive-section');
          resident.append(el('p','지원사업 및 고용 인사확인용입니다. 번호는 저장 시 암호화하고, 필요 시 한 명씩 조회합니다. 급여는 조회할 수 없습니다.','help'));
          resident.append(residentNumberPanel(context,employee)
            || el('p','보호 직원의 주민번호는 운영총괄이 관리합니다.','help'));
        }
      }

      if (context.can_manage_sensitive_identity || context.access_level === 'operations_manager') {
        const sensitive = section('민감정보 / 보험', 'employee-sensitive-section');
        sensitive.append(el('p', '권한이 있는 담당자만 관리하는 정보입니다. 주민등록번호 원문은 다시 표시하지 않습니다.', 'help'));
        const tool = (label, createPanel) => {
          const details = el('details'); details.append(el('summary', label));
          details.addEventListener('toggle', () => { if (details.open && !details.querySelector('form,section')) { const panel = createPanel(); if (panel) details.append(panel); } });
          sensitive.append(details);
        };
        if (context.access_level === 'operations_manager'
            && context.can_manage_resident_number) {
          const reveal=residentNumberPanel(context,employee);
          if(reveal)sensitive.append(reveal);
        }
        if (context.can_manage_sensitive_identity) {
          sensitive.append(meta([
            ['주민번호', employee.resident_number_registered ? '암호화 등록됨' : '미등록'], ['생년월일', employee.birth_date || '—'],
            ['만 나이', Number.isInteger(employee.age_years) ? `${employee.age_years}세` : '—'],
            ['국민연금', nationalPensionAgeLabel(employee.national_pension_age_status)], ['고용보험', employmentInsuranceAgeLabel(employee.employment_insurance_age_status)]
          ]));
          tool('주민번호·보험연령 관리', () => sensitiveIdentityPanel(context, employee));
        }
        if (context.access_level === 'operations_manager') tool('4대보험 공제 ON/OFF', () => insuranceDeductionPanel(employee));
      }

      const record = section('기록 / 점검', 'employee-section-record');
      record.append(el('p', `앱 계정: ${account.label}`));
      if (account.review) record.append(el('p', '연결 확인 필요 — 같은 이름·입사일의 연결/미연결 기록 또는 확인되지 않은 계정 상태가 있습니다. 중복 확정이 아니며 별도 확인이 필요합니다.', 'employee-protected-note'));
      else record.append(el('p', '현재 조회 가능한 정보에서 추가 연결 경고가 없습니다.', 'help'));
      const requests = arr(context.change_requests).filter(request => request.employee_uuid === employee.id);
      if (!requests.length) record.append(el('p', '현재 조회 가능한 직원정보 변경 요청이 없습니다.', 'help'));
      requests.forEach(request => {
        record.append(el('p', `${requestLabel(request.request_type)} · ${request.status === 'pending' ? '처리 대기' : request.status === 'changes_requested' ? '보완 필요' : request.status}`), el('p', requestSummary(context, request), 'help'));
        if (request.decision_comment) record.append(el('p', `운영총괄 의견: ${request.decision_comment}`));
      });
      if (context.access_level === 'operations_manager') {
        const tools = el('details'); tools.append(el('summary', '기존 변경 이력·직원 관리 도구'));
        const actions = el('div', null, 'quick-links'); actions.dataset.employeeRecordActions = '1'; tools.append(actions); record.append(tools);
      }
      return card;
    }
    return { employeeList, employeeProfile };
  }
  const api = { create, connectionReviewIds, accountState, filterEmployees, sortEmployees, positionRanks, positionIssue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.TaejangEmployeeViews = api;
})();
