(function (root, factory) {
  root.TaejangStaffTodayInformation = factory(root.TaejangStaffInformationUI);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ui) {
  'use strict';

  function kindLabel(item) {
    if (item.source === 'schedule') return ui.SCHEDULE_TYPES[item.kind] || '일정';
    if (item.source === 'notice') return ui.NOTICE_KINDS[item.kind] || '공지';
    return window.TaejangTodayBoard?.KIND_LABELS?.[item.kind] || '안내';
  }

  function render(items) {
    const list = ui.element('information-list');
    list.replaceChildren();
    const information = ui.array(items);
    if (!information.length) {
      list.append(ui.text('p', '오늘 확인할 중요한 일정이나 공지가 없습니다.', 'empty'));
      return;
    }
    information.forEach(item => {
      const card = document.createElement('article');
      card.className = `today-card information-card${item.important ? ' is-important' : ''}${item.status === 'cancelled' ? ' is-cancelled' : ''}`;
      const status = item.status === 'cancelled' ? ' · 취소' : item.is_changed ? ' · 변경됨' : '';
      card.append(
        ui.text('p', `${kindLabel(item)}${status}`, 'card-kicker'),
        ui.text('h3', item.title),
        ui.text('p', item.body || '', 'card-body')
      );
      if (item.location) card.append(ui.text('p', `장소: ${item.location}`, 'card-location'));
      if (item.preparation) card.append(ui.text('p', `준비물: ${item.preparation}`, 'card-location'));
      if (item.vehicle_departure_at) card.append(ui.text('p', `차량 출발: ${ui.formatDateTime(item.vehicle_departure_at)}`, 'card-location'));
      if (item.source === 'notice' && item.requires_acknowledgement && !item.acknowledged) {
        card.append(ui.text('p', '아직 확인하지 않은 공지입니다.', 'status-text'));
      }
      if (item.source === 'schedule' || item.source === 'notice') {
        const button = ui.text('button', item.source === 'schedule' ? '일정 자세히 보기' : '공지 자세히 보기', 'button button-quiet');
        button.type = 'button';
        button.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent(
            item.source === 'schedule' ? 'taejang-open-schedule' : 'taejang-open-notice',
            { detail: { id: item.detail_id, fromToday: true } }
          ));
        });
        card.append(button);
      }
      list.append(card);
    });
  }

  return { render };
});
