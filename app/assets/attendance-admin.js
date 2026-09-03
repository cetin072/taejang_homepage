(() => {
  'use strict';

  const allowed = new Set(['promotion_lead', 'operations_manager']);
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  const time = value => value ? new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul'
  }).format(new Date(value)) : '-';
  const good = record => record && ['recorded', 'exception_approved'].includes(record.status);
  const statusText = record => {
    if (!record) return '미처리';
    if (record.status === 'recorded') return 'GPS 확인';
    if (record.status === 'exception_approved') return '관리자 승인';
    if (record.status === 'exception_pending') return '확인 필요';
    if (record.status === 'exception_rejected') return '반려';
    return record.status;
  };

  function injectStyles() {
    if (document.querySelector('style[data-attendance-admin]')) return;
    const style = document.createElement('style');
    style.dataset.attendanceAdmin = '1';
    style.textContent = `
      .attendance-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:18px 0; }
      .attendance-summary article { padding:16px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .attendance-summary strong { display:block; margin-top:6px; font-size:28px; }
      .attendance-list { display:grid; gap:10px; }
      .attendance-row { display:grid; grid-template-columns:minmax(120px,1.3fr) 1fr 1fr; gap:12px; align-items:center; padding:14px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .attendance-person { font-size:18px; font-weight:900; }
      .attendance-cell { font-size:15px; line-height:1.45; }
      .attendance-cell strong { display:block; font-size:17px; }
      .attendance-review-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
      @media(max-width:720px){.attendance-summary{grid-template-columns:repeat(2,1fr)}.attendance-row{grid-template-columns:1fr}.attendance-cell{padding-top:8px;border-top:1px solid #eee}}
    `;
    document.head.append(style);
  }

  function closeSidebar() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  async function review(eventId, approve, button) {
    button.disabled = true;
    try {
      const result = await app().rpc('review_attendance_exception', { p_event_id: eventId, p_approve: approve });
      if (!result?.ok) throw new Error(result?.code || 'REVIEW_FAILED');
      await openAttendance();
    } catch {
      button.disabled = false;
      window.alert('출근부 확인을 처리하지 못했습니다.');
    }
  }

  function reviewButtons(record) {
    if (!record || record.status !== 'exception_pending') return null;
    const wrap = el('div', null, 'attendance-review-actions');
    const approve = el('button', '승인', 'button'); approve.type = 'button';
    const reject = el('button', '반려', 'button button-quiet'); reject.type = 'button';
    approve.addEventListener('click', () => review(record.id, true, approve));
    reject.addEventListener('click', () => review(record.id, false, reject));
    wrap.append(approve, reject);
    return wrap;
  }

  function cell(label, record) {
    const box = el('div', null, 'attendance-cell');
    box.append(el('span', label, 'eyebrow'), el('strong', `${time(record?.event_at || record?.requested_at)} · ${statusText(record)}`));
    const actions = reviewButtons(record);
    if (actions) box.append(actions);
    return box;
  }

  function summaryCard(label, value) {
    const card = el('article'); card.append(el('span', label), el('strong', String(value))); return card;
  }

  async function openAttendance() {
    if (!allowed.has(route())) return;
    closeSidebar();
    const target = main();
    document.getElementById('desktop-page-title').textContent = '출근부';
    target.hidden = false;
    target.replaceChildren(el('p', '오늘 출근부를 불러오고 있습니다.', 'message'));
    try {
      const data = await app().rpc('get_attendance_admin_today', { p_work_date: null });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const inCount = rows.filter(row => good(row.clock_in)).length;
      const pendingCount = rows.filter(row => row.clock_in?.status === 'exception_pending' || row.clock_out?.status === 'exception_pending').length;
      const outCount = rows.filter(row => good(row.clock_out)).length;
      const missingCount = rows.filter(row => !row.clock_in).length;

      const intro = el('header', null, 'dashboard-intro');
      const back = el('button', '대시보드로', 'button button-quiet'); back.type = 'button';
      back.addEventListener('click', () => document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh')));
      intro.append(el('p', '운영팀장 담당', 'eyebrow'), el('h2', '오늘 출근부'), el('p', '출퇴근 대상 직원의 GPS 기록과 예외 요청을 확인합니다. 직원이 같은 출퇴근 건으로 반복 요청하는 것은 서버에서 차단됩니다.'), back);

      const summary = el('section', null, 'attendance-summary');
      summary.append(summaryCard('대상 직원', rows.length), summaryCard('출근 완료', inCount), summaryCard('확인 필요', pendingCount), summaryCard('퇴근 완료', outCount));
      if (missingCount) summary.append(summaryCard('아직 미출근', missingCount));

      const list = el('section', null, 'attendance-list');
      if (!rows.length) list.append(el('p', '현재 출퇴근 대상 직원 계정이 없습니다.', 'empty'));
      rows.forEach(row => {
        const line = el('article', null, 'attendance-row');
        line.append(el('div', row.display_name || '직원', 'attendance-person'), cell('출근', row.clock_in), cell('퇴근', row.clock_out));
        list.append(line);
      });
      target.replaceChildren(intro, summary, list);
    } catch {
      target.replaceChildren(el('p', '출근부를 불러오지 못했습니다.', 'message error'));
    }
  }

  function addNavigation() {
    if (!allowed.has(route())) return;
    const nav = document.getElementById('app-nav');
    if (!nav || nav.querySelector('[data-attendance-nav]')) return;
    const button = el('button', '출근부', 'button button-quiet');
    button.type = 'button'; button.dataset.attendanceNav = '1';
    button.addEventListener('click', openAttendance);
    const homepage = [...nav.children].find(child => child.textContent?.trim() === '홈페이지');
    if (homepage) nav.insertBefore(button, homepage); else nav.append(button);
  }

  function addDashboardCard() {
    if (!allowed.has(route())) return;
    const grid = main()?.querySelector('.dashboard-grid');
    if (!grid || grid.querySelector('[data-attendance-card]')) return;
    const card = el('article', null, 'dashboard-card'); card.dataset.attendanceCard = '1';
    card.append(el('span', '현재 담당 업무', 'status-label'), el('h3', '오늘 출근부'), el('p', '출퇴근 대상 직원의 GPS 기록과 예외 요청을 확인합니다.'));
    const button = el('button', '출근부 열기', 'button button-quiet'); button.type = 'button'; button.addEventListener('click', openAttendance);
    card.append(button); grid.prepend(card);
  }

  function sync() { addNavigation(); addDashboardCard(); }
  injectStyles();
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 100));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));
  window.TaejangAttendanceAdmin = { openAttendance };
})();
