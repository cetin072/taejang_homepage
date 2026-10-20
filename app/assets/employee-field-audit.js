(() => {
  'use strict';

  // Issue #456. The existing employee-management module owns upload signing;
  // this small field-audit view only owns its own filter and survey state.
  const app = () => window.TaejangApp;
  const main = () => document.getElementById('dashboard-main');
  const state = { query: '', filter: 'todo', selectedId: null, data: null, seq: 0 };
  const statuses = Object.freeze({
    unchecked: '설치 미확인',
    installed: '설치·로그인 현장 확인',
    not_installed: '미설치 · 방문 필요',
    login_error: '로그인 오류 · 지원 필요'
  });

  function node(tag, value, className) {
    const item = document.createElement(tag);
    if (value !== undefined && value !== null) item.textContent = String(value);
    if (className) item.className = className;
    return item;
  }
  function button(label, action, quiet = false) {
    const item = node('button', label, quiet ? 'button button-quiet' : 'button');
    item.type = 'button';
    item.addEventListener('click', action);
    return item;
  }
  function field(label, control, help = null) {
    const box = node('label', null, 'employee-field-audit-field');
    box.append(node('span', label), control);
    if (help) box.append(node('small', help, 'help'));
    return box;
  }
  function input(type, value = '') {
    const el = document.createElement('input');
    el.type = type;
    if (type !== 'checkbox') el.value = value == null ? '' : String(value);
    return el;
  }
  function select(options, selected) {
    const el = document.createElement('select');
    for (const entry of options) {
      const option = node('option', entry.label, null);
      option.value = entry.value;
      el.append(option);
    }
    el.value = selected;
    return el;
  }
  function alertBox(message, isError = false) {
    const el = node('p', message, isError ? 'message error' : 'message');
    el.setAttribute('role', 'status');
    return el;
  }
  function ready(employee) {
    return Boolean(employee.identity_verified
      && employee.app_install_status === 'installed'
      && employee.account_connected
      && employee.profile_photo_path);
  }
  function manualLabel(employee) { return statuses[employee.app_install_status] || statuses.unchecked; }
  function accountLabel(employee) {
    return employee.account_connected ? '앱 계정 연결' : '앱 계정 미연결';
  }
  function photoLabel(employee) {
    return employee.profile_photo_path ? '얼굴사진 있음' : '얼굴사진 미등록';
  }
  function matches(employee) {
    const query = state.query.trim().toLocaleLowerCase('ko-KR');
    const nameMatches = !query || [employee.employee_id, employee.full_name, employee.department_name]
      .some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(query));
    if (!nameMatches) return false;
    switch (state.filter) {
      case 'todo': return !ready(employee);
      case 'installed': return employee.app_install_status === 'installed';
      case 'needs_install': return employee.app_install_status === 'not_installed' || employee.app_install_status === 'login_error';
      case 'account_unlinked': return !employee.account_connected;
      case 'photo_missing': return !employee.profile_photo_path;
      case 'not_interviewed': return !employee.identity_verified;
      case 'complete': return ready(employee);
      default: return true;
    }
  }
  function canOpen() {
    if (!['promotion_lead','operations_manager'].includes(app()?.getRoute?.())) return false;
    return app()?.hasCapabilityContract?.() && Boolean(app().can('employee.field_audit_manage'));
  }
  async function load({ keepSelection = false } = {}) {
    if (!canOpen()) {
      main()?.replaceChildren(alertBox('직원 전수조사 권한이 없습니다. 다시 로그인한 뒤 권한을 확인해 주세요.', true));
      return;
    }
    const seq = ++state.seq, target = main();
    if (!target) return;
    const loading = alertBox('전 직원 현장 점검 정보를 불러오는 중입니다.');
    target.replaceChildren(loading);
    try {
      const data = await app().rpc('get_employee_field_audit');
      if (seq !== state.seq || !loading.isConnected) return;
      if (!Array.isArray(data?.employees)) throw Error('직원 전수조사 목록이 올바르지 않습니다.');
      state.data = data;
      if (!keepSelection) state.selectedId = null;
      if (state.selectedId && !data.employees.some(employee => employee.id === state.selectedId)) state.selectedId = null;
      render();
    } catch (error) {
      if (seq !== state.seq || !loading.isConnected) return;
      const message = app().friendlyError?.(error) || error.message || '전수조사 화면을 열지 못했습니다.';
      target.replaceChildren(alertBox(message, true), button('다시 불러오기', () => load({ keepSelection: true }), true));
    }
  }
  function render() {
    const target = main();
    if (!target || !state.data) return;
    const staff = state.data.employees;
    const completed = staff.filter(ready).length;
    const installed = staff.filter(employee => employee.app_install_status === 'installed').length;
    const unlinked = staff.filter(employee => !employee.account_connected).length;
    const photos = staff.filter(employee => employee.profile_photo_path).length;
    const identity = staff.filter(employee => employee.identity_verified).length;
    const shell = node('section', null, 'employee-field-audit employee-management');
    shell.dataset.employeeFieldAudit = '1';
    const intro = node('header', null, 'employee-field-audit-head');
    intro.append(
      node('h2', '직원 현장 전수조사'),
      node('p', '업무용 얼굴사진·앱 설치·입사일을 직원과 직접 확인합니다. 설치 여부는 자동 추정하지 않습니다.', 'help')
    );
    const tools = node('div', null, 'quick-links');
    tools.append(
      button('← 직원관리', () => window.TaejangEmployeeManagement?.openEmployeeManagement('existing'), true),
      button('최신 상태 다시 확인', () => load({ keepSelection: true }), true)
    );
    intro.append(tools);
    shell.append(intro);

    const summary = node('div', null, 'employee-field-audit-summary');
    [['재직·휴직',staff.length],['현장조사 완료',completed],['인적사항 확인',identity],
     ['설치 현장 확인',installed],['앱 계정 미연결',unlinked],['얼굴사진 등록',photos]].forEach(([label,value]) => {
      const card = node('div', null, 'employee-field-audit-stat');
      card.append(node('span', label), node('strong', value+'명'));
      summary.append(card);
    });
    shell.append(summary);

    if (state.selectedId) {
      const employee = staff.find(row => row.id === state.selectedId);
      if (employee) shell.append(detail(employee));
      else state.selectedId = null;
    }
    if (!state.selectedId) shell.append(list(staff));
    target.replaceChildren(shell);
  }

  function list(staff) {
    const section = node('section', null, 'dashboard-section');
    const toolbar = node('div', null, 'employee-field-audit-filters');
    const search = input('search', state.query);
    search.placeholder = '직원 이름·직원번호·부서 검색';
    const options = [
      ['todo','미완료 우선'],['all','전체 직원'],['needs_install','미설치·로그인 오류'],
      ['account_unlinked','앱 계정 미연결'],['photo_missing','얼굴사진 없음'],
      ['not_interviewed','인적사항 미확인'],['installed','설치 확인'],
      ['complete','전부 완료']
    ].map(([value,label]) => ({ value,label }));
    const filter = select(options,state.filter);
    toolbar.append(field('직원 검색', search), field('현장조사 상태', filter));
    const heading = node('h3', '', 'employee-field-audit-list-heading');
    const list = node('div', null, 'employee-field-audit-list');
    const redraw = () => {
      const shown = staff.filter(matches);
      heading.textContent = '점검 대상 · '+shown.length+'명 / '+staff.length+'명';
      list.replaceChildren();
      if (!shown.length) list.append(alertBox('조건에 맞는 직원이 없습니다.'));
      for (const employee of shown) {
        const row = button('', () => { state.selectedId=employee.id; render(); }, true);
        row.className = 'employee-field-audit-row';
        row.dataset.auditEmployeeId = employee.id;
        row.setAttribute('aria-label',employee.employee_id+' '+employee.full_name+' 전수조사 열기');
        const identity = node('div', null, 'employee-field-audit-identity');
        identity.append(node('strong',employee.full_name),node('small',employee.employee_id+' · '+employee.department_name+' · '+employee.position_name));
        const badges = node('div', null, 'employee-field-audit-badges');
        for (const [label,done] of [
          [accountLabel(employee),employee.account_connected],
          [manualLabel(employee),employee.app_install_status==='installed'],
          [photoLabel(employee),Boolean(employee.profile_photo_path)],
          [ready(employee)?'완료':'확인 필요',ready(employee)]
        ]) badges.append(node('span',label,done?'employee-field-audit-ok':'employee-field-audit-warn'));
        row.append(identity,badges);
        list.append(row);
      }
    };
    search.addEventListener('input',()=>{state.query=search.value;redraw();});
    filter.addEventListener('change',()=>{state.filter=filter.value;redraw();});
    redraw();
    section.append(toolbar,heading,list);
    return section;
  }

  function detail(employee) {
    const section = node('section', null, 'employee-field-audit-detail');
    section.dataset.auditDetail = employee.id;
    const heading = node('div', null, 'employee-field-audit-detail-head');
    heading.append(button('← 전수조사 목록', () => {state.selectedId=null;render();}, true),
      node('h3',employee.full_name+' · '+employee.employee_id),
      node('p',employee.department_name+' / '+employee.position_name+' / 입사 '+employee.hired_on));
    section.append(heading);

    const facts = node('div', null, 'employee-field-audit-facts');
    [
      ['앱 계정',accountLabel(employee)],
      ['앱 사용 기록',employee.has_app_use ? '출퇴근 이용 이력 있음 (최근 '+employee.last_attendance_on+')' : '출퇴근 이용 기록 없음'],
      ['현장 설치',manualLabel(employee)],
      ['업무용 얼굴사진',photoLabel(employee)]
    ].forEach(([label,value]) => {
      const item=node('div');item.append(node('strong',label),node('span',value));facts.append(item);
    });
    section.append(facts);

    const checkForm = document.createElement('form');
    checkForm.className = 'employee-field-audit-form app-authoring';
    checkForm.append(node('h4','① 현장 확인 결과'));
    const checked = input('checkbox');
    checked.checked=Boolean(employee.identity_verified);
    const checkedLabel = field('이름·직원번호·입사일 등 인적사항을 직원과 대조했습니다.',checked);
    checkedLabel.classList.add('employee-field-audit-check');
    const appInstall = select(Object.entries(statuses).map(([value,label])=>({value,label})),employee.app_install_status);
    const note = document.createElement('textarea');
    note.value = employee.audit_note || '';
    note.maxLength=300;
    note.rows=2;
    note.placeholder='선택: 설치 안내, 로그인 오류 등. 주민번호·건강정보는 적지 마세요.';
    const noteHelp = '설치 확인은 직원 휴대폰에서 직접 앱 실행·로그인 후 체크해 주세요. 계정 연결만으로 설치 완료가 아닙니다.';
    const checkMsg = node('p','', 'help'); checkMsg.setAttribute('role','status');
    const submit=button('현장 확인 저장',()=>{},false);submit.type='submit';
    checkForm.append(checkedLabel,field('태장 출근앱 설치 확인',appInstall,noteHelp),field('확인 메모 (비민감 정보)',note),submit,checkMsg);
    checkForm.addEventListener('submit',async event=>{
      event.preventDefault();
      submit.disabled=true;
      checkMsg.textContent='저장 중…';
      try {
        const response=await app().rpc('update_employee_field_audit',{
          p_employee_uuid:employee.id,
          p_identity_verified:checked.checked,
          p_app_install_status:appInstall.value,
          p_note:note.value
        });
        if (!response?.ok) throw Error(response?.code || '현장조사 저장 실패');
        state.selectedId=employee.id;
        await load({keepSelection:true});
      } catch(error){
        checkMsg.textContent=app().friendlyError?.(error)||error.message||'현장 확인을 저장하지 못했습니다.';
        checkMsg.classList.add('error');
        submit.disabled=false;
      }
    });
    section.append(checkForm);

    const photoSection=node('section',null,'employee-field-audit-form app-authoring');
    photoSection.append(node('h4','② 얼굴사진 촬영·등록'),
      node('p','업무용 직원 얼굴사진만 등록합니다. 주민등록증 등 증명서 사진은 이곳에 올리지 마세요.','help'));
    const photoMessage=node('p','', 'help');photoMessage.setAttribute('role','status');
    const file=input('file');file.accept='image/jpeg,image/png,image/webp';
    file.setAttribute('capture','user');
    file.className='employee-field-audit-file';
    const pick=button('📷 사진 촬영 또는 파일 선택',()=>file.click(),true);
    pick.dataset.auditPhotoPick='1';
    file.addEventListener('change',async()=>{
      const chosen=file.files?.[0];if(!chosen)return;
      pick.disabled=true;photoMessage.textContent='사진 저장 중…';photoMessage.classList.remove('error');
      let backendSaved=false;let photoPath=null;
      try {
        const api=window.TaejangEmployeeManagement;
        if(typeof api?.uploadEmployeePhoto!=='function') throw Error('사진 업로드 기능을 불러오지 못했습니다. 다시 로그인해 주세요.');
        photoPath=await api.uploadEmployeePhoto(employee,'profile',chosen);
        const result=await app().rpc('set_employee_photo',{p_employee_uuid:employee.id,p_photo_type:'profile',p_storage_path:photoPath});
        if(!result?.ok)throw Error(result?.code||'사진 정보 저장 실패');
        backendSaved=true;
        const latest=await app().rpc('get_employee_field_audit');
        const saved=latest?.employees?.find(e=>e.id===employee.id);
        if(!saved||saved.profile_photo_path!==photoPath)throw Error('사진 저장 후 재조회 확인에 실패했습니다. 최신 상태를 다시 확인해 주세요.');
        state.data=latest;
        state.selectedId=employee.id;
        render();
      } catch(error){
        photoMessage.textContent=backendSaved?'사진 등록은 처리됐으나 재조회 확인에 실패했습니다. 최신 상태를 다시 불러오세요.':
          (app().friendlyError?.(error)||error.message||'사진 업로드 실패');
        photoMessage.classList.add('error');
        if(backendSaved){
          pick.textContent='사진 등록 확인 필요';
          photoSection.append(button('최신 상태 다시 확인',()=>load({keepSelection:true}),true));
        } else pick.disabled=false;
      }
    });
    photoSection.append(pick,file,photoMessage);
    section.append(photoSection);

    if (employee.can_edit_basic) {
      const basic=document.createElement('form');
      basic.className='employee-field-audit-form app-authoring';
      basic.append(node('h4','③ 기본정보 교정'));
      const name=input('text',employee.full_name);name.maxLength=80;name.required=true;
      const hired=input('date',employee.hired_on);hired.required=true;
      const departments=(state.data?.departments||[]).map(d=>({value:d.id,label:d.name}));
      const positions=(state.data?.positions||[]).map(p=>({value:p.id,label:p.name}));
      const dept=select(departments,employee.department_id);
      const pos=select(positions,employee.position_id);
      const attendance=input('checkbox');attendance.checked=Boolean(employee.attendance_required);
      const attendanceLabel=field('근태 기록 대상',attendance);
      attendanceLabel.classList.add('employee-field-audit-check');
      const submitBasic=button('기본정보 수정 저장',()=>{});
      submitBasic.type='submit';
      const basicMsg=node('p','', 'help');basicMsg.setAttribute('role','status');
      basic.append(field('이름',name),field('실제 입사일',hired),field('소속 부서',dept),
        field('직책',pos),attendanceLabel,
        node('p','수정 이력은 남으며 기존 직원번호·급여·확정근태·앱 계정은 변경되지 않습니다.','help'),submitBasic,basicMsg);
      basic.addEventListener('submit',async event=>{
        event.preventDefault();submitBasic.disabled=true;basicMsg.textContent='기본정보 저장 중…';
        try {
          const result=await app().rpc('update_employee_field_audit_basic',{
            p_employee_uuid:employee.id,p_expected_updated_at:employee.updated_at,
            p_full_name:name.value.trim(),p_hired_on:hired.value,p_department_id:dept.value,
            p_position_id:pos.value,p_attendance_required:attendance.checked
          });
          if(!result?.ok)throw Error(result?.code||'기본정보 저장 실패');
          state.selectedId=employee.id;
          await load({keepSelection:true});
        } catch(error){
          basicMsg.textContent=app().friendlyError?.(error)||error.message||'기본정보 저장 실패';
          basicMsg.classList.add('error');submitBasic.disabled=false;
        }
      });
      section.append(basic);
    } else {
      section.append(alertBox('관리자·보호 직원의 인사정보 변경은 운영총괄이 기존 직원관리에서 처리합니다.'));
    }
    return section;
  }

  function style() {
    if(document.querySelector('style[data-employee-field-audit-style]'))return;
    const element=document.createElement('style');
    element.dataset.employeeFieldAuditStyle='1';
    element.textContent=`
      .employee-field-audit{display:grid;gap:16px;min-width:0;width:100%;max-width:1160px;margin:0 auto;}
      .employee-field-audit-head{display:grid;gap:8px;}.employee-field-audit-head h2{margin:0;}
      .employee-field-audit-head .quick-links{display:flex;flex-wrap:wrap;gap:10px;}
      .employee-field-audit-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
      .employee-field-audit-stat{display:flex;flex-direction:column;gap:4px;padding:15px;border:1px solid var(--app-border,#d3ddd6);border-radius:12px;background:#fff;}
      .employee-field-audit-stat strong{font-size:1.3rem;color:#124c37;}
      .employee-field-audit-filters{display:grid;grid-template-columns:2fr 1fr;gap:12px;}
      .employee-field-audit-filters .employee-field-audit-field{display:grid;gap:5px;min-width:0;font-weight:700;}
      .employee-field-audit-filters :is(input,select){box-sizing:border-box;width:100%;min-height:44px;border:1px solid #afc3b8;border-radius:9px;padding:9px;background:#fff;font:inherit;}

      .employee-field-audit-field>span{font-size:.9rem;}

      .employee-field-audit-list{display:grid;gap:8px;}
      .employee-field-audit-row{display:flex;justify-content:space-between;align-items:center;gap:14px;text-align:left;width:100%;min-height:74px;padding:12px 15px;background:#fff;border:1px solid #d8e2da;border-radius:11px;color:#233e31;cursor:pointer;}
      .employee-field-audit-row:hover,.employee-field-audit-row:focus-visible{outline:2px solid #2a7955;outline-offset:1px;}
      .employee-field-audit-identity{display:grid;gap:4px;min-width:0;}
      .employee-field-audit-identity small{font-size:.83rem;font-weight:500;}
      .employee-field-audit-badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;}
      .employee-field-audit-badges span{display:inline-block;padding:4px 7px;border-radius:7px;font-size:.75rem;font-weight:700;}
      .employee-field-audit-ok{background:#dcefe2;color:#135e35;}.employee-field-audit-warn{background:#fff1d8;color:#815006;}
      .employee-field-audit-detail{display:grid;gap:13px;}
      .employee-field-audit-detail-head{display:grid;gap:8px;}.employee-field-audit-detail-head h3{margin:0;}
      .employee-field-audit-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;}
      .employee-field-audit-facts>div{display:grid;gap:4px;padding:11px;border:1px solid #d8e2da;border-radius:9px;background:white;}
      .employee-field-audit-form{display:grid;gap:10px;padding:16px;background:white;border:1px solid #d8e2da;border-radius:12px;min-width:0;}
      .employee-field-audit-form h4{margin:0;}
      .employee-field-audit-check{display:flex;align-items:center;flex-direction:row;gap:9px;font-weight:600;}
      .employee-field-audit-check input{width:22px;height:22px;min-width:22px;flex:none;}
      .employee-field-audit-file{position:absolute;width:1px!important;height:1px!important;opacity:0;pointer-events:none;}
      @media(max-width:760px){.employee-field-audit-summary{grid-template-columns:repeat(2,minmax(0,1fr));}.employee-field-audit-filters,.employee-field-audit-facts{grid-template-columns:minmax(0,1fr);}.employee-field-audit-row{flex-direction:column;align-items:stretch;}.employee-field-audit-badges{justify-content:flex-start;}}
    `;
    document.head.append(element);
  }
  style();
  window.TaejangEmployeeFieldAudit = { open: () => load(), ready };
})();
