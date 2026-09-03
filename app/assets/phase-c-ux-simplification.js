(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  let desiredMode = null;
  let pendingLeadEdit = null;
  let applying = false;

  function text(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value || '';
    if (className) node.className = className;
    return node;
  }

  function button(label, handler, quiet = false) {
    const node = text('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function loadStyles() {
    if (document.querySelector('style[data-phase-c-ux-simplification]')) return;
    const style = document.createElement('style');
    style.dataset.phaseCUxSimplification = '1';
    style.textContent = `
      [data-pilot-calendar],
      #app-nav [data-phase-c-nav="calendar"],
      #app-nav [data-phase-c-nav="publication"],
      [data-phase-c-publication-dashboard] { display:none !important; }
      .phase-c-edit-page { max-width: 980px; }
      .phase-c-edit-page .promotion-form { max-width: 900px; }
      .phase-c-homepage-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin:0 0 20px; }
      .phase-c-homepage-action { min-height:130px; padding:18px; border:1px solid var(--app-border); border-radius:14px; background:#fff; text-align:left; box-shadow:0 5px 16px rgba(22,53,38,.04); }
      .phase-c-homepage-action strong { display:block; margin-bottom:8px; font-size:1.05rem; }
      @media (max-width:760px) { .phase-c-homepage-actions { grid-template-columns:1fr; } }
    `;
    document.head.append(style);
  }

  function sectionByHeading(heading) {
    return [...(main()?.querySelectorAll('.dashboard-section') || [])]
      .find(section => section.querySelector(':scope > h2')?.textContent.trim() === heading) || null;
  }

  function removeDeferredUi() {
    const target = main();
    const nav = document.getElementById('app-nav');
    if (nav) {
      [...nav.querySelectorAll('button')].forEach(node => {
        const label = node.textContent.trim();
        if (label === '일정 캘린더' || label === '발행 대기') node.remove();
      });
    }
    [...document.querySelectorAll('.quick-links button')].forEach(node => {
      const label = node.textContent.trim();
      if (label === '일정 캘린더' || label.includes('발행 대기')) node.remove();
    });
    target?.querySelectorAll('[data-pilot-calendar],[data-phase-c-publication-dashboard]').forEach(node => node.remove());
    sectionByHeading('홈페이지 발행 대기')?.remove();
  }

  function stripPromotionPhotoSlots() {
    const composer = main()?.querySelector('[data-promotion-composer]');
    if (!composer) return;
    composer.querySelectorAll('.promotion-media-fields').forEach(node => node.remove());
    [...composer.querySelectorAll('label')].forEach(label => {
      const labelText = label.querySelector(':scope > span')?.textContent.trim() || '';
      if (/^PHOTO\s+\d+$/i.test(labelText) || labelText === '최근 활동 대표사진') label.remove();
    });
  }

  function presentationForStaffEdit() {
    if (route() !== 'promotion_staff' || desiredMode !== 'edit') return;
    const target = main();
    const composer = target?.querySelector('[data-promotion-composer]');
    if (!target || !composer) return;
    const composerHeading = composer.querySelector(':scope > h2')?.textContent.trim();
    if (composerHeading !== '콘텐츠 수정·보완') return;

    composer.hidden = false;
    composer.classList.add('phase-c-edit-page');
    sectionByHeading('내가 작성한 콘텐츠')?.setAttribute('hidden', '');
    const intro = target.querySelector(':scope > .dashboard-intro');
    const heading = intro?.querySelector('h2');
    const copy = intro ? [...intro.querySelectorAll(':scope > p')].at(-1) : null;
    if (heading) heading.textContent = '수정·보완';
    if (copy) copy.textContent = '보완 요청을 받은 홍보자료를 수정합니다. 이전 제출본은 보존되고 새 수정본으로 저장됩니다.';
    const top = document.getElementById('desktop-page-title');
    if (top) top.textContent = '홍보 업무';
    stripPromotionPhotoSlots();
  }

  function ensureFreshWrite() {
    if (!['promotion_staff', 'promotion_lead'].includes(route()) || desiredMode !== 'write') return;
    const target = main();
    const composer = target?.querySelector('[data-promotion-composer]');
    const heading = composer?.querySelector(':scope > h2')?.textContent.trim();
    if (heading === '콘텐츠 수정·보완') {
      const cancel = [...composer.querySelectorAll('button')].find(node => node.textContent.trim() === '수정 취소');
      if (cancel && !cancel.dataset.phaseCFreshWriteAuto) {
        cancel.dataset.phaseCFreshWriteAuto = '1';
        cancel.click();
        return;
      }
    }
    stripPromotionPhotoSlots();
  }

  async function beginLeadEdit(card) {
    try {
      const section = card.closest('[data-pilot-review-section]');
      const cards = [...(section?.querySelectorAll('.pilot-review-card') || [])];
      const index = cards.indexOf(card);
      const workspace = await app().rpc('get_my_promotion_workspace');
      const item = Array.isArray(workspace?.review_items) ? workspace.review_items[index] : null;
      if (!item?.content_id) throw new Error('검토할 홍보자료를 찾지 못했습니다.');
      pendingLeadEdit = await app().rpc('get_promotion_review_detail', { p_content_id: item.content_id });
      desiredMode = 'lead-edit';
      document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'lead-edit' } }));
    } catch (error) {
      window.alert(app().friendlyError ? app().friendlyError(error) : error.message);
    }
  }

  function renderLeadEditPage() {
    if (route() !== 'promotion_lead' || desiredMode !== 'lead-edit' || !pendingLeadEdit) return;
    const target = main();
    if (!target || target.querySelector('[data-phase-c-lead-edit-page]')) return;
    if (!target.querySelector('[data-promotion-composer]')) return;

    const detail = pendingLeadEdit;
    const intro = document.createElement('header');
    intro.className = 'dashboard-intro';
    intro.append(
      text('p', '홍보 검토', 'eyebrow'),
      text('h2', '홍보자료 직접 수정'),
      text('p', '선택한 검토 건만 별도 수정 화면에서 편집합니다. 저장하면 기존 제출본을 덮어쓰지 않고 새 검토용 수정본을 만듭니다.')
    );

    const section = document.createElement('section');
    section.className = 'dashboard-section phase-c-edit-page';
    section.dataset.phaseCLeadEditPage = '1';
    section.append(text('h2', detail.title || '홍보자료 수정'));
    const form = document.createElement('form');
    form.className = 'promotion-form';

    const field = (labelText, control) => {
      const label = document.createElement('label');
      label.append(text('span', labelText), control);
      return label;
    };
    const title = document.createElement('input');
    title.value = detail.title || '';
    title.maxLength = 160;
    title.required = true;
    const body = document.createElement('textarea');
    body.rows = 12;
    body.maxLength = 30000;
    body.value = detail.public_body || '';
    const external = document.createElement('input');
    external.type = 'url';
    external.value = detail.external_url || '';
    const date = document.createElement('input');
    date.type = 'date';
    date.value = detail.requested_publish_date || '';

    form.append(field('제목', title), field('본문', body));
    if (detail.content_type === 'external_content') form.append(field('외부 링크', external));
    form.append(field('게시 희망일', date));
    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.append(
      button('수정본 저장', async () => {
        if (!form.reportValidity()) return;
        try {
          await app().rpc('lead_replace_promotion_revision', {
            p_content_id: detail.content_id,
            p_title: title.value.trim(),
            p_public_body: body.value,
            p_external_url: detail.content_type === 'external_content' ? (external.value.trim() || null) : null,
            p_requested_publish_date: date.value || null
          });
          pendingLeadEdit = null;
          desiredMode = 'review';
          document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'review' } }));
        } catch (error) {
          window.alert(app().friendlyError(error));
        }
      }, false),
      button('검토 목록으로 돌아가기', () => {
        pendingLeadEdit = null;
        desiredMode = 'review';
        document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'review' } }));
      }, true)
    );
    form.append(actions);
    section.append(form);
    target.replaceChildren(intro, section);
    const top = document.getElementById('desktop-page-title');
    if (top) top.textContent = '홍보 업무';
  }

  function enhanceHomepageManagement() {
    if (route() !== 'promotion_lead') return;
    const target = main();
    if (!target) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent.trim() || '';
    if (heading !== '글·사진 수정 요청') return;
    const formWrap = target.querySelector('.homepage-change-form-wrap');
    const form = formWrap?.querySelector('form');
    if (!formWrap || !form || target.querySelector('[data-phase-c-homepage-actions]')) return;

    const actions = document.createElement('section');
    actions.className = 'phase-c-homepage-actions';
    actions.dataset.phaseCHomepageActions = '1';
    const kindSelect = [...form.querySelectorAll('select')].find(select =>
      [...select.options].some(option => option.value === 'text') && [...select.options].some(option => option.value === 'image')
    );
    const choose = (kind) => {
      if (!kindSelect) return;
      kindSelect.value = kind;
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const textCard = button('', () => choose('text'), true);
    textCard.className = 'phase-c-homepage-action';
    textCard.append(text('strong', '홈페이지 글 수정'), text('span', '수정할 페이지와 섹션을 고른 뒤 새 문구를 입력합니다.'));
    const photoCard = button('', () => choose('image'), true);
    photoCard.className = 'phase-c-homepage-action';
    photoCard.append(text('strong', '홈페이지 사진 수정'), text('span', '수정할 페이지와 사진 영역을 고른 뒤 변경 요청을 작성합니다.'));
    actions.append(textCard, photoCard);
    formWrap.before(actions);

    const title = formWrap.querySelector(':scope > h2');
    if (title) title.textContent = '홈페이지 글·사진 수정';
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      removeDeferredUi();
      stripPromotionPhotoSlots();
      presentationForStaffEdit();
      ensureFreshWrite();
      renderLeadEditPage();
      enhanceHomepageManagement();
    } finally {
      applying = false;
    }
  }

  loadStyles();

  document.addEventListener('taejang-open-promotion-workspace', event => {
    desiredMode = event.detail?.mode || 'review';
    setTimeout(apply, 80);
  });

  document.addEventListener('taejang-app-ready', () => setTimeout(apply, 220));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(apply, 240));
  document.addEventListener('taejang-open-homepage-content', () => setTimeout(apply, 240));

  document.addEventListener('click', event => {
    const targetButton = event.target.closest('button');
    if (!targetButton) return;
    const label = targetButton.textContent.trim();

    if (route() === 'promotion_lead' && label === '직접 수정' && targetButton.closest('.pilot-review-card')) {
      event.preventDefault();
      event.stopPropagation();
      beginLeadEdit(targetButton.closest('.pilot-review-card'));
      return;
    }

    if (route() === 'promotion_staff' && label === '보완해서 새 수정본 만들기') {
      setTimeout(() => {
        desiredMode = 'edit';
        document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'edit' } }));
      }, 0);
      return;
    }

    if (targetButton.closest('#app-nav') && label === '홍보 작성') {
      desiredMode = 'write';
      setTimeout(apply, 120);
    }

    if (label === '저장 후 다시 승인 요청') desiredMode = 'write';
  }, true);

  const observer = new MutationObserver(() => queueMicrotask(apply));
  const start = () => {
    const target = main();
    if (target) observer.observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
