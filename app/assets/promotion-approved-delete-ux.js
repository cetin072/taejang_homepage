(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const canArchive = () => app()?.hasCapabilityContract?.()
    ? app()?.can?.('promotion.archive') === true
    : ['promotion_lead', 'operations_manager'].includes(route());
  let scheduled = false;

  function openPromotionManagement() {
    window.TaejangIssue146?.openPromotionArchive?.();
  }

  function syncNavigation() {
    const currentRoute = route();
    if (!canArchive()) return;
    const nav = document.querySelector('[data-issue146-nav="promotion-archive"]');
    if (!nav) return;
    nav.textContent = currentRoute === 'operations_manager' ? '홍보글 관리·복구' : '홍보글 관리';
    nav.setAttribute('aria-label', currentRoute === 'operations_manager' ? '홍보글 삭제 보관 및 복구 관리' : '승인 완료 및 공개 전 홍보글 관리');
  }

  function syncReviewEntry() {
    const currentRoute = route();
    if (!canArchive()) return;
    const title = document.getElementById('desktop-page-title')?.textContent?.trim();
    if (!['홍보 검토', '홍보 승인 검토'].includes(title)) return;
    const intro = document.querySelector('#dashboard-main .dashboard-intro');
    if (!intro || intro.querySelector('[data-promotion-approved-delete-entry]')) return;

    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.dataset.promotionApprovedDeleteEntry = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = currentRoute === 'promotion_lead' ? '승인 완료·미발행 글 관리' : '미발행 글 관리·복구';
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

  function syncArchiveScreen() {
    const currentRoute = route();
    if (!canArchive()) return;
    const shell = document.querySelector('#dashboard-main .issue146-shell');
    if (!shell) return;

    if (currentRoute === 'promotion_lead') {
      const introHeading = shell.querySelector('.dashboard-intro h2');
      const introCopy = shell.querySelector('.dashboard-intro p:last-child');
      if (introHeading?.textContent.includes('공개 전 글')) introHeading.textContent = '승인 완료·공개 전 홍보글을 삭제할 수 있습니다';
      if (introCopy?.textContent.includes('보관')) introCopy.textContent = '승인 완료를 포함해 아직 한 번도 공개되지 않은 글은 삭제할 수 있습니다. 원문과 수정이력은 보존되어 운영총괄이 필요할 때 복구할 수 있습니다.';
    }

    shell.querySelectorAll('.issue146-badge').forEach(badge => {
      const value = badge.textContent?.trim();
      if (value) badge.textContent = lifecycleLabel(value);
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
