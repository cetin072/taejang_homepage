(() => {
  'use strict';

  const TEXT_SLOTS = [
    ['home.hero.title', '첫 화면 큰 제목'],
    ['home.hero.intro', '첫 화면 소개 문장'],
    ['home.about.title', '태장 소개 제목'],
    ['home.about.intro', '태장 소개 문장'],
    ['home.business.title', '하는 일 제목'],
    ['home.business.intro', '하는 일 소개 문장'],
    ['home.workplace.title', '일터 제목'],
    ['home.workplace.intro', '일터 소개 문장'],
    ['home.partnership.title', '협력 안내 제목'],
    ['home.partnership.intro', '협력 안내 문장'],
    ['home.contact.title', '문의 제목'],
    ['home.contact.intro', '문의 소개 문장']
  ];
  const LINK_SLOTS = [
    ['home.hero.primary_link', '첫 화면 · 태장 알아보기 버튼'],
    ['home.hero.secondary_link', '첫 화면 · 협력·문의 버튼'],
    ['home.about.link', '태장 소개 · 자세히 보기'],
    ['home.business.link', '하는 일 · 전체보기'],
    ['home.workplace.link', '일터 · 더보기'],
    ['home.partnership.link', '협력 · 자세히 보기']
  ];
  const IMAGE_SLOTS = [
    ['home.photo.02', 'PHOTO 02 · 민화 작업'],
    ['home.photo.03', 'PHOTO 03 · 지역 환경정비'],
    ['home.photo.04', 'PHOTO 04 · 일터 큰 사진'],
    ['home.photo.05', 'PHOTO 05 · 일터 보조 사진 1'],
    ['home.photo.06', 'PHOTO 06 · 일터 보조 사진 2']
  ];

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  const button = (label, handler, quiet = false) => {
    const node = el('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  const input = (type = 'text') => {
    const node = document.createElement('input');
    node.type = type;
    return node;
  };
  const field = (label, control, help = '') => {
    const wrap = document.createElement('label');
    wrap.append(el('span', label));
    if (help) wrap.append(el('small', help, 'field-help'));
    wrap.append(control);
    return wrap;
  };
  const select = options => {
    const node = document.createElement('select');
    options.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      node.append(option);
    });
    return node;
  };

  function injectStyles() {
    if (document.querySelector('style[data-operations-homepage-direct]')) return;
    const style = document.createElement('style');
    style.dataset.operationsHomepageDirect = '1';
    style.textContent = `
      .operations-homepage-entry { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin:20px 0; }
      .operations-homepage-entry button { min-height:120px; padding:20px; border:1px solid var(--app-border); border-radius:16px; background:#fff; text-align:left; cursor:pointer; }
      .operations-homepage-entry strong { display:block; margin-bottom:8px; font-size:1.15rem; }
      .operations-homepage-form { max-width:900px; padding:22px; border:1px solid var(--app-border); border-radius:16px; background:#fff; }
      .operations-homepage-form form { display:grid; gap:16px; }
      .operations-homepage-form label { display:grid; gap:7px; font-weight:800; }
      .operations-homepage-form input,.operations-homepage-form select,.operations-homepage-form textarea { width:100%; min-height:46px; padding:11px 12px; border:1px solid var(--app-border); border-radius:10px; background:#fff; color:var(--app-text); font:inherit; }
      .operations-homepage-form textarea { min-height:150px; resize:vertical; line-height:1.65; }
      .operations-homepage-preview { display:grid; gap:10px; padding:14px; border:1px solid var(--app-border); border-radius:12px; background:#f8faf9; }
      .operations-homepage-preview img { width:min(100%,520px); max-height:340px; object-fit:cover; border-radius:10px; }
      .operations-homepage-meta { margin:0; color:var(--app-muted); font-size:.9rem; line-height:1.5; }
      @media(max-width:760px){.operations-homepage-entry{grid-template-columns:1fr}.operations-homepage-entry button{min-height:88px}}
    `;
    document.head.append(style);
  }

  function prepareWorkspace() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
    for (const id of ['today-admin-panel', 'schedule-admin-panel', 'notice-admin-panel', 'guidance-admin-panel']) {
      const panel = document.getElementById(id);
      if (panel) panel.hidden = true;
    }
    const target = main();
    if (target) target.hidden = false;
    return target;
  }

  function formatUpdated(item) {
    if (!item?.updated_at) return '';
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul'
      }).format(new Date(item.updated_at));
    } catch { return ''; }
  }

  async function loadOverrides() {
    const rows = await app().rpc('get_homepage_live_overrides_admin');
    return new Map((Array.isArray(rows) ? rows : []).map(item => [item.slot_key, item]));
  }

  async function resetSlot(slotKey) {
    if (!window.confirm('이 직접 수정을 해제하고 코드에 있는 기본 홈페이지 내용으로 되돌릴까요?')) return false;
    await app().rpc('delete_homepage_live_override', { p_slot_key: slotKey });
    return true;
  }

  function statusBox(current) {
    const box = el('div', null, 'operations-homepage-preview');
    if (!current) {
      box.append(el('p', '현재 직접 수정값이 없습니다. 기본 홈페이지 내용이 표시됩니다.', 'operations-homepage-meta'));
      return box;
    }
    box.append(el('strong', '현재 직접 적용 중'));
    box.append(el('p', `${current.updated_by || '운영총괄'} · ${formatUpdated(current)}`, 'operations-homepage-meta'));
    return box;
  }

  async function renderEditor(kind) {
    const target = prepareWorkspace();
    if (!target || route() !== 'operations_manager') return;
    document.getElementById('desktop-page-title').textContent = '홈페이지 직접 수정';
    target.replaceChildren(el('p', '현재 홈페이지 설정을 확인하고 있습니다.', 'message'));
    try {
      const overrides = await loadOverrides();
      const options = kind === 'text' ? TEXT_SLOTS : kind === 'link' ? LINK_SLOTS : IMAGE_SLOTS;
      const title = kind === 'text' ? '메인 글 직접 수정' : kind === 'link' ? '메인 링크 직접 수정' : '메인 사진 직접 수정';
      const intro = el('header', null, 'dashboard-intro');
      intro.append(el('p', '운영총괄 전용', 'eyebrow'), el('h2', title), el('p', '저장하면 승인 절차 없이 홈페이지에 바로 반영됩니다. 변경이력은 감사로그에 남고 언제든 기본값으로 되돌릴 수 있습니다.'));
      const formWrap = el('section', null, 'operations-homepage-form');
      const form = document.createElement('form');
      form.addEventListener('submit', event => event.preventDefault());
      const slot = select(options);
      const currentBox = el('div');
      const actions = el('div', null, 'quick-links');
      let textValue = null;
      let linkLabel = null;
      let linkUrl = null;
      let imageAlt = null;
      let uploadedUrl = null;
      let imageStatus = null;
      let imagePreview = null;

      function current() { return overrides.get(slot.value) || null; }
      function updateCurrent() {
        const item = current();
        currentBox.replaceChildren(statusBox(item));
        actions.replaceChildren();
        actions.append(button('메인 홈페이지에서 확인', () => window.open('../index.html', '_blank', 'noopener')));
        if (item) actions.append(button('기본값으로 되돌리기', async () => {
          try {
            if (await resetSlot(slot.value)) await renderEditor(kind);
          } catch (error) { window.alert(app().friendlyError?.(error) || '기본값으로 되돌리지 못했습니다.'); }
        }, true));
        if (kind === 'text') textValue.value = item?.text_value || '';
        if (kind === 'link') {
          linkLabel.value = item?.link_label || '';
          linkUrl.value = item?.link_url || '';
        }
        if (kind === 'image') {
          imageAlt.value = item?.image_alt || '';
          uploadedUrl = item?.image_url || null;
          imagePreview.replaceChildren();
          if (uploadedUrl) {
            const image = document.createElement('img'); image.src = uploadedUrl; image.alt = imageAlt.value || '현재 홈페이지 사진';
            imagePreview.append(image);
          }
          imageStatus.textContent = uploadedUrl ? '현재 직접 적용 중인 사진입니다. 새 파일을 고르면 교체됩니다.' : '새 사진 파일을 선택해 주세요.';
        }
      }

      form.append(field('수정할 위치', slot, '정해진 메인 페이지 영역만 수정할 수 있습니다.'));
      if (kind === 'text') {
        textValue = document.createElement('textarea');
        textValue.maxLength = 4000;
        textValue.placeholder = '바꿀 글을 입력하세요. 줄바꿈도 사용할 수 있습니다.';
        form.append(field('새 글', textValue));
      } else if (kind === 'link') {
        linkLabel = input(); linkLabel.maxLength = 120; linkLabel.placeholder = '버튼에 보일 글자';
        linkUrl = input('text'); linkUrl.maxLength = 2000; linkUrl.placeholder = '/about.html 또는 https://...';
        form.append(field('버튼 글자', linkLabel), field('이동 주소', linkUrl, '태장 내부 주소는 /about.html처럼, 외부 주소는 https://로 입력합니다.'));
      } else {
        const file = input('file'); file.accept = 'image/jpeg,image/png,image/webp,image/gif';
        imageAlt = input(); imageAlt.maxLength = 300; imageAlt.placeholder = '사진에 무엇이 보이는지 짧게 설명';
        imageStatus = el('p', '', 'operations-homepage-meta');
        imagePreview = el('div', null, 'operations-homepage-preview');
        file.addEventListener('change', async () => {
          const selected = file.files?.[0];
          if (!selected) return;
          file.disabled = true;
          imageStatus.textContent = '사진을 업로드하고 있습니다.';
          try {
            const uploader = window.TaejangPromotionWorkspaceV2Api?.uploadImage;
            if (!uploader) throw new Error('사진 업로드 기능을 불러오지 못했습니다.');
            uploadedUrl = await uploader(selected);
            if (!imageAlt.value.trim()) imageAlt.value = selected.name.replace(/\.[^.]+$/, '');
            const image = document.createElement('img'); image.src = uploadedUrl; image.alt = imageAlt.value || '변경할 사진';
            imagePreview.replaceChildren(image);
            imageStatus.textContent = '업로드 완료 · 저장하면 홈페이지에 바로 반영됩니다.';
          } catch (error) {
            uploadedUrl = null;
            imageStatus.textContent = '사진 업로드에 실패했습니다.';
            window.alert(error.message || '사진을 업로드하지 못했습니다.');
          } finally { file.disabled = false; file.value = ''; }
        });
        form.append(field('새 사진', file, 'JPG, PNG, WEBP, GIF · 8MB 이하'), field('사진 설명', imageAlt, '접근성을 위해 사진 설명은 필수입니다.'), imageStatus, imagePreview);
      }

      const save = button('홈페이지에 바로 반영', async () => {
        if (!window.confirm('이 변경을 홈페이지에 바로 반영할까요?')) return;
        try {
          save.disabled = true;
          const payload = {
            p_slot_key: slot.value,
            p_text_value: kind === 'text' ? textValue.value.trim() : null,
            p_link_label: kind === 'link' ? linkLabel.value.trim() : null,
            p_link_url: kind === 'link' ? linkUrl.value.trim() : null,
            p_image_url: kind === 'image' ? uploadedUrl : null,
            p_image_alt: kind === 'image' ? imageAlt.value.trim() : null
          };
          if (kind === 'text' && !payload.p_text_value) return window.alert('새 글을 입력해 주세요.');
          if (kind === 'link' && (!payload.p_link_label || !payload.p_link_url)) return window.alert('버튼 글자와 이동 주소를 모두 입력해 주세요.');
          if (kind === 'image' && (!payload.p_image_url || !payload.p_image_alt)) return window.alert('새 사진과 사진 설명을 모두 준비해 주세요.');
          await app().rpc('save_homepage_live_override', payload);
          await renderEditor(kind);
        } catch (error) {
          window.alert(app().friendlyError?.(error) || error.message || '홈페이지에 반영하지 못했습니다.');
        } finally { save.disabled = false; }
      });
      form.append(save, currentBox, actions);
      slot.addEventListener('change', updateCurrent);
      formWrap.append(form);
      target.replaceChildren(intro, formWrap);
      updateCurrent();
    } catch (error) {
      target.replaceChildren(el('p', app().friendlyError?.(error) || '홈페이지 설정을 불러오지 못했습니다.', 'message error'));
    }
  }

  function openWorkspace() {
    const target = prepareWorkspace();
    if (!target || route() !== 'operations_manager') return;
    document.getElementById('desktop-page-title').textContent = '홈페이지 직접 수정';
    const intro = el('header', null, 'dashboard-intro');
    intro.append(el('p', '운영총괄 전용', 'eyebrow'), el('h2', '홈페이지 직접 수정'), el('p', '주업무는 아니므로 사이드바에서 필요할 때만 사용합니다. 글·링크·메인 사진을 정해진 영역 안에서 직접 바꿀 수 있습니다.'));
    const entry = el('div', null, 'operations-homepage-entry');
    const textButton = el('button'); textButton.type = 'button'; textButton.append(el('strong', '메인 글 수정'), el('span', '메인 페이지의 제목과 소개 문장을 직접 바꿉니다.'));
    const linkButton = el('button'); linkButton.type = 'button'; linkButton.append(el('strong', '메인 링크 수정'), el('span', '버튼 글자와 이동 주소를 직접 바꿉니다.'));
    const imageButton = el('button'); imageButton.type = 'button'; imageButton.append(el('strong', '메인 사진 수정'), el('span', 'PHOTO 02~06을 새 사진으로 교체합니다.'));
    textButton.addEventListener('click', () => renderEditor('text'));
    linkButton.addEventListener('click', () => renderEditor('link'));
    imageButton.addEventListener('click', () => renderEditor('image'));
    entry.append(textButton, linkButton, imageButton);
    const note = el('p', '홍보팀장이 올린 홈페이지 수정 요청을 검토하는 기존 “홈페이지 내용 관리” 메뉴는 그대로 유지됩니다.', 'help');
    target.replaceChildren(intro, entry, note);
  }

  function addNavigation() {
    if (route() !== 'operations_manager') return;
    const nav = document.getElementById('app-nav');
    if (!nav || nav.querySelector('[data-operations-homepage-direct]')) return;
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = '홈페이지 직접 수정';
    node.dataset.operationsHomepageDirect = '1';
    node.addEventListener('click', openWorkspace);
    const approval = [...nav.querySelectorAll('button')].find(item => item.textContent.trim() === '홈페이지 내용 관리');
    const homepage = [...nav.querySelectorAll('a')].find(item => item.textContent.trim() === '홈페이지');
    if (approval) nav.insertBefore(node, approval);
    else if (homepage) nav.insertBefore(node, homepage);
    else nav.append(node);
  }

  function sync() { setTimeout(addNavigation, 150); }
  injectStyles();
  document.addEventListener('taejang-app-ready', sync);
  document.addEventListener('taejang-dashboard-refresh', sync);
  const observer = new MutationObserver(() => addNavigation());
  const start = () => {
    const nav = document.getElementById('app-nav');
    if (nav) observer.observe(nav, { childList: true });
    addNavigation();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOperationsHomepageDirect = { open: openWorkspace, openEditor: renderEditor };
})();
