(() => {
  'use strict';

  const ui = window.TaejangStaffInformationUI;
  let fromToday = false;
  let currentNotice = null;

  function showList() {
    ui.setWorkerScreen('notice-screen');
    ui.element('notice-list-view').hidden = false;
    ui.element('notice-detail-view').hidden = true;
    ui.element('notice-list-title').focus?.();
  }

  function showToday() {
    ui.setWorkerScreen('general-worker-board');
    ui.element('today-title').focus?.();
  }

  function noticeCard(item) {
    const card = document.createElement('article');
    card.className = `notice-card importance-${item.importance}`;
    const markers = [];
    if (item.importance === 'urgent') markers.push('긴급');
    if (item.importance === 'important') markers.push('중요');
    if (item.is_changed) markers.push('변경됨');
    else if (item.is_new) markers.push('새 공지');
    card.append(
      ui.text('p', `${markers.join(' · ') || '공지'} · ${ui.NOTICE_KINDS[item.notice_kind] || '일반공지'}`, 'card-kicker'),
      ui.text('h2', item.title),
      ui.text('p', item.summary, 'card-body'),
      ui.text('p', `게시일: ${ui.formatDate(item.publish_start_at)}`, 'help')
    );
    if (item.publish_end_at) card.append(ui.text('p', `표시 종료: ${ui.formatDateTime(item.publish_end_at)}`, 'help'));
    if (item.requires_acknowledgement) {
      card.append(ui.text('p', item.acknowledged ? '내용을 확인했습니다.' : '내용 확인이 필요합니다.', 'status-text'));
    }
    const button = ui.text('button', '공지 자세히 보기', 'button button-quiet');
    button.type = 'button';
    button.addEventListener('click', () => openDetail(item.id, { fromToday: false }));
    card.append(button);
    return card;
  }

  function renderList(items) {
    const list = ui.element('notice-list');
    list.replaceChildren();
    if (!items.length) {
      list.append(ui.text('p', '현재 확인할 공지가 없습니다.', 'empty'));
      return;
    }
    items.forEach(item => list.append(noticeCard(item)));
  }

  async function loadList() {
    showList();
    ui.message('notice-message', '공지를 불러오고 있습니다.');
    ui.element('notice-list').replaceChildren();
    try {
      const notices = await window.TaejangApp.rpc('get_my_notice_list', { p_limit: 100 });
      ui.message('notice-message', '');
      renderList(ui.array(notices));
    } catch {
      ui.message('notice-message', '공지를 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true);
    }
  }

  function relatedLink(notice) {
    const url = ui.safeHttpsUrl(notice.related_link_url);
    if (!url || !notice.related_link_label) return null;
    const wrap = document.createElement('div');
    wrap.className = 'external-link-box';
    wrap.append(ui.text('p', '외부 링크', 'card-kicker'));
    const link = ui.text('a', `${notice.related_link_label} — ${url.hostname}`);
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'button button-quiet';
    wrap.append(link, ui.text('p', `실제 주소: ${url.href}`, 'link-address'));
    return wrap;
  }

  function renderAcknowledgement(notice) {
    const slot = ui.element('notice-ack-slot');
    slot.replaceChildren();
    if (!notice.requires_acknowledgement) return;
    if (notice.acknowledged) {
      slot.append(ui.text('p', `내용을 확인했습니다.${notice.acknowledged_at ? ` ${ui.formatDateTime(notice.acknowledged_at)}` : ''}`, 'status-banner'));
      return;
    }
    const message = ui.text('p', '이 공지는 내용 확인이 필요합니다.', 'status-text');
    const button = ui.text('button', '내용을 확인했어요', 'button');
    button.type = 'button';
    button.addEventListener('click', async () => {
      try {
        currentNotice = await window.TaejangNoticeAcknowledgement.acknowledge(currentNotice, button, 'notice-detail-message');
        renderAcknowledgement(currentNotice);
        await window.TaejangApp.refreshToday();
      } catch (error) {
        if (error.message === 'NOTICE_VERSION_CHANGED') await openDetail(notice.id, { fromToday });
      }
    });
    slot.append(message, button);
  }

  function renderDetail(notice) {
    currentNotice = notice;
    ui.element('notice-detail-title').textContent = notice.title;
    const content = ui.element('notice-detail-content');
    content.replaceChildren();
    if (notice.importance !== 'normal') {
      content.append(ui.text('p', `${ui.IMPORTANCE[notice.importance]} 공지입니다.`, 'status-banner'));
    }
    content.append(ui.text('p', notice.body_easy, 'notice-body'));
    const details = document.createElement('dl');
    details.className = 'detail-list';
    ui.appendDetail(details, '공지 종류', ui.NOTICE_KINDS[notice.notice_kind] || '일반공지');
    ui.appendDetail(details, '중요 여부', ui.IMPORTANCE[notice.importance] || '일반');
    const effective = notice.effective_start_date
      ? `${ui.formatDate(notice.effective_start_date)}${notice.effective_end_date ? ` ~ ${ui.formatDate(notice.effective_end_date)}` : ''}`
      : '';
    ui.appendDetail(details, '적용 날짜 또는 기간', effective);
    ui.appendDetail(details, '장소', notice.location);
    ui.appendDetail(details, '준비물', notice.materials);
    ui.appendDetail(details, '확인 필요', notice.requires_acknowledgement ? '확인이 필요한 공지' : '확인이 필요하지 않은 공지');
    ui.appendDetail(details, '최종 수정일', ui.formatDateTime(notice.updated_at));
    content.append(details);
    if (notice.related_schedule_id) {
      const button = ui.text('button', '관련 일정 보기', 'button button-quiet');
      button.type = 'button';
      button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('taejang-open-schedule', {
        detail: { id: notice.related_schedule_id, fromToday: false }
      })));
      content.append(button);
    }
    if (notice.related_work_guide_id && window.TaejangWorkGuides) {
      const button = ui.text('button', '관련 작업방법 보기', 'button button-quiet');
      button.type = 'button';
      button.addEventListener('click', () => window.TaejangWorkGuides.openDetail(notice.related_work_guide_id, { fromToday: false }));
      content.append(button);
    }
    const link = relatedLink(notice);
    if (link) content.append(link);
    renderAcknowledgement(notice);
  }

  async function openDetail(id, options = {}) {
    fromToday = Boolean(options.fromToday);
    ui.setWorkerScreen('notice-screen');
    ui.element('notice-list-view').hidden = true;
    ui.element('notice-detail-view').hidden = false;
    ui.element('notice-detail-content').replaceChildren();
    ui.element('notice-ack-slot').replaceChildren();
    ui.message('notice-detail-message', '공지 상세를 불러오고 있습니다.');
    try {
      const notice = await window.TaejangApp.rpc('get_my_notice_detail', { p_notice_id: id });
      ui.message('notice-detail-message', '');
      renderDetail(notice);
      ui.element('notice-detail-title').focus?.();
    } catch {
      ui.message('notice-detail-message', '이 공지는 지금 볼 수 없습니다. 담당 반장에게 확인하세요.', true);
    }
  }

  function bind() {
    ui.element('open-notice-list').addEventListener('click', loadList);
    ui.element('notice-back-today').addEventListener('click', showToday);
    ui.element('notice-detail-today').addEventListener('click', showToday);
    ui.element('notice-detail-back').addEventListener('click', () => {
      if (fromToday) showToday();
      else loadList();
    });
    document.addEventListener('taejang-open-notice', event => openDetail(event.detail.id, event.detail));
    document.addEventListener('taejang-notice-acknowledged', () => {
      if (!ui.element('notice-list-view').hidden) loadList();
    });
  }

  document.addEventListener('taejang-app-ready', event => {
    if (event.detail.route === 'general_worker') bind();
  }, { once: true });
})();
