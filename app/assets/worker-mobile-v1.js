(() => {
  'use strict';

  const attempts = { clock_in: 0, clock_out: 0 };
  const lastFailure = { clock_in: null, clock_out: null };
  const lastPosition = { clock_in: null, clock_out: null };
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
    if (document.querySelector('style[data-worker-mobile-v1]')) return;
    const style = document.createElement('style');
    style.dataset.workerMobileV1 = '1';
    style.textContent = `
      body.general-worker-mode { background:#f6f6f2; }
      body.general-worker-mode .staff-shell { width:min(100%,560px); margin:0 auto; padding:0 16px 32px; }
      body.general-worker-mode .staff-header { min-height:68px; position:sticky; top:0; z-index:20; background:rgba(246,246,242,.96); backdrop-filter:blur(10px); }
      body.general-worker-mode .staff-brand { font-size:24px; font-weight:900; text-decoration:none; }
      #general-worker-board.worker-v1-hidden { display:none !important; }
      .worker-mobile-home { display:grid; gap:18px; padding:10px 0 36px; }
      .worker-mobile-hero { padding:8px 2px 2px; }
      .worker-mobile-hero .worker-date { margin:0 0 4px; font-size:17px; font-weight:800; color:#555; }
      .worker-mobile-hero h1 { margin:0; font-size:30px; line-height:1.25; letter-spacing:-.03em; }
      .worker-card,.worker-install-card { background:#fff; border:1px solid #deded7; border-radius:20px; padding:20px; box-shadow:0 8px 26px rgba(0,0,0,.045); }
      .worker-card h2,.worker-install-card h2 { margin:0 0 10px; font-size:23px; line-height:1.3; }
      .worker-card p,.worker-install-card p { font-size:18px; line-height:1.55; }
      .worker-attendance-state { margin:8px 0 16px; font-size:19px; font-weight:800; }
      .worker-time { display:block; margin-top:5px; font-size:28px; font-weight:900; }
      .worker-primary-button,.worker-secondary-button { width:100%; min-height:68px; border-radius:16px; border:0; font:inherit; font-size:21px; font-weight:900; cursor:pointer; }
      .worker-primary-button { background:#173f31; color:#fff; }
      .worker-secondary-button { margin-top:10px; background:#eee; color:#171717; }
      .worker-primary-button:disabled,.worker-secondary-button:disabled { opacity:.55; cursor:not-allowed; }
      .worker-message { margin:12px 0 0; padding:14px; border-radius:14px; background:#f2f2ed; font-size:17px; line-height:1.5; font-weight:700; }
      .worker-message.error { background:#fff0ed; }
      .worker-message.success { background:#eef7f1; }
      .worker-notice-list { display:grid; gap:12px; }
      .worker-notice { padding:16px; border:1px solid #e3e3dd; border-radius:16px; background:#fff; }
      .worker-notice strong { display:block; font-size:20px; line-height:1.4; }
      .worker-notice p { margin:8px 0 0; font-size:17px; }
      .worker-notice-badge { display:inline-block; margin-bottom:7px; font-size:15px; font-weight:900; }
      .worker-ack-button { width:100%; min-height:58px; margin-top:12px; border:0; border-radius:14px; font:inherit; font-size:19px; font-weight:900; background:#173f31; color:#fff; }
      .worker-acknowledged { margin-top:10px; font-size:17px; font-weight:900; }
      .worker-footer-note { margin:0; text-align:center; color:#666; font-size:15px; line-height:1.5; }
      @media(min-width:761px){body.general-worker-mode .staff-shell{padding-left:24px;padding-right:24px}.worker-mobile-home{padding-top:20px}}
    `;
    document.head.append(style);
  }

  function bindBrand() {
    const brand = document.querySelector('.staff-brand');
    if (!brand || brand.dataset.workerHomeBound) return;
    brand.dataset.workerHomeBound = '1';
    brand.href = '#worker-mobile-home';
    brand.setAttribute('aria-label', '태장 업무앱 홈으로 이동');
    brand.addEventListener('click', event => {
      event.preventDefault();
      document.getElementById('worker-mobile-home')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function eventGood(record) {
    return record && ['recorded', 'exception_approved'].includes(record.status);
  }

  function buildHome() {
    let home = document.getElementById('worker-mobile-home');
    if (home) return home;
    home = node('section', null, 'worker-mobile-home');
    home.id = 'worker-mobile-home';
    home.setAttribute('aria-label', '태장 일반직원 홈');

    const hero = node('header', null, 'worker-mobile-hero');
    const date = node('p', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date()), 'worker-date');
    hero.append(date, node('h1', `${context().display_name || '직원'}님, 안녕하세요`));

    const attendance = node('section', null, 'worker-card');
    attendance.id = 'worker-attendance-card';
    const notices = node('section', null, 'worker-card');
    notices.id = 'worker-notice-card';
    notices.append(node('h2', '꼭 확인하세요'), node('div', null, 'worker-notice-list'));

    const install = window.TaejangPwaInstall?.makeInstallCard?.();
    home.append(hero);
    if (install) home.append(install);
    home.append(attendance, notices, node('p', '위치는 출근·퇴근 버튼을 누르는 순간에만 확인합니다.', 'worker-footer-note'));
    document.querySelector('.staff-shell')?.append(home);
    return home;
  }

  function setMessage(card, text, kind = '') {
    let box = card.querySelector('.worker-message');
    if (!box) { box = node('p', '', 'worker-message'); card.append(box); }
    box.className = `worker-message${kind ? ` ${kind}` : ''}`;
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
    if (card.querySelector('[data-exception-request]')) return;
    const button = node('button', '관리자 확인 요청', 'worker-secondary-button');
    button.type = 'button';
    button.dataset.exceptionRequest = '1';
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
    const mainButton = card.querySelector('[data-attendance-action]');
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
      if (result?.code === 'NON_WORKDAY') {
        setMessage(card, '오늘은 휴일이라 출퇴근을 등록할 수 없습니다.', 'error');
      } else if (result?.code === 'OUTSIDE_GEOFENCE') {
        setMessage(card, '회사 출근 장소 안에서만 출퇴근할 수 있습니다.', 'error');
      } else if (result?.code === 'LOCATION_UNCERTAIN') {
        lastFailure[eventType] = 'LOCATION_UNCERTAIN';
        setMessage(card, attempts[eventType] < 2 ? '위치가 정확하지 않습니다. 잠시 후 다시 눌러주세요.' : '위치를 두 번 확인했지만 정확하지 않습니다.', 'error');
        allowException(eventType, card);
      } else if (result?.code === 'CLOCK_IN_REQUIRED') {
        setMessage(card, '먼저 출근 처리가 완료되어야 합니다.', 'error');
      } else {
        setMessage(card, '출퇴근을 처리하지 못했습니다. 다시 시도해주세요.', 'error');
      }
    } catch (error) {
      const code = failureCode(error);
      lastFailure[eventType] = code;
      if (code === 'PERMISSION_DENIED') {
        setMessage(card, '출퇴근을 위해 휴대폰의 위치 권한을 허용해주세요. 관리자 요청으로 대신할 수 없습니다.', 'error');
      } else {
        setMessage(card, attempts[eventType] < 2 ? '위치를 확인하지 못했습니다. 다시 한 번 눌러주세요.' : '위치를 두 번 확인하지 못했습니다.', 'error');
        allowException(eventType, card);
      }
    } finally {
      if (mainButton?.isConnected) mainButton.disabled = false;
    }
  }

  function renderAttendance(data) {
    const card = document.getElementById('worker-attendance-card');
    if (!card) return;
    card.replaceChildren(node('h2', '오늘 출퇴근'));

    if (!data?.is_workday) {
      card.append(node('p', `오늘은 휴일입니다. (${data?.day_reason || '휴일'})`, 'worker-attendance-state'));
      return;
    }

    const clockIn = data.clock_in;
    const clockOut = data.clock_out;

    if (!clockIn || clockIn.status === 'exception_rejected') {
      const state = node('p', clockIn?.status === 'exception_rejected' ? '관리자 확인이 반려되었습니다. 회사에 도착한 뒤 GPS로 다시 출근하세요.' : '아직 출근 전입니다.', 'worker-attendance-state');
      const button = node('button', '출근했습니다', 'worker-primary-button');
      button.type = 'button'; button.dataset.attendanceAction = 'clock_in';
      button.addEventListener('click', () => attemptAttendance('clock_in', card));
      card.append(state, button);
      return;
    }

    if (clockIn.status === 'exception_pending') {
      card.append(node('p', '출근 확인을 관리자에게 요청했습니다.', 'worker-attendance-state'), node('p', '관리자 확인 중입니다. 같은 요청은 다시 보낼 수 없습니다.', 'worker-message'));
      return;
    }

    const inState = node('p', '출근 완료', 'worker-attendance-state');
    inState.append(node('span', formatTime(clockIn.event_at), 'worker-time'));
    card.append(inState);

    if (!clockOut || clockOut.status === 'exception_rejected') {
      const button = node('button', '퇴근했습니다', 'worker-primary-button');
      button.type = 'button'; button.dataset.attendanceAction = 'clock_out';
      button.addEventListener('click', () => attemptAttendance('clock_out', card));
      card.append(button);
      return;
    }

    if (clockOut.status === 'exception_pending') {
      card.append(node('p', '퇴근 확인을 관리자에게 요청했습니다.', 'worker-message'));
      return;
    }

    const outState = node('p', '퇴근 완료', 'worker-attendance-state');
    outState.append(node('span', formatTime(clockOut.event_at), 'worker-time'));
    card.append(outState, node('p', '오늘도 수고하셨습니다.', 'worker-message success'));
  }

  async function loadAttendance() {
    try { renderAttendance(await app().rpc('get_my_attendance_today')); }
    catch { setMessage(document.getElementById('worker-attendance-card'), '출퇴근 정보를 불러오지 못했습니다.', 'error'); }
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
    const list = document.querySelector('#worker-notice-card .worker-notice-list');
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
        const card = node('article', null, 'worker-notice');
        if (notice.importance === 'urgent' || notice.importance === 'important') card.append(node('span', '중요공지', 'worker-notice-badge'));
        card.append(node('strong', notice.title));
        if (notice.summary) card.append(node('p', notice.summary));
        if (notice.requires_acknowledgement) {
          if (notice.acknowledged) card.append(node('p', '✓ 확인했습니다', 'worker-acknowledged'));
          else {
            const button = node('button', '확인했습니다', 'worker-ack-button');
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

  async function start() {
    if (route() !== 'general_worker') return;
    injectStyles();
    bindBrand();
    document.getElementById('general-worker-board')?.classList.add('worker-v1-hidden');
    buildHome();
    await Promise.all([loadAttendance(), loadNotices()]);
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(start, 0));
  document.addEventListener('taejang-pwa-install-ready', () => {
    if (route() !== 'general_worker' || document.querySelector('[data-worker-install-card]')) return;
    const card = window.TaejangPwaInstall?.makeInstallCard?.();
    if (card) document.getElementById('worker-attendance-card')?.before(card);
  });
})();
