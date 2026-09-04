(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  let scheduled = false;

  function labelForControl(id) {
    return byId(id)?.closest?.('label') || null;
  }

  function simplifyNoticeForm() {
    const form = byId('notice-form');
    if (!form || form.dataset.progressiveDisclosure) return false;
    form.dataset.progressiveDisclosure = '1';

    const panel = byId('notice-admin-panel');
    const help = panel?.querySelector('.easy-writing-help');
    if (help) help.textContent = '제목·중요도·게시 시작·대상·내용만 먼저 적으세요. 장소·적용기간·준비물·관련 링크는 필요할 때 상세 설정에서 추가하세요.';

    const advancedIds = [
      'notice-publish-end-date', 'notice-publish-end-time',
      'notice-effective-start', 'notice-effective-end',
      'notice-location', 'notice-related-schedule', 'notice-related-guide',
      'notice-requires-ack', 'notice-materials',
      'notice-link-label', 'notice-link-url', 'notice-reason'
    ];

    const details = document.createElement('details');
    details.className = 'notice-advanced-settings';
    details.dataset.noticeAdvancedSettings = '1';
    const summary = document.createElement('summary');
    summary.textContent = '상세 설정 · 필요할 때만';
    const note = document.createElement('p');
    note.className = 'help';
    note.textContent = '게시 종료, 적용기간, 장소, 준비물, 관련 일정·작업방법, 링크와 확인 요청을 추가할 수 있습니다.';
    const grid = document.createElement('div');
    grid.className = 'form-grid notice-advanced-grid';

    advancedIds.forEach(id => {
      const label = labelForControl(id);
      if (label) grid.append(label);
    });
    details.append(summary, note, grid);

    const actions = form.querySelector('.form-actions');
    if (actions) form.insertBefore(details, actions);
    else form.append(details);

    const seedReason = () => {
      const reason = byId('notice-reason');
      if (!reason || reason.value.trim()) return;
      reason.value = '공지 작성·수정';
      reason.defaultValue = '공지 작성·수정';
    };
    seedReason();
    form.addEventListener('reset', () => setTimeout(seedReason, 0));
    byId('reset-notice-form')?.addEventListener('click', () => setTimeout(seedReason, 0));
    form.addEventListener('submit', seedReason, true);
    return true;
  }

  function injectStyles() {
    if (document.querySelector('style[data-followup-ux]')) return;
    const style = document.createElement('style');
    style.dataset.followupUx = '1';
    style.textContent = `
      .employee-view-tabs { display:none !important; }
      .notice-advanced-settings { margin-top:14px; border:1px solid var(--app-border); border-radius:12px; background:#f7f9f7; }
      .notice-advanced-settings > summary { min-height:48px; display:flex; align-items:center; padding:10px 14px; color:var(--app-brand); font-weight:850; cursor:pointer; }
      .notice-advanced-settings > .help { margin:0; padding:0 14px 8px; }
      .notice-advanced-grid { padding:0 14px 14px; }
      @media(max-width:760px){.notice-advanced-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function apply() {
    scheduled = false;
    injectStyles();
    simplifyNoticeForm();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 0);
  }

  document.addEventListener('taejang-app-ready', scheduleApply);
  document.addEventListener('taejang-open-app-panel', event => {
    if (event.detail?.id === 'notice-admin-panel') scheduleApply();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleApply, { once: true });
  else scheduleApply();
})();
