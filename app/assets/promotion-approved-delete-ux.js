(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const canArchive = () => app()?.hasCapabilityContract?.()
    ? app()?.can?.('promotion.archive') === true
    : ['promotion_lead', 'operations_manager'].includes(route());
  let scheduled = false;
  let leadSyncBusy = false;

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function openPromotionManagement() {
    window.TaejangIssue146?.openPromotionArchive?.();
  }

  async function archiveUnpublished(contentId, title, afterArchive) {
    if (!contentId || !canArchive()) return;
    const reason = window.prompt(`“${title || '홍보글'}” 삭제 이유를 적어주세요.`, '')?.trim();
    if (!reason) return;
    if (!window.confirm('이 미발행 홍보글을 삭제할까요?\n원문과 수정이력은 보존되고 운영총괄이 필요할 때 복구할 수 있습니다.')) return;
    try {
      await app().rpc('archive_unpublished_promotion_content', {
        p_content_id: contentId,
        p_reason: reason
      });
      if (afterArchive) await afterArchive();
    } catch (error) {
      window.alert(app()?.friendlyError?.(error) || error?.message || '홍보글을 삭제하지 못했습니다.');
    }
  }

  function syncNavigation() {
    const currentRoute = route();
    if (!canArchive()) return;
    const nav = document.querySelector('[data-issue146-nav="promotion-archive"]');
    if (!nav) return;

    if (currentRoute === 'promotion_lead') {
      if (!nav.hidden) nav.hidden = true;
      nav.dataset.promotionLeadMergedNav = '1';
      return;
    }

    if (nav.dataset.promotionLeadMergedNav) {
      nav.hidden = false;
      delete nav.dataset.promotionLeadMergedNav;
    }
    setText(nav, '홍보글 관리·복구');
    if (nav.getAttribute('aria-label') !== '홍보글 삭제 보관 및 복구 관리') {
      nav.setAttribute('aria-label', '홍보글 삭제 보관 및 복구 관리');
    }
  }

  function syncReviewEntry() {
    const currentRoute = route();
    if (!canArchive()) return;
    const intro = document.querySelector('#dashboard-main .dashboard-intro');
    if (!intro) return;
    const existing = intro.querySelector('[data-promotion-approved-delete-entry]');

    if (currentRoute === 'promotion_lead') {
      existing?.remove();
      return;
    }

    if (currentRoute !== 'operations_manager' || existing) return;
    const title = document.getElementById('desktop-page-title')?.textContent?.trim();
    if (!['홍보 검토', '홍보 승인 검토', '홍보 업무'].includes(title)) return;

    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.dataset.promotionApprovedDeleteEntry = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = '미발행 글 관리·복구';
    button.addEventListener('click', openPromotionManagement);
    actions.append(button);
    intro.append(actions);
  }

  function lifecycleLabel(value) {
    return ({
      draft: '작성 중',
      review_pending: '승인 대기',
      needs_revision: '보완 필요',
      approved: '승인 완료',
      scheduled: '게시 예정'
    })[value] || value;
  }

  function syncLeadHeading() {
    if (route() !== 'promotion_lead') return;
    const target = document.getElementById('dashboard-main');
    const review = target?.querySelector('[data-pilot-review-section]');
    const intro = target?.querySelector(':scope > .dashboard-intro');
    if (!review || !intro) return;
    const heading = intro.querySelector('h2');
    const copy = [...intro.querySelectorAll(':scope > p')].at(-1);
    setText(heading, '홍보 관리');
    setText(copy, '검토 대기 글의 미리보기·수정·삭제·보완 요청·승인·상신을 한 화면에서 처리합니다.');
  }

  function reviewDeleteButton(item) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'button button-quiet';
    node.textContent = '삭제';
    node.dataset.promotionReviewDelete = '1';
    node.setAttribute('aria-label', `${item.title || '미발행 홍보글'} 삭제`);
    node.title = '원문과 수정이력은 남고 운영총괄이 복구할 수 있습니다.';
    node.addEventListener('click', () => archiveUnpublished(item.content_id, item.title, async () => {
      document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'review' } }));
    }));
    return node;
  }

  function decorateLeadReviewCards(workspace) {
    const section = document.querySelector('#dashboard-main [data-pilot-review-section]');
    if (!section) return;
    const cards = [...section.querySelectorAll(':scope > .pilot-review-card')]
      .filter(card => !card.dataset.promotionApprovedUnpublishedCard);
    const items = Array.isArray(workspace?.review_items) ? workspace.review_items : [];

    cards.forEach((card, index) => {
      if (card.querySelector('[data-promotion-review-delete]')) return;
      const item = items[index];
      if (!item?.content_id) return;
      const actions = card.querySelector('.pilot-review-actions');
      if (!actions) return;
      const remove = reviewDeleteButton(item);
      const edit = [...actions.querySelectorAll('button')].find(button => button.textContent.trim() === '직접 수정');
      if (edit?.nextSibling) actions.insertBefore(remove, edit.nextSibling);
      else actions.append(remove);
    });
  }

  function approvedUnpublishedSignature(items) {
    return items.map(item => [
      item.content_id || '',
      item.lifecycle || '',
      item.title || '',
      item.owner_name || '',
      item.requested_publish_date || ''
    ].join(':')).join('|');
  }

  function renderLeadApprovedUnpublished(candidates, reviewItems) {
    const reviewSection = document.querySelector('#dashboard-main [data-pilot-review-section]');
    if (!reviewSection) return;
    const existing = reviewSection.querySelector('[data-promotion-approved-unpublished-section]');
    const reviewIds = new Set((Array.isArray(reviewItems) ? reviewItems : []).map(item => item.content_id));
    const items = (Array.isArray(candidates) ? candidates : []).filter(item =>
      !reviewIds.has(item.content_id) && ['approved', 'scheduled'].includes(item.lifecycle)
    );

    if (!items.length) {
      existing?.remove();
      return;
    }

    const signature = approvedUnpublishedSignature(items);
    if (existing?.dataset.renderSignature === signature) return;
    existing?.remove();

    const section = document.createElement('div');
    section.dataset.promotionApprovedUnpublishedSection = '1';
    section.dataset.renderSignature = signature;
    section.className = 'dashboard-section';
    const heading = document.createElement('h3');
    heading.textContent = `승인 완료·미발행 글 ${items.length}건`;
    const help = document.createElement('p');
    help.className = 'help';
    help.textContent = '별도 관리 메뉴로 이동하지 않고 여기서 삭제할 수 있습니다. 삭제 후에도 원문·수정이력·감사기록은 보존됩니다.';
    section.append(heading, help);

    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'pilot-review-card';
      card.dataset.promotionApprovedUnpublishedCard = '1';
      const badge = document.createElement('span');
      badge.className = 'status-label';
      badge.textContent = lifecycleLabel(item.lifecycle || 'approved');
      const title = document.createElement('h3');
      title.textContent = item.title || '제목 없음';
      const meta = document.createElement('p');
      meta.className = 'pilot-review-meta';
      meta.textContent = [item.owner_name, item.requested_publish_date ? `게시 예정일 ${item.requested_publish_date}` : null]
        .filter(Boolean).join(' · ');
      const actions = document.createElement('div');
      actions.className = 'pilot-review-actions';
      actions.append(reviewDeleteButton(item));
      card.append(badge, title, meta, actions);
      section.append(card);
    });
    reviewSection.append(section);
  }

  async function syncLeadManagement() {
    if (route() !== 'promotion_lead' || !canArchive() || leadSyncBusy) return;
    const reviewSection = document.querySelector('#dashboard-main [data-pilot-review-section]');
    if (!reviewSection) return;
    leadSyncBusy = true;
    try {
      syncLeadHeading();
      let workspace = null;
      try { workspace = await app().rpc('get_my_promotion_workspace'); } catch { workspace = null; }
      if (workspace) decorateLeadReviewCards(workspace);

      let candidates = [];
      try { candidates = await app().rpc('get_unpublished_promotion_archive_candidates'); } catch { candidates = []; }
      renderLeadApprovedUnpublished(candidates, workspace?.review_items || []);
    } finally {
      leadSyncBusy = false;
    }
  }

  function syncArchiveScreen() {
    const currentRoute = route();
    if (!canArchive()) return;
    const shell = document.querySelector('#dashboard-main .issue146-shell');
    if (!shell) return;

    if (currentRoute === 'promotion_lead') {
      const introHeading = shell.querySelector('.dashboard-intro h2');
      const introCopy = shell.querySelector('.dashboard-intro p:last-child');
      if (introHeading?.textContent.includes('공개 전 글')) setText(introHeading, '승인 완료·공개 전 홍보글을 삭제할 수 있습니다');
      if (introCopy?.textContent.includes('보관')) setText(introCopy, '승인 완료를 포함해 아직 한 번도 공개되지 않은 글은 삭제할 수 있습니다. 원문과 수정이력은 보존되어 운영총괄이 필요할 때 복구할 수 있습니다.');
    }

    shell.querySelectorAll('.issue146-badge').forEach(badge => {
      const value = badge.textContent?.trim();
      const label = value ? lifecycleLabel(value) : '';
      if (label && badge.textContent !== label) badge.textContent = label;
    });

    shell.querySelectorAll('button').forEach(button => {
      if (button.textContent?.trim() !== '보관') return;
      button.textContent = '삭제';
      button.classList.add('button-danger');
      button.dataset.promotionApprovedDelete = '1';
      button.setAttribute('aria-label', '이 미발행 홍보글 삭제');
      button.title = '삭제 후에도 원문과 수정이력은 남아 운영총괄이 복구할 수 있습니다.';
    });
  }

  function sync() {
    syncNavigation();
    syncReviewEntry();
    syncArchiveScreen();
    syncLeadManagement();
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      sync();
    }, 30);
  }

  document.addEventListener('taejang-app-ready', scheduleSync);
  document.addEventListener('taejang-dashboard-refresh', scheduleSync);
  document.addEventListener('taejang-open-promotion-workspace', scheduleSync);

  const start = () => {
    new MutationObserver(scheduleSync).observe(document.documentElement, { childList: true, subtree: true });
    scheduleSync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangPromotionApprovedDeleteUx = { sync, openPromotionManagement };
})();
