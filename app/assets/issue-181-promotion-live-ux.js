(() => {
  'use strict';

  const SOURCE_OPTIONS = [
    ['', '연결 자료를 선택하세요'],
    ['taejang_homepage', '태장 홈페이지'],
    ['taejang_blog', '태장 공식 블로그'],
    ['taejang_youtube', '태장 공식 유튜브'],
    ['external', '외부 기사·자료']
  ];

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  let scheduled = false;
  let leadSyncBusy = false;
  let rpcWrapped = false;

  function isPromotionLead() {
    return route() === 'promotion_lead' && (app()?.can?.('promotion.review_lead') ?? true);
  }

  function kstToday() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const value = key => parts.find(part => part.type === key)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  function suggestSource(urlValue, metadata = null) {
    return window.TaejangOfficialChannels?.classifyUrl?.(urlValue, metadata) || '';
  }

  function sourceSelectorFor(root) {
    return root?.querySelector?.('[data-issue181-link-source]') || null;
  }

  function activeSourceSelector() {
    const selectors = [...document.querySelectorAll('[data-issue181-link-source]')];
    return selectors.find(node => node.closest?.('.phase-c-board-composer'))
      || selectors.find(node => !node.closest?.('[hidden]'))
      || selectors[0]
      || null;
  }

  function activeLinkContext() {
    const selector = activeSourceSelector();
    const root = selector?.closest?.('.phase-c-link-tools') || selector?.closest?.('form') || null;
    const urlInput = root?.querySelector?.('input[type="url"]') || null;
    return { selector, root, urlInput };
  }

  function makeSourceSelector(urlInput) {
    const wrapper = document.createElement('label');
    wrapper.className = 'phase-c-link-source';
    wrapper.dataset.issue181LinkSourceWrap = '1';

    const title = document.createElement('span');
    title.textContent = '연결 자료';
    const select = document.createElement('select');
    select.dataset.issue181LinkSource = '1';
    select.dataset.initialUrl = String(urlInput?.value || '').trim();
    SOURCE_OPTIONS.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    const help = document.createElement('small');
    help.className = 'help';
    help.textContent = '주소를 기준으로 공식 채널 여부를 자동 확인합니다. 자동 확인이 틀린 경우에만 직접 바꾸세요.';

    const applySuggestion = () => {
      if (select.dataset.manual === '1') return;
      select.value = suggestSource(urlInput?.value);
    };
    select.addEventListener('change', () => { select.dataset.manual = '1'; });
    urlInput?.addEventListener('input', applySuggestion);
    wrapper.append(title, select, help);
    applySuggestion();
    return wrapper;
  }

  function enhanceComposerSource() {
    const composer = main()?.querySelector('.phase-c-board-composer');
    const linkTools = composer?.querySelector('.phase-c-link-tools');
    const urlInput = linkTools?.querySelector('input[type="url"]');
    if (!linkTools || !urlInput || sourceSelectorFor(linkTools)) return;
    linkTools.insertBefore(makeSourceSelector(urlInput), linkTools.firstChild);
  }

  function keepComposerLinkIndependent() {
    const composer = main()?.querySelector('.phase-c-board-composer');
    const linkTools = composer?.querySelector('.phase-c-link-tools');
    const urlInput = linkTools?.querySelector('input[type="url"]');
    const source = sourceSelectorFor(linkTools);
    if (!composer || !linkTools || !urlInput || !source) return;

    linkTools.hidden = false;
    const linkLabel = urlInput.closest?.('label')?.querySelector?.('span');
    if (linkLabel) linkLabel.textContent = '연결 링크 (선택)';
    urlInput.placeholder = '태장 홈페이지·블로그·유튜브·외부 기사 주소를 붙여넣으세요';
    const metaButton = [...linkTools.querySelectorAll('button')]
      .find(node => node.textContent.includes('링크'));
    if (metaButton) metaButton.textContent = '링크 정보 가져오기';

    if (linkTools.dataset.issue181TypeDecoupled === '1') return;
    linkTools.dataset.issue181TypeDecoupled = '1';
    const typeSelect = composer.querySelector('.phase-c-board-row select');
    if (!typeSelect) return;

    typeSelect.addEventListener('change', () => {
      const beforeUrl = urlInput.value;
      const beforeSource = source.value;
      setTimeout(() => {
        linkTools.hidden = false;
        if (!urlInput.value && beforeUrl) urlInput.value = beforeUrl;
        if (!source.value && beforeSource) source.value = beforeSource;
      }, 0);
    }, true);
  }

  function enhanceLeadEditSource() {
    if (!isPromotionLead()) return;
    const editPage = main()?.querySelector('.phase-c-edit-page');
    const form = editPage?.querySelector('form');
    const urlInput = form?.querySelector('input[type="url"]');
    if (!form || !urlInput || sourceSelectorFor(form)) return;
    const label = urlInput.closest('label');
    if (label?.nextSibling) form.insertBefore(makeSourceSelector(urlInput), label.nextSibling);
    else form.append(makeSourceSelector(urlInput));
  }

  function protectImportedText() {
    const composer = main()?.querySelector('.phase-c-board-composer');
    const linkTools = composer?.querySelector('.phase-c-link-tools');
    if (!composer || !linkTools) return;
    const metaButton = [...linkTools.querySelectorAll('button')]
      .find(node => node.textContent.includes('링크'));
    if (!metaButton || metaButton.dataset.issue181ImportGuard === '1') return;
    metaButton.dataset.issue181ImportGuard = '1';

    metaButton.addEventListener('click', event => {
      const urlInput = linkTools.querySelector('input[type="url"]');
      const source = sourceSelectorFor(linkTools);
      if (!urlInput?.value.trim()) return;
      if (!source?.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.alert('연결 자료가 무엇인지 먼저 선택해 주세요.');
        return;
      }

      const titleInput = [...composer.querySelectorAll('input')]
        .find(node => !['url', 'date', 'file'].includes(node.type));
      const body = composer.querySelector('textarea');
      const status = linkTools.querySelector('.phase-c-upload-status');
      const previousTitle = titleInput?.value || '';
      const previousBody = body?.value || '';
      const sourceType = source.value;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        if (titleInput && previousTitle.trim()) titleInput.value = previousTitle;
        if (body && previousBody.trim()) body.value = previousBody;
        if (body && sourceType === 'external' && !previousBody.trim()) body.value = '';
        if (status) {
          const fetchFailed = /가져오지 못|실패|확인할 수 없/.test(status.textContent || '');
          if (fetchFailed) {
            status.textContent = `${status.textContent} 자동 가져오기가 안 되면 직접 제목·본문을 입력해 저장할 수 있습니다.`;
          } else if (sourceType === 'external' && !previousBody.trim()) {
            status.textContent = '외부 기사·자료는 원문 전체를 복사하지 않습니다. 제목·썸네일을 참고하고 본문에는 태장 측 소개·요약을 직접 작성해 주세요.';
          } else if (previousTitle.trim() || previousBody.trim()) {
            status.textContent = '링크 정보를 가져왔습니다. 이미 직접 입력한 제목·본문은 그대로 유지했습니다.';
          }
        }
      };

      const observer = new MutationObserver(() => {
        if (!metaButton.disabled) finish();
      });
      observer.observe(metaButton, { attributes: true, attributeFilter: ['disabled'] });
      const timeout = setTimeout(finish, 16000);
    }, true);
  }

  function installRpcSourcePersistence() {
    if (rpcWrapped || !app()?.rpc) return;
    const target = app();
    const original = target.rpc.bind(target);
    target.rpc = async (name, args = {}) => {
      const tracked = name === 'save_promotion_draft'
        || name === 'save_operations_promotion_draft'
        || name === 'lead_replace_promotion_revision';
      if (!tracked) return original(name, args);

      const { selector, urlInput } = activeLinkContext();
      const nextArgs = { ...args };
      let linkedUrl = String(urlInput?.value || nextArgs?.p_external_url || '').trim();

      // The live composer always exposes its URL input. An empty visible input
      // therefore means the user intentionally removed the link. Only the lead
      // direct-edit legacy path can omit the URL control for non-external posts;
      // preserve the existing link in that hidden-field compatibility case.
      if (!linkedUrl && !urlInput && nextArgs?.p_content_id) {
        try {
          const detail = await original('get_promotion_review_detail', { p_content_id: nextArgs.p_content_id });
          linkedUrl = String(detail?.external_url || '').trim();
        } catch {
          // Preserve the original RPC behavior if optional detail lookup is unavailable.
        }
      }

      if (linkedUrl) {
        nextArgs.p_external_url = linkedUrl;
        if (name !== 'lead_replace_promotion_revision') nextArgs.p_source_reference_url = linkedUrl;
      }

      let sourceType = linkedUrl ? (selector?.value || '') : 'none';
      const sourceWasManuallyChosen = selector?.dataset?.manual === '1';
      const sourceInitialUrl = String(selector?.dataset?.initialUrl || '').trim();
      if (linkedUrl && selector && nextArgs?.p_content_id && !sourceWasManuallyChosen && linkedUrl === sourceInitialUrl) {
        try {
          const storedSource = String(await original('get_promotion_link_source', { p_content_id: nextArgs.p_content_id }) || '').trim();
          if (storedSource && storedSource !== 'none') sourceType = storedSource;
        } catch {
          // Existing source metadata is optional for old rows created before #181.
        }
      }
      if (linkedUrl && selector && !sourceType) throw new Error('연결 자료가 무엇인지 선택해 주세요.');

      const result = await original(name, nextArgs);
      const contentId = nextArgs?.p_content_id || result?.content_id;
      if (contentId && selector) {
        await original('set_promotion_link_source', {
          p_content_id: contentId,
          p_link_source_type: sourceType
        });
      }
      return result;
    };
    rpcWrapped = true;
  }

  async function archiveReviewItem(item) {
    const reason = window.prompt(`“${item.title || '홍보글'}” 삭제 이유를 적어주세요.`, '')?.trim();
    if (!reason) return;
    if (!window.confirm('이 미발행 홍보글을 삭제할까요? 원문·수정이력·감사기록은 보존됩니다.')) return;
    try {
      await app().rpc('archive_unpublished_promotion_content', {
        p_content_id: item.content_id,
        p_reason: reason
      });
      await window.TaejangPromotionWorkspaceV2Api?.openPromotion?.('review');
    } catch (error) {
      const code = String(error?.message || error?.code || '');
      const upperReviewLocked = code.includes('PROMOTION_UNPUBLISHED_ARCHIVE_UPPER_REVIEW_LOCKED');
      window.alert(upperReviewLocked
        ? '운영총괄 또는 대표이사 결재선에 올라간 글은 운영팀장이 삭제할 수 없습니다. 수정·보완 후 다시 상신해 주세요.'
        : (app()?.friendlyError?.(error) || error?.message || '홍보글을 삭제하지 못했습니다.'));
    }
  }

  function requestedDateFromCard(card) {
    const text = [...card.querySelectorAll('p')]
      .map(node => node.textContent || '')
      .find(value => value.trim().startsWith('게시 희망일 '));
    return text ? text.trim().replace(/^게시 희망일\s+/, '') : '';
  }

  function decorateApproval(actions, item, card) {
    const approve = [...actions.querySelectorAll('button')]
      .find(node => /^승인(?:$|·)/.test(node.textContent.trim()));
    if (!approve) return;
    const requestedDate = requestedDateFromCard(card);
    const finalAtLead = item.required_stage === 'lead';
    if (finalAtLead) {
      approve.textContent = requestedDate && requestedDate > kstToday() ? '승인·예약' : '승인·공개';
    } else {
      approve.textContent = '승인·다음 검토';
    }
    if (approve.dataset.issue181ConfirmBound === '1') return;
    approve.dataset.issue181ConfirmBound = '1';
    approve.addEventListener('click', event => {
      const label = approve.textContent.trim();
      let message = '';
      if (label === '승인·공개') message = '승인하면 홈페이지에 즉시 공개됩니다. 계속할까요?';
      if (label === '승인·예약') message = `${requestedDate} 00:00(한국시간)에 공개 예약됩니다. 계속할까요?`;
      if (message && !window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function addManagementShortcuts(intro) {
    if (intro.querySelector('[data-issue181-management-shortcuts]')) return;
    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.dataset.issue181ManagementShortcuts = '1';

    const published = document.createElement('button');
    published.type = 'button';
    published.className = 'button button-quiet';
    published.textContent = '공개글 관리';
    published.addEventListener('click', () => document.querySelector('[data-phase-c-publication-admin]')?.click());

    const unpublished = document.createElement('button');
    unpublished.type = 'button';
    unpublished.className = 'button button-quiet';
    unpublished.textContent = '미발행 글 정리';
    unpublished.addEventListener('click', () => document.querySelector('[data-issue146-nav="promotion-archive"]')?.click());

    actions.append(published, unpublished);
    intro.append(actions);
  }

  function syncLeadNavigation() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    const published = nav.querySelector('[data-phase-c-publication-admin]');
    const unpublished = nav.querySelector('[data-issue146-nav="promotion-archive"]');
    if (isPromotionLead()) {
      if (published) { published.hidden = true; published.dataset.issue181MergedHidden = '1'; }
      if (unpublished) { unpublished.hidden = true; unpublished.dataset.issue181MergedHidden = '1'; }
    } else {
      [published, unpublished].forEach(node => {
        if (node?.dataset.issue181MergedHidden) {
          node.hidden = false;
          delete node.dataset.issue181MergedHidden;
        }
      });
    }
  }

  async function syncLeadReview() {
    if (!isPromotionLead() || leadSyncBusy) return;
    const target = main();
    const topTitle = document.getElementById('desktop-page-title');
    if (!target || !['홍보 검토', '홍보 관리'].includes(topTitle?.textContent?.trim())) return;
    const intro = target.querySelector(':scope > .dashboard-intro');
    const grid = target.querySelector(':scope > .phase-c-v2-grid');
    if (!intro || !grid) return;

    leadSyncBusy = true;
    try {
      topTitle.textContent = '홍보 관리';
      const heading = intro.querySelector('h2');
      const copy = [...intro.querySelectorAll(':scope > p')].at(-1);
      if (heading) heading.textContent = '홍보 관리';
      if (copy) copy.textContent = '검토 대기 글의 미리보기·수정·보완 요청·승인·상신을 처리합니다. 상위 결재선에서 돌아온 글은 삭제할 수 없습니다.';
      addManagementShortcuts(intro);

      const workspace = await app().rpc('get_my_promotion_workspace');
      const items = Array.isArray(workspace?.review_items) ? workspace.review_items : [];
      const cards = [...grid.children].filter(node => node.matches?.('.phase-c-v2-card'));
      if (cards.length !== items.length) return;

      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        const item = items[index];
        const title = card.querySelector('h3')?.textContent?.trim() || '';
        if (!item?.content_id || title !== String(item.title || '').trim()) continue;
        const actions = card.querySelector('.quick-links');
        if (!actions) continue;

        let handoff = null;
        try { handoff = await app().rpc('get_promotion_review_handoff', { p_content_id: item.content_id }); }
        catch { handoff = null; }

        const existingDelete = actions.querySelector('[data-issue181-review-delete]');
        if (handoff) {
          existingDelete?.remove();
        } else if (!existingDelete) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'button button-quiet';
          remove.textContent = '삭제';
          remove.dataset.issue181ReviewDelete = '1';
          remove.title = '복구 가능한 삭제입니다. 상위 결재선에 올라간 글은 삭제할 수 없습니다.';
          remove.addEventListener('click', () => archiveReviewItem(item));
          const edit = [...actions.querySelectorAll('button')].find(node => node.textContent.trim() === '직접 수정');
          if (edit?.nextSibling) actions.insertBefore(remove, edit.nextSibling);
          else actions.append(remove);
        }
        decorateApproval(actions, item, card);
      }
    } catch {
      // Existing safe fallback menus remain in the DOM even if enhancement fails.
    } finally {
      leadSyncBusy = false;
    }
  }

  function sync() {
    installRpcSourcePersistence();
    enhanceComposerSource();
    keepComposerLinkIndependent();
    enhanceLeadEditSource();
    protectImportedText();
    syncLeadNavigation();
    syncLeadReview();
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      sync();
    }, 40);
  }

  document.addEventListener('taejang-app-ready', scheduleSync);
  document.addEventListener('taejang-dashboard-refresh', scheduleSync);
  document.addEventListener('taejang-open-promotion-workspace', scheduleSync);
  document.addEventListener('taejang-external-meta-observed', scheduleSync);

  const start = () => {
    const shell = document.getElementById('desktop-app-shell') || document.documentElement;
    new MutationObserver(scheduleSync).observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    scheduleSync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangIssue181PromotionLiveUx = {
    sync,
    suggestSource,
    sourceOptions: SOURCE_OPTIONS.map(([value, label]) => ({ value, label }))
  };
})();