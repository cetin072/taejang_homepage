(() => {
  'use strict';

  const STORAGE_KEY = 'taejang-role-simulation-v1';
  const PROMOTION_EMPLOYEE_ROLES = new Set(['promotion_staff', 'promotion_lead']);
  const ALL_EMPLOYEE_HOME_ROLES = new Set(['general_worker', 'promotion_staff', 'promotion_lead']);
  const ROLE_LABELS = {
    general_worker: '일반직원',
    promotion_staff: '홍보직원',
    promotion_lead: '운영팀장'
  };
  const attempts = { clock_in: 0, clock_out: 0 };
  const lastFailure = { clock_in: null, clock_out: null };
  const lastPosition = { clock_in: null, clock_out: null };
  let switching = false;

  const app = () => window.TaejangApp;
  const context = () => app()?.getContext?.() || {};
  const route = () => app()?.getRoute?.();
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  };
  const formatTime = value => value ? new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul'
  }).format(new Date(value)) : '';

  function injectStyles() {
    if (document.querySelector('style[data-employee-common-home]')) return;
    const style = document.createElement('style');
    style.dataset.employeeCommonHome = '1';
    style.textContent = `
      body.employee-home-mode { background:#f6f6f2; }
      body.employee-home-mode .staff-shell { width:min(100%,560px); margin:0 auto; padding:0 16px 32px; }
      body.employee-home-mode .staff-header { min-height:68px; position:sticky; top:0; z-index:20; background:rgba(246,246,242,.96); backdrop-filter:blur(10px); }
      body.employee-home-mode .staff-brand { font-size:24px; font-weight:900; text-decoration:none; }
      .employee-common-home { display:grid; gap:18px; padding:10px 0 36px; }
      .employee-common-hero { padding:8px 2px 2px; }
      .employee-common-hero .employee-date { margin:0 0 4px; font-size:17px; font-weight:800; color:#555; }
      .employee-common-hero h1 { margin:0; font-size:30px; line-height:1.25; letter-spacing:-.03em; }
      .employee-card { background:#fff; border:1px solid #deded7; border-radius:20px; padding:20px; box-shadow:0 8px 26px rgba(0,0,0,.045); }
      .employee-card h2 { margin:0 0 10px; font-size:23px; line-height:1.3; }
      .employee-card p { font-size:18px; line-height:1.55; }
      .employee-attendance-state { margin:8px 0 16px; font-size:19px; font-weight:800; }
      .employee-time { display:block; margin-top:5px; font-size:28px; font-weight:900; }
      .employee-primary-button,.employee-secondary-button { width:100%; min-height:68px; border-radius:16px; border:0; font:inherit; font-size:21px; font-weight:900; cursor:pointer; }
      .employee-primary-button { background:#173f31; color:#fff; }
      .employee-secondary-button { margin-top:10px; background:#eee; color:#171717; }
      .employee-primary-button:disabled,.employee-secondary-button:disabled { opacity:.55; cursor:not-allowed; }
      .employee-message { margin:12px 0 0; padding:14px; border-radius:14px; background:#f2f2ed; font-size:17px; line-height:1.5; font-weight:700; }
      .employee-message.error { background:#fff0ed; }
      .employee-message.success { background:#eef7f1; }
      .employee-notice-list { display:grid; gap:12px; }
      .employee-notice { padding:16px; border:1px solid #e3e3dd; border-radius:16px; background:#fff; }
      .employee-notice strong { display:block; font-size:20px; line-height:1.4; }
      .employee-notice p { margin:8px 0 0; font-size:17px; }
      .employee-notice-badge { display:inline-block; margin-bottom:7px; font-size:15px; font-weight:900; }
      .employee-ack-button { width:100%; min-height:58px; margin-top:12px; border:0; border-radius:14px; font:inherit; font-size:19px; font-weight:900; background:#173f31; color:#fff; }
      .employee-acknowledged { margin-top:10px; font-size:17px; font-weight:900; }
      .employee-footer-note { margin:0; text-align:center; color:#666; font-size:15px; line-height:1.5; }
      .employee-role-switch-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .employee-role-switch-grid button { min-height:52px; border:1px solid #d8d8d1; border-radius:13px; background:#fff; font:inherit; font-weight:900; }
      .employee-role-switch-grid button[aria-pressed="true"] { background:#173f31; color:#fff; border-color:#173f31; }
      .employee-dashboard-return { min-height:42px !important; }
      @media(min-width:761px){body.employee-home-mode .staff-shell{padding-left:24px;padding-right:24px}.employee-common-home{padding-top:20px}}
    `;
    document.head.append(style);
  }

  async function switchSimulation(roleCode) {
    if (switching) return;
    switching = true;
    try {
      await app().rpc('set_role_simulation_mode', { p_role_code: roleCode });
      if (roleCode) sessionStorage.setItem(STORAGE_KEY, roleCode);
      else sessionStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    } catch (error) {
      switching = false;
      window.alert(app()?.friendlyError?.(error) || '권한 화면을 전환하지 못했습니다.');
    }
  }

  function makeSimulationCard() {
    const simulation = context()?.role_simulation;
    if (!simulation?.can_switch) return null;
    const card = node('section', null, 'employee-card');
    card.dataset.employeeSimulationCard = '1';
    card.append(node('h2', '권한 체험'));
    if (simulation.active) card.append(node('p', `${ROLE_LABELS[simulation.role_code] || simulation.role_code} 화면을 체험하고 있습니다.`));
    const grid = node('div', null, 'employee-role-switch-grid');
    const active = simulation.active ? simulation.role_code : null;
    [
      ['일반직원', 'general_worker'],
      ['홍보직원', 'promotion_staff'],
      ['운영팀장', 'promotion_lead'],
      ['운영총괄 복귀', null]
    ].forEach(([label, code]) => {
      const button = node('button', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(code ? active === code : !active));
      button.addEventListener('click', () => switchSimulation(code));
      grid.append(button);
    });
    card.append(grid);
    return card;
  }

  function injectGeneralWorkerDesktopSimulationButton() {
    const simulation = context()?.role_simulation;
    if (!simulation?.can_switch || simulation.active) return;
    const switcher = document.querySelector('[data-role-simulation-switcher]');
    if (!switcher || switcher.querySelector('[data-general-worker-simulation]')) return;
    const button = node('button', '일반직원 보기', 'button button-quiet');
    button.type = 'button';
    button.dataset.generalWorkerSimulation = '1';
    button.dataset.roleSimulationButton = 'general_worker';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => switchSimulation('general_worker'));
    switcher.prepend(button);
  }

  function showEmployeeHome() {
    const home = document.getElementById('employee-common-home');
    const shell = document.getElementById('desktop-app-shell');
    if (!home || !shell) return;
    shell.hidden = true;
    home.hidden = false;
    document.body.classList.add('employee-home-mode');
    home.scrollIntoView({ block: 'start' });
  }

  function showRoleDashboard() {
    const home = document.getElementById('employee-common-home');
    const shell = document.getElementById('desktop-app-shell');
    if (!home || !shell) return;
    home.hidden = true;
    document.body.classList.remove('employee-home-mode');
    shell.hidden = false;
    document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh'));
    document.getElementById('dashboard-main')?.scrollIntoView({ block: 'start' });
  }

  function installDashboardReturn() {
    const actions = document.querySelector('.app-user-actions');
    if (!actions || actions.querySelector('[data-employee-home-return]')) return;
    const button = node('button', '직원 홈', 'button button-quiet employee-dashboard-return');
    button.type = 'button';
    button.dataset.employeeHomeReturn = '1';
    button.addEventListener('click', showEmployeeHome);
    actions.prepend(button);
  }

  function buildHome() {
    let home = document.getElementById('employee-common-home');
    if (home) return home;
    home = node('section', null, 'employee-common-home');
    home.id = 'employee-common-home';
    home.setAttribute('aria-label', '태장 직원 홈');

    const hero = node('header', null, 'employee-common-hero');
    hero.append(
      node('p', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date()), 'employee-date'),
      node('h1', `${context().display_name || '직원'}님, 안녕하세요`)
    );
    home.append(hero);

    const simulationCard = makeSimulationCard();
    if (simulationCard) home.append(simulationCard);

    const install = window.TaejangPwaInstall?.makeInstallCard?.();
    if (install) home.append(install);

    const attendance = node('section', null, 'employee-card');
    attendance.id = 'employee-attendance-card';
    home.append(attendance);

    const work = node('section', null, 'employee-card');
    work.append(node('h2', '내 업무'));
    const currentRoute = route();
    const copy = currentRoute === 'promotion_lead'
      ? '홍보 검토와 출근부 관리가 필요할 때 업무 화면을 여세요.'
      : '홍보자료를 작성하거나 보완 요청을 확인할 때 업무 화면을 여세요.';
    work.append(node('p', copy));
    const workButton = node('button', currentRoute === 'promotion_lead' ? '운영팀 업무 열기' : '홍보 업무 열기', 'employee-primary-button');
    workButton.type = 'button';
    workButton.addEventListener('click', showRoleDashboard);
    work.append(workButton);
    home.append(work);

    const notices = node('section', null, 'employee-card');
    notices.id = 'employee-notice-card';
    notices.append(node('h2', '꼭 확인하세요'), node('div', null, 'employee-notice-list'));
    home.append(notices, node('p', '위치는 출근·퇴근 버튼을 누르는 순간에만 확인합니다.', 'employee-footer-note'));

    document.querySelector('.staff-shell')?.append(home);
    return home;
  }

  function setMessage(card, text, kind = '') {
    let box = card?.querySelector('.employee-message');
    if (!box && card) { box = node('p', '', 'employee-message'); card.append(box); }
    if (!box) return;
    box.className = `employee-message${kind ? ` ${kind}` : ''}`;
    box.textContent = text;
  }

  function failureCode(error) {
    if (error?.code === 1) return 'PERMISSION_DENIED';
    if (error?.code === 2) return 'POSITION_UNAVAILABLE';
    if (error?.code === 3) return 'TIMEOUT';
    return 'POSITION_UNAVAILABLE';
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject({ code: 2 });
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    });
  }

  function allowException(eventType, card) {
    const code = lastFailure[eventType];
    if (!['POSITION_UNAVAILABLE', 'TIMEOUT', 'LOCATION_UNCERTAIN'].includes(code) || attempts[eventType] < 2) return;
    if (card.querySelector('[data-employee-exception-request]')) return;
    const button = node('button', '관리자 확인 요청', 'employee-secondary-button');
    button.type = 'button';
    button.dataset.employeeExceptionRequest = '1';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const pos = lastPosition[eventType];
      try {
        const result = await app().rpc('request_attendance_exception', {
          p_event_type: eventType,
          p_failure_code: code,
          p_latitude: pos?.coords?.latitude ?? null,
          p_longitude: pos?.coords?.longitude ?? null,
          p_accuracy_m: pos?.coords?.accuracy ?? null
        });
        if (!result?.ok && result?.code !== 'EXCEPTION_PENDING') throw new Error(result?.code || 'REQUEST_FAILED');
        setMessage(card, '관리자에게 한 번만 확인을 요청했습니다. 추가 요청은 필요하지 않습니다.', 'success');
        button.remove();
        await loadAttendance();
      } catch (error) {
        setMessage(card, error.message === 'LOCATION_PERMISSION_REQUIRED' ? '휴대폰의 위치 권한을 먼저 켜주세요.' : '관리자 확인 요청을 처리하지 못했습니다.', 'error');
        button.disabled = false;
      }
    });
    card.append(button);
  }

  async function attemptAttendance(eventType, card) {
    const mainButton = card.querySelector('[data-employee-attendance-action]');
    if (mainButton) mainButton.disabled = true;
    attempts[eventType] += 1;
    setMessage(card, '현재 위치를 확인하고 있습니다.');
    try {
      const position = await getPosition();
      lastPosition[eventType] = position;
      const result = await app().rpc('record_attendance_event', {
        p_event_type: eventType,
        p_latitude: position.coords.latitude,
        p_longitude: position.coords.longitude,
        p_accuracy_m: position.coords.accuracy
      });
      if (result?.ok || ['ALREADY_RECORDED', 'EXCEPTION_APPROVED'].includes(result?.code)) {
        attempts[eventType] = 0;
        lastFailure[eventType] = null;
        await loadAttendance();
        return;
      }
      if (result?.code === 'NON_WORKDAY') setMessage(card, '오늘은 휴일이라 출퇴근을 등록할 수 없습니다.', 'error');
      else if (result?.code === 'OUTSIDE_GEOFENCE') setMessage(card, '회사 출근 장소 안에서만 출퇴근할 수 있습니다.', 'error');
      else if (result?.code === 'LOCATION_UNCERTAIN') {
        lastFailure[eventType] = 'LOCATION_UNCERTAIN';
        setMessage(card, attempts[eventType] < 2 ? '위치가 정확하지 않습니다. 잠시 후 다시 눌러주세요.' : '위치를 두 번 확인했지만 정확하지 않습니다.', 'error');
        allowException(eventType, card);
      } else if (result?.code === 'CLOCK_IN_REQUIRED') setMessage(card, '먼저 출근 처리가 완료되어야 합니다.', 'error');
      else setMessage(card, '출퇴근을 처리하지 못했습니다. 다시 시도해주세요.', 'error');
    } catch (error) {
      const code = failureCode(error);
      lastFailure[eventType] = code;
      if (code === 'PERMISSION_DENIED') setMessage(card, '출퇴근을 위해 휴대폰의 위치 권한을 허용해주세요. 관리자 요청으로 대신할 수 없습니다.', 'error');
      else {
        setMessage(card, attempts[eventType] < 2 ? '위치를 확인하지 못했습니다. 다시 한 번 눌러주세요.' : '위치를 두 번 확인하지 못했습니다.', 'error');
        allowException(eventType, card);
      }
    } finally {
      if (mainButton?.isConnected) mainButton.disabled = false;
    }
  }

  function renderAttendance(data) {
    const card = document.getElementById('employee-attendance-card');
    if (!card) return;
    card.replaceChildren(node('h2', '오늘 출퇴근'));
    if (!data?.is_workday) {
      card.append(node('p', `오늘은 휴일입니다. (${data?.day_reason || '휴일'})`, 'employee-attendance-state'));
      return;
    }
    const clockIn = data.clock_in;
    const clockOut = data.clock_out;
    if (!clockIn || clockIn.status === 'exception_rejected') {
      card.append(node('p', clockIn?.status === 'exception_rejected' ? '관리자 확인이 반려되었습니다. 회사에 도착한 뒤 GPS로 다시 출근하세요.' : '아직 출근 전입니다.', 'employee-attendance-state'));
      const button = node('button', '출근했습니다', 'employee-primary-button');
      button.type = 'button'; button.dataset.employeeAttendanceAction = 'clock_in';
      button.addEventListener('click', () => attemptAttendance('clock_in', card));
      card.append(button);
      return;
    }
    if (clockIn.status === 'exception_pending') {
      card.append(node('p', '출근 확인을 관리자에게 요청했습니다.', 'employee-attendance-state'), node('p', '관리자 확인 중입니다. 같은 요청은 다시 보낼 수 없습니다.', 'employee-message'));
      return;
    }
    const inState = node('p', '출근 완료', 'employee-attendance-state');
    inState.append(node('span', formatTime(clockIn.event_at), 'employee-time'));
    card.append(inState);
    if (!clockOut || clockOut.status === 'exception_rejected') {
      const button = node('button', '퇴근했습니다', 'employee-primary-button');
      button.type = 'button'; button.dataset.employeeAttendanceAction = 'clock_out';
      button.addEventListener('click', () => attemptAttendance('clock_out', card));
      card.append(button);
      return;
    }
    if (clockOut.status === 'exception_pending') {
      card.append(node('p', '퇴근 확인을 관리자에게 요청했습니다.', 'employee-message'));
      return;
    }
    const outState = node('p', '퇴근 완료', 'employee-attendance-state');
    outState.append(node('span', formatTime(clockOut.event_at), 'employee-time'));
    card.append(outState, node('p', '오늘도 수고하셨습니다.', 'employee-message success'));
  }

  async function loadAttendance() {
    try { renderAttendance(await app().rpc('get_my_attendance_today')); }
    catch { setMessage(document.getElementById('employee-attendance-card'), '출퇴근 정보를 불러오지 못했습니다.', 'error'); }
  }

  async function acknowledge(notice, button) {
    button.disabled = true;
    try {
      const result = await app().rpc('acknowledge_notice', { p_notice_id: notice.id, p_notice_version: notice.version_no });
      if (!result?.ok) throw new Error(result?.code || 'ACK_FAILED');
      await loadNotices();
    } catch {
      button.disabled = false;
      button.textContent = '다시 확인하기';
    }
  }

  async function loadNotices() {
    const list = document.querySelector('#employee-notice-card .employee-notice-list');
    if (!list) return;
    list.replaceChildren(node('p', '공지를 확인하고 있습니다.'));
    try {
      const notices = await app().rpc('get_my_notice_list', { p_limit: 6 });
      list.replaceChildren();
      if (!Array.isArray(notices) || !notices.length) {
        list.append(node('p', '현재 확인할 공지가 없습니다.'));
        return;
      }
      notices.forEach(notice => {
        const card = node('article', null, 'employee-notice');
        if (notice.importance === 'urgent' || notice.importance === 'important') card.append(node('span', '중요공지', 'employee-notice-badge'));
        card.append(node('strong', notice.title));
        if (notice.summary) card.append(node('p', notice.summary));
        if (notice.requires_acknowledgement) {
          if (notice.acknowledged) card.append(node('p', '✓ 확인했습니다', 'employee-acknowledged'));
          else {
            const button = node('button', '확인했습니다', 'employee-ack-button');
            button.type = 'button';
            button.addEventListener('click', () => acknowledge(notice, button));
            card.append(button);
          }
        }
        list.append(card);
      });
    } catch {
      list.replaceChildren(node('p', '공지를 불러오지 못했습니다. 잠시 후 다시 열어주세요.'));
    }
  }

  function attachSimulationCardToGeneralWorker() {
    if (route() !== 'general_worker' || !context()?.role_simulation?.can_switch) return;
    const home = document.getElementById('worker-mobile-home');
    if (!home || home.querySelector('[data-employee-simulation-card]')) return;
    const card = makeSimulationCard();
    if (!card) return;
    card.dataset.employeeSimulationCard = '1';
    const hero = home.querySelector('.worker-mobile-hero');
    if (hero?.nextSibling) home.insertBefore(card, hero.nextSibling);
    else home.prepend(card);
  }

  async function startPromotionEmployeeHome() {
    if (!PROMOTION_EMPLOYEE_ROLES.has(route())) return;
    injectStyles();
    const home = buildHome();
    const shell = document.getElementById('desktop-app-shell');
    if (shell) shell.hidden = true;
    home.hidden = false;
    document.body.classList.add('employee-home-mode');
    installDashboardReturn();
    await Promise.all([loadAttendance(), loadNotices()]);
  }

  function setup() {
    const currentRoute = route();
    if (!ALL_EMPLOYEE_HOME_ROLES.has(currentRoute)) {
      setTimeout(injectGeneralWorkerDesktopSimulationButton, 120);
      return;
    }
    if (PROMOTION_EMPLOYEE_ROLES.has(currentRoute)) startPromotionEmployeeHome();
    else setTimeout(attachSimulationCardToGeneralWorker, 80);
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(setup, 0));
  document.addEventListener('taejang-dashboard-refresh', () => {
    if (PROMOTION_EMPLOYEE_ROLES.has(route())) installDashboardReturn();
  });
  document.addEventListener('taejang-pwa-install-ready', () => {
    if (!PROMOTION_EMPLOYEE_ROLES.has(route()) || document.querySelector('#employee-common-home [data-worker-install-card]')) return;
    const card = window.TaejangPwaInstall?.makeInstallCard?.();
    if (card) document.getElementById('employee-attendance-card')?.before(card);
  });
})();
