(() => {
  'use strict';

  const ui = window.TaejangStaffInformationUI;
  let fromToday = false;

  function showList() {
    ui.setWorkerScreen('schedule-screen');
    ui.element('schedule-list-view').hidden = false;
    ui.element('schedule-detail-view').hidden = true;
    ui.element('schedule-list-title').focus?.();
  }

  function showToday() {
    ui.setWorkerScreen('general-worker-board');
    ui.element('today-title').focus?.();
  }

  function scheduleCard(item) {
    const card = document.createElement('article');
    card.className = `schedule-card${item.status === 'cancelled' ? ' is-cancelled' : ''}`;
    const status = item.status === 'cancelled' ? ' · 취소' : item.is_changed ? ' · 변경됨' : '';
    card.append(
      ui.text('p', `${ui.SCHEDULE_TYPES[item.schedule_type] || '일정'}${status}`, 'card-kicker'),
      ui.text('h3', item.title),
      ui.text('p', ui.formatRange(item.starts_at, item.ends_at, item.all_day), 'card-primary')
    );
    if (item.location) card.append(ui.text('p', `장소: ${item.location}`, 'card-location'));
    if (item.status === 'cancelled') card.append(ui.text('p', '이 일정은 취소되었습니다.', 'status-text'));
    else if (item.is_changed) card.append(ui.text('p', '변경된 일정입니다. 날짜와 장소를 다시 확인하세요.', 'status-text'));
    const button = ui.text('button', '일정 자세히 보기', 'button button-quiet');
    button.type = 'button';
    button.addEventListener('click', () => openDetail(item.id, { fromToday: false }));
    card.append(button);
    return card;
  }

  function renderList(items) {
    const list = ui.element('schedule-list');
    list.replaceChildren();
    if (!items.length) {
      list.append(ui.text('p', '예정된 일정이 없습니다.', 'empty'));
      return;
    }
    const today = window.TaejangApp.getBoardDate();
    const groups = Object.fromEntries(ui.GROUP_ORDER.map(key => [key, []]));
    items.forEach(item => groups[ui.scheduleGroup(item.starts_at, today)].push(item));
    ui.GROUP_ORDER.forEach(key => {
      if (!groups[key].length) return;
      const section = document.createElement('section');
      section.className = 'schedule-group';
      section.setAttribute('aria-labelledby', `schedule-group-${key}`);
      const heading = ui.text('h2', ui.GROUP_LABELS[key]);
      heading.id = `schedule-group-${key}`;
      const cards = document.createElement('div');
      cards.className = 'card-list';
      groups[key].forEach(item => cards.append(scheduleCard(item)));
      section.append(heading, cards);
      list.append(section);
    });
  }

  async function loadList() {
    showList();
    ui.message('schedule-message', '일정을 불러오고 있습니다.');
    ui.element('schedule-list').replaceChildren();
    try {
      const items = await window.TaejangApp.rpc('get_my_schedule_list', {
        p_from_date: window.TaejangApp.getBoardDate(),
        p_limit: 100
      });
      ui.message('schedule-message', '');
      renderList(ui.array(items));
    } catch {
      ui.message('schedule-message', '일정을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true);
    }
  }

  function renderDetail(item) {
    ui.element('schedule-detail-title').textContent = item.title;
    const content = ui.element('schedule-detail-content');
    content.replaceChildren();
    if (item.status === 'cancelled') content.append(ui.text('p', '이 일정은 취소되었습니다.', 'status-banner'));
    else if (item.is_changed) content.append(ui.text('p', '이 일정은 변경되었습니다. 날짜와 장소를 다시 확인하세요.', 'status-banner'));
    const details = document.createElement('dl');
    details.className = 'detail-list';
    ui.appendDetail(details, '일정 종류', ui.SCHEDULE_TYPES[item.schedule_type] || '기타 안내');
    ui.appendDetail(details, '날짜와 시간', ui.formatRange(item.starts_at, item.ends_at, item.all_day));
    ui.appendDetail(details, '장소', item.location);
    ui.appendDetail(details, '담당자', item.manager_label);
    ui.appendDetail(details, '준비물', item.materials);
    ui.appendDetail(details, '이동방법', item.transport_method);
    ui.appendDetail(details, '차량 출발시간', ui.formatDateTime(item.vehicle_departure_at));
    ui.appendDetail(details, '쉬운 설명', item.easy_text);
    ui.appendDetail(details, '상태', item.status === 'cancelled' ? '취소' : '게시 중');
    ui.appendDetail(details, '등록일', ui.formatDateTime(item.created_at));
    ui.appendDetail(details, '최종 수정일', ui.formatDateTime(item.updated_at));
    content.append(details);
  }

  async function openDetail(id, options = {}) {
    fromToday = Boolean(options.fromToday);
    ui.setWorkerScreen('schedule-screen');
    ui.element('schedule-list-view').hidden = true;
    ui.element('schedule-detail-view').hidden = false;
    ui.element('schedule-detail-content').replaceChildren();
    ui.message('schedule-detail-message', '일정 상세를 불러오고 있습니다.');
    try {
      const item = await window.TaejangApp.rpc('get_my_schedule_detail', { p_schedule_id: id });
      ui.message('schedule-detail-message', '');
      renderDetail(item);
      ui.element('schedule-detail-title').focus?.();
    } catch {
      ui.message('schedule-detail-message', '이 일정은 지금 볼 수 없습니다. 담당 반장에게 확인하세요.', true);
    }
  }

  function bind() {
    ui.element('open-schedule-list').addEventListener('click', loadList);
    ui.element('schedule-back-today').addEventListener('click', showToday);
    ui.element('schedule-detail-today').addEventListener('click', showToday);
    ui.element('schedule-detail-back').addEventListener('click', () => {
      if (fromToday) {
        showToday();
      } else {
        loadList();
      }
    });
    document.addEventListener('taejang-open-schedule', event => openDetail(event.detail.id, event.detail));
  }

  document.addEventListener('taejang-app-ready', event => {
    if (event.detail.route === 'general_worker') bind();
  }, { once: true });
})();
