(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  let scheduled = false;
  let importedImageGuardBound = false;
  let importedImageRpcWrapped = false;
  const brokenImportedImages = new Set();

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

  function effectiveRoles() {
    const roles = app()?.getEffectiveRoles?.();
    if (Array.isArray(roles)) return new Set(roles);
    return new Set((app()?.getContext?.()?.roles || []).map(item => item?.code).filter(Boolean));
  }

  function hideRoutineSupportRadarMenus() {
    if (window.TaejangSupportRadarAccess?.canManagementView?.()) return;
    const roles = effectiveRoles();
    if (!roles.has('promotion_staff') && !roles.has('office_staff')) return;
    document.querySelectorAll('[data-support-my-work-nav], [data-support-radar-nav-group]').forEach(node => {
      node.hidden = true;
      node.dataset.issue187RoutineHidden = '1';
    });
    document.querySelectorAll('[data-support-radar-shortcut]').forEach(node => node.remove());
  }

  function makePromotionNavButton(label, mode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.issue187PromotionNav = mode;
    button.addEventListener('click', () => window.TaejangPromotionWorkspaceV2Api?.openPromotion?.(mode));
    return button;
  }

  function ensurePromotionStaffNavigation() {
    if (route() !== 'promotion_staff') return;
    const nav = byId('app-nav');
    if (!nav || !window.TaejangPromotionWorkspaceV2Api?.openPromotion) return;

    const children = [...nav.children];
    const labelOf = node => (node.textContent || '').replace(/\s*·\s*점검중\s*$/, '').trim();
    const dashboard = children.find(node => labelOf(node) === '대시보드');
    let write = nav.querySelector('[data-phase-c-v2-nav="write"], [data-issue187-promotion-nav="write"]');
    let revision = nav.querySelector('[data-phase-c-v2-nav="revision"], [data-issue187-promotion-nav="revision"]');

    if (!write) write = makePromotionNavButton('홍보 작성', 'write');
    if (!revision) revision = makePromotionNavButton('수정·보완 요청', 'revision');
    write.hidden = false;
    revision.hidden = false;

    if (dashboard?.parentNode === nav) {
      nav.insertBefore(write, dashboard.nextSibling);
      nav.insertBefore(revision, write.nextSibling);
    } else {
      nav.prepend(revision);
      nav.prepend(write);
    }

    const notice = [...nav.children].find(node => labelOf(node) === '공지 확인');
    if (notice) notice.hidden = false;
  }

  function dashboardCard(title, body, actionLabel, mode) {
    const card = document.createElement('article');
    card.className = 'dashboard-card';
    card.dataset.issue187PromotionCard = mode;
    const status = document.createElement('span');
    status.className = 'status-label';
    status.textContent = '바로가기';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = body;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = actionLabel;
    button.addEventListener('click', () => window.TaejangPromotionWorkspaceV2Api?.openPromotion?.(mode));
    card.append(status, heading, copy, button);
    return card;
  }

  function ensurePromotionStaffDashboard() {
    if (route() !== 'promotion_staff') return;
    const main = byId('dashboard-main');
    const grid = main?.querySelector('.dashboard-grid');
    const heading = main?.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!grid || !heading.includes('대시보드')) return;

    const findCard = title => [...grid.querySelectorAll('.dashboard-card')]
      .find(node => node.querySelector('h3')?.textContent?.trim() === title);

    let revision = findCard('수정·보완 요청');
    if (!revision) {
      revision = dashboardCard('수정·보완 요청', '보완 요청으로 돌아온 글을 확인하고 수정한 뒤 다시 승인 요청합니다.', '보완 글 확인', 'revision');
      grid.prepend(revision);
    }
    revision.hidden = false;

    let write = findCard('홍보자료 작성');
    if (!write) {
      write = dashboardCard('홍보자료 작성', '새 홍보자료를 작성해 운영팀장에게 승인 요청합니다.', '새 글 작성', 'write');
      if (revision.nextSibling) grid.insertBefore(write, revision.nextSibling);
      else grid.append(write);
    }
    write.hidden = false;

    const importantNotice = findCard('중요공지');
    if (importantNotice) importantNotice.hidden = false;
  }

  function polishPromotionComposer() {
    const composer = byId('dashboard-main')?.querySelector('.phase-c-board-composer');
    if (!composer) return;

    const heading = composer.querySelector('h2')?.textContent?.trim() || '';
    const topRow = composer.querySelector('.phase-c-board-row');
    const type = topRow?.querySelector('select');
    if (type && heading === '새 홍보자료 작성') {
      type.querySelector('option[value="external_content"]')?.remove();
      if (type.value === 'external_content') type.value = 'homepage_article';
    }

    if (topRow && !composer.querySelector('[data-issue187-type-help]')) {
      const help = document.createElement('p');
      help.className = 'help';
      help.dataset.issue187TypeHelp = '1';
      help.textContent = '태장 소식은 홈페이지에 올리는 일반 소식이고, 보도자료는 언론에 배포할 공식 문안입니다. 외부 기사 링크 여부는 아래 연결 자료에서 따로 구분합니다.';
      topRow.insertAdjacentElement('afterend', help);
    }

    const source = composer.querySelector('[data-issue181-link-source]');
    if (!source) return;
    const label = source.closest('label');
    const labelText = label?.querySelector(':scope > span');
    const sourceHelp = label?.querySelector('small.help');
    const emptyOption = source.querySelector('option[value=""]');
    if (labelText) labelText.textContent = '연결 자료 (자동 분류)';
    if (sourceHelp) sourceHelp.textContent = '링크를 붙이면 종류를 자동으로 확인합니다. 자동 분류가 다를 때만 직접 바꾸면 됩니다.';
    if (emptyOption) emptyOption.textContent = '링크를 붙이면 자동으로 확인합니다';

    const linkTools = source.closest('.phase-c-link-tools');
    const urlInput = linkTools?.querySelector('input[type="url"]');
    if (urlInput && urlInput.dataset.issue187AutoSource !== '1') {
      urlInput.dataset.issue187AutoSource = '1';
      const classify = () => {
        if (!urlInput.value.trim() || source.dataset.manual === '1') return;
        const suggested = window.TaejangIssue181PromotionLiveUx?.suggestSource?.(urlInput.value.trim());
        source.value = suggested || 'external';
      };
      urlInput.addEventListener('input', classify);
      urlInput.addEventListener('blur', classify);
      classify();
    }
  }

  function bindImportedImageErrorGuard() {
    if (importedImageGuardBound) return;
    importedImageGuardBound = true;
    document.addEventListener('error', event => {
      const image = event.target;
      if (!image?.matches?.('.phase-c-link-preview img')) return;
      const failedUrl = String(image.currentSrc || image.src || '').trim();
      if (failedUrl) brokenImportedImages.add(failedUrl);
      const preview = image.closest('.phase-c-link-preview');
      image.remove();
      if (!preview || preview.querySelector('[data-issue187-image-fallback]')) return;
      const note = document.createElement('p');
      note.className = 'help';
      note.dataset.issue187ImageFallback = '1';
      note.textContent = '원문 사이트가 썸네일 직접 표시를 막아 사진은 가져오지 못했습니다. 필요한 사진은 아래 사진 추가로 직접 올려주세요.';
      preview.prepend(note);
    }, true);
  }

  function installImportedImageSaveGuard() {
    if (importedImageRpcWrapped || !app()?.rpc) return;
    const target = app();
    const original = target.rpc.bind(target);
    target.rpc = async (name, args = {}) => {
      const tracked = name === 'save_promotion_draft'
        || name === 'save_operations_promotion_draft'
        || name === 'lead_replace_promotion_revision';
      if (!tracked || !args?.p_hero_image_url) return original(name, args);
      const hero = String(args.p_hero_image_url).trim();
      if (!brokenImportedImages.has(hero)) return original(name, args);
      return original(name, { ...args, p_hero_image_url: null });
    };
    importedImageRpcWrapped = true;
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
      [data-issue187-routine-hidden] { display:none !important; }
      @media(max-width:760px){.notice-advanced-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function apply() {
    scheduled = false;
    injectStyles();
    simplifyNoticeForm();
    bindImportedImageErrorGuard();
    installImportedImageSaveGuard();
    hideRoutineSupportRadarMenus();
    ensurePromotionStaffNavigation();
    ensurePromotionStaffDashboard();
    polishPromotionComposer();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 0);
  }

  function scheduleAfterWorkNavigation() {
    setTimeout(scheduleApply, 220);
  }

  document.addEventListener('taejang-app-ready', scheduleApply);
  document.addEventListener('taejang-dashboard-refresh', scheduleApply);
  document.addEventListener('taejang-open-app-panel', event => {
    if (event.detail?.id === 'notice-admin-panel') scheduleApply();
  });
  document.addEventListener('taejang-open-promotion-workspace', scheduleAfterWorkNavigation);
  document.addEventListener('click', event => {
    const target = event.target?.closest?.('[data-phase-c-v2-nav], [data-issue187-promotion-nav], .dashboard-card button');
    if (target) scheduleAfterWorkNavigation();
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleApply, { once: true });
  else scheduleApply();
})();