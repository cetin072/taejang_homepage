(() => {
  'use strict';

  window.TaejangPromotionWorkspaceV2 = true;

  const SESSION_KEY = 'taejang-staff-session-v1';
  const PROMOTION_ROLES = new Set(['promotion_staff', 'promotion_lead', 'operations_manager', 'ceo']);
  const WRITE_ROLES = new Set(['promotion_staff', 'promotion_lead']);
  const REVIEW_ROLES = new Set(['promotion_lead', 'operations_manager', 'ceo']);
  const TYPE_LABELS = {
    homepage_article: '태장 소식',
    external_content: '외부 기사·콘텐츠',
    press_release: '보도자료'
  };
  const LIFECYCLE_LABELS = {
    draft: '작성 중',
    review_pending: '승인 대기',
    needs_revision: '보완 필요',
    approved: '승인 완료',
    scheduled: '게시 예정',
    published: '게시 완료',
    hidden: '숨김',
    archived: '보관'
  };
  const STAGE_LABELS = { lead: '홍보팀장', operations: '운영총괄', ceo: '대표이사' };
  const HOMEPAGE_PAGES = {
    home: ['메인 페이지', [['hero', '첫 화면 소개'], ['about', '태장 소개 요약'], ['business', '지금 태장이 하는 일'], ['workplace', '태장의 일터'], ['recent_activities', '활동 기록'], ['partnership', '협력 안내'], ['contact', '문의']]],
    about: ['태장 소개', [['page_hero', '페이지 상단 소개'], ['at_a_glance', '태장 한눈에 보기'], ['name_meaning', '태장이라는 이름'], ['greeting', '대표 인사말'], ['values', '태장이 일하는 기준'], ['history', '태장의 발걸음'], ['about_cta', '협력·문의 안내']]],
    business: ['하는 일', [['page_hero', '페이지 상단 소개'], ['current_operations', '현재 운영 사업'], ['partnership_flow', '협력 검토 흐름'], ['business_in_development', '개발 중인 사업']]],
    workplace: ['우리의 일터', [['page_hero', '페이지 상단 소개'], ['workplace_overview', '직무와 작업 방식'], ['workplace_stories', '일터 이야기']]],
    archive: ['소식·기록', [['page_hero', '페이지 상단 소개'], ['archive_list', '기록 목록 안내']]],
    partnership: ['협력·문의', [['page_hero', '페이지 상단 소개'], ['partner_companies', '함께 출발한 기업'], ['partnership_fields', '함께하는 방법'], ['environment_service', '지역사회공헌·ESG 협력'], ['faq', '자주 묻는 협력 질문'], ['contact', '협력 문의']]]
  };

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const arr = value => Array.isArray(value) ? value : [];
  let editingContentId = null;
  let currentMode = null;
  let cachedConfig = null;

  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined && value !== null) node.textContent = value;
    if (className) node.className = className;
    return node;
  };

  const button = (label, handler, quiet = false) => {
    const node = el('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  const field = (label, control, help) => {
    const node = document.createElement('label');
    node.append(el('span', label));
    if (help) node.append(el('small', help, 'field-help'));
    node.append(control);
    return node;
  };

  const input = (type = 'text') => {
    const node = document.createElement('input');
    node.type = type;
    return node;
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
    if (document.querySelector('style[data-phase-c-workspace-v2]')) return;
    const style = document.createElement('style');
    style.dataset.phaseCWorkspaceV2 = '1';
    style.textContent = `
      .phase-c-v2 .dashboard-intro { margin-bottom:20px; }
      .phase-c-v2-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
      .phase-c-v2-card { min-height:160px; }
      .phase-c-v2-card .quick-links { margin-top:auto; }
      .phase-c-board-composer { max-width:980px; padding:24px; border:1px solid var(--app-border); border-radius:16px; background:#fff; box-shadow:0 5px 16px rgba(22,53,38,.04); }
      .phase-c-board-form { display:grid; gap:18px; }
      .phase-c-board-form label { display:grid; gap:7px; font-weight:800; }
      .phase-c-board-form input,.phase-c-board-form select,.phase-c-board-form textarea { width:100%; min-height:46px; padding:11px 12px; border:1px solid var(--app-border); border-radius:10px; background:#fff; color:var(--app-text); font:inherit; }
      .phase-c-board-form textarea { min-height:330px; resize:vertical; line-height:1.75; }
      .phase-c-board-row { display:grid; grid-template-columns:minmax(180px,.4fr) 1fr; gap:14px; }
      .phase-c-editor-shell { border:1px solid var(--app-border); border-radius:12px; overflow:hidden; background:#fff; }
      .phase-c-editor-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:10px; border-bottom:1px solid var(--app-border); background:#f7faf8; }
      .phase-c-editor-toolbar .button { min-height:40px; padding:8px 12px; }
      .phase-c-editor-shell textarea { border:0; border-radius:0; outline:none; }
      .phase-c-photo-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; padding:12px; border-top:1px solid var(--app-border); background:#fafcfb; }
      .phase-c-photo-card { display:grid; gap:8px; padding:9px; border:1px solid var(--app-border); border-radius:10px; background:#fff; }
      .phase-c-photo-card img { width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:8px; }
      .phase-c-photo-card input { min-height:38px; padding:7px 8px; font-size:.9rem; }
      .phase-c-link-tools { display:grid; gap:9px; padding:14px; border:1px solid var(--app-border); border-radius:12px; background:#f8fbf9; }
      .phase-c-link-preview { display:grid; grid-template-columns:120px 1fr; gap:12px; align-items:start; }
      .phase-c-link-preview img { width:120px; aspect-ratio:4/3; object-fit:cover; border-radius:9px; }
      .phase-c-review-source { display:inline-flex; width:fit-content; padding:4px 9px; border-radius:999px; background:#edf3ff; color:#34568b; font-size:.8rem; font-weight:850; }
      .phase-c-review-source.returned { background:#fff1db; color:#805400; }
      .phase-c-review-note { white-space:pre-line; padding:11px 12px; border-radius:10px; background:#fff8e8; color:#5f4a13; }
      .phase-c-edit-page { max-width:980px; }
      .phase-c-homepage-entry { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-bottom:20px; }
      .phase-c-homepage-entry button { min-height:130px; padding:20px; border:1px solid var(--app-border); border-radius:14px; background:#fff; text-align:left; cursor:pointer; }
      .phase-c-homepage-entry strong { display:block; margin-bottom:8px; font-size:1.12rem; }
      .phase-c-homepage-form { max-width:900px; padding:22px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .phase-c-homepage-request-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
      .phase-c-homepage-request { min-height:170px; }
      .phase-c-upload-status { margin:0; color:var(--app-muted); font-size:.92rem; }
      @media(max-width:1100px){.phase-c-v2-grid,.phase-c-homepage-request-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.phase-c-photo-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}
      @media(max-width:760px){.phase-c-v2-grid,.phase-c-homepage-request-grid,.phase-c-homepage-entry,.phase-c-board-row{grid-template-columns:1fr;}.phase-c-photo-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.phase-c-link-preview{grid-template-columns:1fr;}.phase-c-link-preview img{width:100%;max-width:260px;}}
      @media(max-width:480px){.phase-c-photo-grid{grid-template-columns:1fr;}}
    `;
    document.head.append(style);
  }

  function closeSidebar() {
    const shell = document.getElementById('desktop-app-shell');
    shell?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function makeSlug() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
    const token = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    return `post-${parts}-${token}`;
  }

  function session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); }
    catch { return {}; }
  }

  async function config() {
    if (cachedConfig) return cachedConfig;
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('업로드 설정을 불러오지 못했습니다.');
    cachedConfig = await response.json();
    if (!cachedConfig.url || !cachedConfig.publishableKey) throw new Error('업로드 설정이 완전하지 않습니다.');
    return cachedConfig;
  }

  function jwtSubject(token) {
    try {
      const part = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
      const padded = part.padEnd(Math.ceil(part.length / 4) * 4, '=');
      return JSON.parse(atob(padded)).sub || null;
    } catch { return null; }
  }

  async function uploadImage(file) {
    if (!file) throw new Error('사진을 선택해 주세요.');
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!allowed.has(file.type)) throw new Error('JPG, PNG, WEBP, GIF 사진만 올릴 수 있습니다.');
    if (file.size > 8 * 1024 * 1024) throw new Error('사진 1장은 8MB 이하로 올려주세요.');
    const auth = session();
    const userId = jwtSubject(auth.access_token || '');
    if (!auth.access_token || !userId) throw new Error('로그인 정보를 다시 확인해 주세요.');
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type];
    const path = `${userId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const cfg = await config();
    const response = await fetch(`${cfg.url}/storage/v1/object/promotion-media/${encodedPath}`, {
      method: 'POST',
      headers: {
        apikey: cfg.publishableKey,
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': file.type,
        'x-upsert': 'false'
      },
      body: file
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || payload?.error || '사진을 업로드하지 못했습니다.');
    }
    return `${cfg.url}/storage/v1/object/public/promotion-media/${encodedPath}`;
  }

  async function fetchExternalMeta(url) {
    const auth = session();
    if (!auth.access_token) throw new Error('로그인 정보를 확인할 수 없습니다.');
    const response = await fetch('/.netlify/functions/external-content-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.access_token}` },
      body: JSON.stringify({ url })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || '링크 정보를 가져오지 못했습니다.');
    return payload || {};
  }

  function summaryFromBody(body) {
    return (body || '').replace(/\s+/g, ' ').trim().slice(0, 220) || null;
  }

  function containsNumbers(body) {
    return /\d|%|₩|원|만원|억원/.test(body || '') ? 'yes' : 'no';
  }

  function mediaFromExisting(item) {
    return arr(item?.public_media)
      .filter(entry => entry?.url)
      .map(entry => ({ url: entry.url, alt: entry.alt || '', kind: 'selected' }))
      .slice(0, 12);
  }

  function renderMediaEditor(container, media, onChange) {
    container.replaceChildren();
    if (!media.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    media.forEach((entry, index) => {
      const card = el('div', null, 'phase-c-photo-card');
      const image = document.createElement('img');
      image.src = entry.url;
      image.alt = entry.alt || `첨부 사진 ${index + 1}`;
      const alt = input();
      alt.value = entry.alt || '';
      alt.placeholder = '사진 설명(선택)';
      alt.maxLength = 300;
      alt.addEventListener('input', () => { entry.alt = alt.value; onChange(); });
      const remove = button('사진 빼기', () => {
        media.splice(index, 1);
        renderMediaEditor(container, media, onChange);
        onChange();
      }, true);
      card.append(image, alt, remove);
      container.append(card);
    });
  }

  async function savePromotion(formState, submitAfterSave, existingItem) {
    const body = formState.body.value;
    const title = formState.title.value.trim();
    if (!title) { window.alert('제목을 입력해 주세요.'); return; }
    if (!body.trim() && !formState.media.length && formState.type.value !== 'external_content') {
      window.alert('본문이나 사진을 입력해 주세요.'); return;
    }
    const publicMedia = formState.media.map(entry => ({ url: entry.url, kind: 'selected', alt: entry.alt?.trim() || undefined }));
    const payload = {
      p_content_id: existingItem?.content_id || null,
      p_content_type: formState.type.value,
      p_slug: existingItem?.slug || makeSlug(),
      p_title: title,
      p_summary: summaryFromBody(body),
      p_public_body: body.trim() || null,
      p_external_url: formState.type.value === 'external_content' ? (formState.external.value.trim() || null) : null,
      p_byline: null,
      p_byline_kind: 'company',
      p_related_organization: null,
      p_source_reference_url: formState.type.value === 'external_content' ? (formState.external.value.trim() || null) : null,
      p_hero_image_url: formState.heroImage || publicMedia[0]?.url || null,
      p_public_media: publicMedia,
      p_people_photo: publicMedia.length || formState.heroImage ? 'unsure' : 'no',
      p_number_or_amount: containsNumbers(body),
      p_requested_publish_date: formState.date.value || null,
      p_change_reason: existingItem ? '홍보 콘텐츠 수정·보완본 저장' : '홍보 콘텐츠 초안 저장'
    };
    try {
      formState.saveButtons.forEach(node => { node.disabled = true; });
      const saved = await app().rpc('save_promotion_draft', payload);
      if (submitAfterSave) await app().rpc('submit_promotion_revision', { p_content_id: saved.content_id });
      editingContentId = null;
      await openPromotion(submitAfterSave ? (route() === 'promotion_staff' ? 'write' : 'review') : 'write');
    } catch (error) {
      window.alert(app().friendlyError?.(error) || error.message || '저장하지 못했습니다.');
    } finally {
      formState.saveButtons.forEach(node => { node.disabled = false; });
    }
  }

  function buildComposer(existingItem = null) {
    const section = el('section', null, 'phase-c-board-composer');
    section.dataset.promotionComposer = 'v2';
    section.append(el('h2', existingItem ? '홍보자료 수정' : '새 홍보자료 작성'));
    section.append(el('p', existingItem ? '보완할 내용을 고쳐 새 수정본으로 저장합니다. 이전 제출본은 그대로 보존됩니다.' : '일반 게시판처럼 글 종류, 제목, 본문과 사진만 중심으로 작성하면 됩니다.', 'help'));

    const form = document.createElement('form');
    form.className = 'phase-c-board-form';
    form.addEventListener('submit', event => event.preventDefault());

    const type = select([
      ['homepage_article', '태장 소식 (홈페이지)'],
      ['external_content', '외부 기사·콘텐츠'],
      ['press_release', '보도자료']
    ]);
    type.value = existingItem?.content_type || 'homepage_article';
    const title = input();
    title.value = existingItem?.title || '';
    title.maxLength = 160;
    title.required = true;
    title.placeholder = '제목을 입력하세요';
    const date = input('date');
    date.value = existingItem?.requested_publish_date || '';

    const topRow = el('div', null, 'phase-c-board-row');
    topRow.append(field('글 종류', type), field('게시 희망일 (선택)', date, '정하지 않아도 됩니다.'));
    form.append(topRow, field('제목', title));

    const externalWrap = el('div', null, 'phase-c-link-tools');
    const external = input('url');
    external.value = existingItem?.external_url || '';
    external.placeholder = '기사나 외부 게시물 주소를 붙여넣으세요';
    const metaButton = button('링크에서 제목·썸네일·본문 가져오기', async () => {
      if (!external.value.trim()) { window.alert('링크를 먼저 입력해 주세요.'); return; }
      metaButton.disabled = true;
      metaStatus.textContent = '링크 내용을 확인하고 있습니다.';
      try {
        const metadata = await fetchExternalMeta(external.value.trim());
        if (metadata.url) external.value = metadata.url;
        if (metadata.title) title.value = metadata.title;
        if (metadata.article_text) body.value = metadata.article_text.slice(0, 30000);
        else if (metadata.description && !body.value.trim()) body.value = metadata.description;
        state.heroImage = metadata.image || state.heroImage;
        metaPreview.replaceChildren();
        if (metadata.image) {
          const image = document.createElement('img');
          image.src = metadata.image;
          image.alt = '가져온 썸네일';
          metaPreview.append(image);
        }
        const copy = el('div');
        copy.append(el('strong', metadata.title || '제목 정보 없음'));
        if (metadata.description) copy.append(el('p', metadata.description));
        metaPreview.append(copy);
        metaStatus.textContent = metadata.article_text ? '제목·썸네일·본문을 가져왔습니다.' : '가져올 수 있는 링크 정보를 반영했습니다.';
      } catch (error) {
        metaStatus.textContent = error.message || '링크 정보를 가져오지 못했습니다.';
      } finally { metaButton.disabled = false; }
    }, true);
    const metaStatus = el('p', '', 'phase-c-upload-status');
    const metaPreview = el('div', null, 'phase-c-link-preview');
    externalWrap.append(field('외부 링크', external), metaButton, metaStatus, metaPreview);
    form.append(externalWrap);

    const body = document.createElement('textarea');
    body.value = existingItem?.public_body || '';
    body.maxLength = 30000;
    body.placeholder = '본문을 입력하세요. 아래 ‘사진 추가’ 버튼으로 사진도 함께 올릴 수 있습니다.';
    const editor = el('div', null, 'phase-c-editor-shell');
    const toolbar = el('div', null, 'phase-c-editor-toolbar');
    const uploadLabel = el('label', null, 'button button-quiet');
    uploadLabel.textContent = '사진 추가';
    uploadLabel.style.cursor = 'pointer';
    const fileInput = input('file');
    fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
    fileInput.multiple = true;
    fileInput.hidden = true;
    uploadLabel.append(fileInput);
    const uploadStatus = el('span', '사진은 최대 12장 · 장당 8MB', 'phase-c-upload-status');
    toolbar.append(uploadLabel, uploadStatus);
    const media = mediaFromExisting(existingItem);
    const mediaGrid = el('div', null, 'phase-c-photo-grid');
    const state = { type, title, date, external, body, media, heroImage: existingItem?.hero_image_url || null, saveButtons: [] };
    renderMediaEditor(mediaGrid, media, () => {});
    fileInput.addEventListener('change', async () => {
      const files = [...(fileInput.files || [])];
      if (!files.length) return;
      if (media.length + files.length > 12) { window.alert('사진은 최대 12장까지 올릴 수 있습니다.'); fileInput.value = ''; return; }
      uploadLabel.style.pointerEvents = 'none';
      uploadStatus.textContent = '사진을 업로드하고 있습니다.';
      try {
        for (const file of files) {
          const url = await uploadImage(file);
          media.push({ url, alt: file.name.replace(/\.[^.]+$/, ''), kind: 'selected' });
        }
        if (!state.heroImage && media[0]) state.heroImage = media[0].url;
        renderMediaEditor(mediaGrid, media, () => {});
        uploadStatus.textContent = `${media.length}장 첨부됨`;
      } catch (error) {
        window.alert(error.message || '사진 업로드에 실패했습니다.');
        uploadStatus.textContent = '사진 업로드 실패';
      } finally {
        uploadLabel.style.pointerEvents = '';
        fileInput.value = '';
      }
    });
    editor.append(toolbar, body, mediaGrid);
    form.append(field('본문', editor, '글과 사진을 한 화면에서 작성합니다. 첨부 사진은 게시물 본문 이미지로 함께 저장됩니다.'));

    const actions = el('div', null, 'quick-links');
    const save = button(existingItem ? '수정본 저장' : '임시저장', () => savePromotion(state, false, existingItem));
    const submit = button(existingItem ? '저장 후 다시 승인 요청' : '저장 후 승인 요청', () => savePromotion(state, true, existingItem), false);
    state.saveButtons.push(save, submit);
    actions.append(save, submit);
    if (existingItem) actions.append(button('수정 취소', () => { editingContentId = null; openPromotion('revision'); }, true));
    form.append(actions);
    section.append(form);

    const updateType = () => {
      externalWrap.hidden = type.value !== 'external_content';
      if (type.value !== 'external_content') {
        external.value = '';
        metaStatus.textContent = '';
        metaPreview.replaceChildren();
      }
    };
    type.addEventListener('change', updateType);
    updateType();
    return section;
  }

  function previewCard(item) {
    const panel = el('section', null, 'dashboard-section promotion-preview-panel');
    panel.append(el('p', TYPE_LABELS[item.content_type] || '홍보자료', 'eyebrow'), el('h2', item.title || '제목 없음'));
    if (item.requested_publish_date) panel.append(el('p', `게시 희망일 ${item.requested_publish_date}`));
    if (item.hero_image_url) {
      const image = document.createElement('img');
      image.src = item.hero_image_url;
      image.alt = `${item.title || '홍보자료'} 대표 이미지`;
      panel.append(image);
    }
    if (item.public_body) panel.append(el('div', item.public_body, 'promotion-preview-body'));
    const images = arr(item.public_media);
    if (images.length) {
      const grid = el('div', null, 'phase-c-photo-grid');
      images.forEach((entry, index) => {
        const image = document.createElement('img');
        image.src = entry.url;
        image.alt = entry.alt || `본문 사진 ${index + 1}`;
        grid.append(image);
      });
      panel.append(grid);
    }
    if (item.external_url) {
      const link = document.createElement('a');
      link.href = item.external_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'button button-quiet';
      link.textContent = '원문 보기';
      panel.append(link);
    }
    panel.append(button('미리보기 닫기', () => panel.remove(), true));
    return panel;
  }

  function contentCard(item, allowEdit = true) {
    const card = el('article', null, 'dashboard-card phase-c-v2-card promotion-card');
    card.append(el('span', LIFECYCLE_LABELS[item.lifecycle] || item.lifecycle, 'status-label'));
    card.append(el('h3', item.title || '제목 없음'));
    card.append(el('p', TYPE_LABELS[item.content_type] || '홍보자료'));
    if (item.requested_publish_date) card.append(el('p', `게시 희망일 ${item.requested_publish_date}`));
    const actions = el('div', null, 'quick-links');
    actions.append(button('미리보기', () => {
      main().querySelector('.promotion-preview-panel')?.remove();
      main().querySelector('.dashboard-intro')?.after(previewCard(item));
    }, true));
    if (allowEdit && ['draft', 'needs_revision'].includes(item.lifecycle)) {
      actions.append(button(item.lifecycle === 'needs_revision' ? '보완해서 새 수정본 만들기' : '열어 수정', () => {
        editingContentId = item.content_id;
        openPromotion('edit');
      }));
    }
    if (item.lifecycle === 'review_pending') {
      actions.append(button('승인 요청 취소하고 수정', async () => {
        if (!window.confirm('승인 요청을 취소하고 다시 수정하시겠습니까?')) return;
        try {
          await app().rpc('withdraw_promotion_submission', { p_content_id: item.content_id });
          editingContentId = item.content_id;
          await openPromotion('edit');
        } catch (error) { window.alert(app().friendlyError?.(error) || '처리하지 못했습니다.'); }
      }, true));
    }
    card.append(actions);
    return card;
  }

  async function addFeedback(card, item) {
    if (item.lifecycle !== 'needs_revision') return;
    try {
      const feedback = await app().rpc('get_my_promotion_feedback', { p_content_id: item.content_id });
      if (feedback?.comment) card.querySelector('h3')?.after(el('p', `보완 요청: ${feedback.comment}`, 'phase-c-review-note'));
    } catch { /* optional convenience */ }
  }

  function renderIntro(kicker, title, copy) {
    const intro = el('header', null, 'dashboard-intro');
    intro.append(el('p', kicker, 'eyebrow'), el('h2', title), el('p', copy));
    return intro;
  }

  async function renderWrite(workspace) {
    const target = main();
    const role = workspace.role;
    document.getElementById('desktop-page-title').textContent = '홍보 작성';
    target.replaceChildren(renderIntro('홍보 업무', '새 홍보자료 작성', '제목과 본문 중심으로 작성하세요. 게시주소·요약·대표 이미지 같은 기술 항목은 자동으로 처리합니다.'));
    target.append(buildComposer());
    const mine = arr(workspace.my_items).filter(item => item.lifecycle !== 'needs_revision');
    const section = el('section', null, 'dashboard-section');
    section.append(el('h2', role === 'promotion_lead' ? '내가 작성한 홍보자료' : '내 작성글'));
    const grid = el('div', null, 'phase-c-v2-grid');
    if (!mine.length) grid.append(el('p', '아직 작성한 홍보자료가 없습니다.', 'empty'));
    mine.forEach(item => grid.append(contentCard(item)));
    section.append(grid);
    target.append(section);
  }

  async function renderRevision(workspace) {
    const target = main();
    document.getElementById('desktop-page-title').textContent = '수정·보완 요청';
    target.replaceChildren(renderIntro('홍보 업무', '수정·보완 요청', '보완 요청을 받은 글만 표시합니다. 카드를 열어 수정본을 만들면 됩니다.'));
    const items = arr(workspace.my_items).filter(item => item.lifecycle === 'needs_revision');
    const section = el('section', null, 'dashboard-section');
    const grid = el('div', null, 'phase-c-v2-grid');
    if (!items.length) grid.append(el('p', '현재 수정·보완 요청이 없습니다.', 'empty'));
    for (const item of items) {
      const card = contentCard(item);
      grid.append(card);
      await addFeedback(card, item);
    }
    section.append(grid);
    target.append(section);
  }

  async function renderEdit(workspace) {
    const target = main();
    const item = arr(workspace.my_items).find(entry => entry.content_id === editingContentId);
    if (!item) { editingContentId = null; return renderRevision(workspace); }
    document.getElementById('desktop-page-title').textContent = '홍보자료 수정';
    target.replaceChildren(renderIntro('홍보 업무', '홍보자료 수정·보완', '이 글만 별도 화면에서 수정합니다. 저장하면 새 수정본으로 이어집니다.'), buildComposer(item));
  }

  async function reviewAction(detail, action) {
    let comment = null;
    let revisit = null;
    if (action === 'changes_requested') {
      comment = window.prompt('보완이 필요한 내용을 구체적으로 적어주세요.', '');
      if (!comment?.trim()) return;
    } else if (action === 'rejected') {
      comment = window.prompt('반려 이유를 적어주세요.', '');
      if (!comment?.trim()) return;
    } else if (action === 'escalate_to_operations') {
      comment = window.prompt('운영총괄에게 전달할 내용을 적어주세요.', '');
      if (!comment?.trim()) return;
    } else if (action === 'escalate_to_ceo') {
      const summary = window.prompt('대표이사에게 전달할 핵심 요약을 적어주세요.', '');
      if (!summary?.trim()) return;
      const reason = window.prompt('대표이사 확인이 필요한 이유를 적어주세요.', '');
      if (!reason?.trim()) return;
      comment = `요약: ${summary.trim()}\n확인 이유: ${reason.trim()}`;
    } else if (action === 'on_hold') {
      comment = window.prompt('보류 사유가 있으면 적어주세요.', '')?.trim() || null;
      revisit = window.prompt('다시 확인할 날짜를 YYYY-MM-DD로 적어주세요.', '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(revisit || '')) { window.alert('날짜 형식을 확인해 주세요.'); return; }
    }
    await app().rpc('review_promotion_revision', {
      p_content_id: detail.content_id,
      p_action: action,
      p_comment: comment?.trim() || null,
      p_revisit_at: revisit
    });
    await openPromotion('review');
  }

  async function renderLeadEdit(detail) {
    const target = main();
    document.getElementById('desktop-page-title').textContent = '홍보자료 직접 수정';
    const intro = renderIntro('홍보 검토', '홍보자료 직접 수정', '선택한 검토 건만 별도 화면에서 수정합니다. 카드가 길어지는 방식은 사용하지 않습니다.');
    const section = el('section', null, 'dashboard-section phase-c-edit-page');
    const title = input(); title.value = detail.title || ''; title.maxLength = 160; title.required = true;
    const body = document.createElement('textarea'); body.value = detail.public_body || ''; body.rows = 14; body.maxLength = 30000;
    const external = input('url'); external.value = detail.external_url || '';
    const date = input('date'); date.value = detail.requested_publish_date || '';
    const form = el('form', null, 'phase-c-board-form');
    form.addEventListener('submit', event => event.preventDefault());
    form.append(field('제목', title), field('본문', body));
    if (detail.content_type === 'external_content') form.append(field('외부 링크', external));
    form.append(field('게시 희망일 (선택)', date));
    const actions = el('div', null, 'quick-links');
    actions.append(button('수정본 저장', async () => {
      if (!title.value.trim()) { window.alert('제목을 입력해 주세요.'); return; }
      try {
        await app().rpc('lead_replace_promotion_revision', {
          p_content_id: detail.content_id,
          p_title: title.value.trim(),
          p_public_body: body.value.trim() || null,
          p_external_url: detail.content_type === 'external_content' ? (external.value.trim() || null) : null,
          p_requested_publish_date: date.value || null
        });
        await openPromotion('review');
      } catch (error) { window.alert(app().friendlyError?.(error) || '수정본을 저장하지 못했습니다.'); }
    }), button('검토 목록으로', () => openPromotion('review'), true));
    form.append(actions);
    section.append(form);
    target.replaceChildren(intro, section);
  }

  async function reviewCard(item, workspace) {
    let detail;
    try { detail = await app().rpc('get_promotion_review_detail', { p_content_id: item.content_id }); }
    catch { detail = { ...item, content_id: item.content_id }; }
    const card = el('article', null, 'dashboard-card phase-c-v2-card');
    let handoff = null;
    if (workspace.role === 'promotion_lead') {
      try { handoff = await app().rpc('get_promotion_review_handoff', { p_content_id: item.content_id }); }
      catch { handoff = null; }
    }
    card.append(el('span', handoff ? '운영총괄 보완 요청' : `${STAGE_LABELS[detail.stage] || '검토'} 단계`, `phase-c-review-source${handoff ? ' returned' : ''}`));
    card.append(el('h3', detail.title || item.title || '제목 없음'));
    if (detail.requested_publish_date) card.append(el('p', `게시 희망일 ${detail.requested_publish_date}`));
    if (handoff?.comment) card.append(el('p', `운영총괄 보완 의견\n${handoff.comment}`, 'phase-c-review-note'));
    if (detail.previous_stage_comment) card.append(el('p', `이전 검토 의견\n${detail.previous_stage_comment}`, 'phase-c-review-note'));
    const actions = el('div', null, 'quick-links');
    actions.append(button('미리보기', () => {
      main().querySelector('.promotion-preview-panel')?.remove();
      main().querySelector('.dashboard-intro')?.after(previewCard(detail));
    }, true));

    if (workspace.role === 'promotion_lead') {
      actions.append(button('직접 수정', () => renderLeadEdit(detail), true));
      if (handoff) {
        actions.append(button('홍보직원에게 보완 전달', async () => {
          const comment = window.prompt('직원에게 전달할 보완 내용을 적어주세요.', handoff.comment || '');
          if (!comment?.trim()) return;
          try {
            await app().rpc('review_promotion_revision', { p_content_id: detail.content_id, p_action: 'changes_requested', p_comment: comment.trim(), p_revisit_at: null });
            await openPromotion('review');
          } catch (error) { window.alert(app().friendlyError?.(error) || '보완 요청을 전달하지 못했습니다.'); }
        }, true));
      } else {
        actions.append(button('보완 요청', () => reviewAction(detail, 'changes_requested'), true));
        actions.append(button('승인', () => reviewAction(detail, 'approve')));
        actions.append(button('운영총괄 상신', () => reviewAction(detail, 'escalate_to_operations'), true));
      }
    } else if (workspace.role === 'operations_manager') {
      actions.append(button('승인', () => reviewAction(detail, 'approve')));
      actions.append(button('홍보팀장에게 보완 요청', async () => {
        const comment = window.prompt('홍보팀장에게 내려보낼 보완 내용을 적어주세요.', '');
        if (!comment?.trim()) return;
        try {
          await app().rpc('request_promotion_changes_via_lead', { p_content_id: detail.content_id, p_comment: comment.trim() });
          await openPromotion('review');
        } catch (error) { window.alert(app().friendlyError?.(error) || '보완 요청을 처리하지 못했습니다.'); }
      }, true));
      actions.append(button('대표이사 상신', () => reviewAction(detail, 'escalate_to_ceo'), true));
      actions.append(button('검토 보류', () => reviewAction(detail, 'on_hold'), true));
    } else {
      actions.append(button('승인', () => reviewAction(detail, 'approve')));
      actions.append(button('보완 요청', () => reviewAction(detail, 'changes_requested'), true));
      actions.append(button('반려', () => reviewAction(detail, 'rejected'), true));
      actions.append(button('검토 보류', () => reviewAction(detail, 'on_hold'), true));
    }
    card.append(actions);
    return card;
  }

  async function renderReview(workspace) {
    const target = main();
    const title = workspace.role === 'promotion_lead' ? '홍보 검토' : workspace.role === 'operations_manager' ? '홍보 승인 검토' : '대표이사 홍보 검토';
    document.getElementById('desktop-page-title').textContent = title;
    target.replaceChildren(renderIntro('홍보 업무', title, '현재 검토해야 할 건만 카드로 표시합니다.'));
    const grid = el('section', null, 'phase-c-v2-grid');
    const items = arr(workspace.review_items);
    if (!items.length) grid.append(el('p', '현재 검토 대기 안건이 없습니다.', 'empty'));
    for (const item of items) grid.append(await reviewCard(item, workspace));
    target.append(grid);
  }

  async function openPromotion(mode = 'review') {
    closeSidebar();
    currentMode = mode;
    const target = main();
    if (!target || !PROMOTION_ROLES.has(route())) return;
    target.hidden = false;
    target.classList.add('phase-c-v2');
    target.replaceChildren(el('p', '홍보 업무를 불러오고 있습니다.', 'message'));
    try {
      const workspace = await app().rpc('get_my_promotion_workspace');
      if (mode === 'revision' && workspace.role === 'promotion_staff') return renderRevision(workspace);
      if (mode === 'edit' && WRITE_ROLES.has(workspace.role)) return renderEdit(workspace);
      if (mode === 'write' && WRITE_ROLES.has(workspace.role)) return renderWrite(workspace);
      if (REVIEW_ROLES.has(workspace.role)) return renderReview(workspace);
      return renderWrite(workspace);
    } catch (error) {
      target.replaceChildren(el('p', app().friendlyError?.(error) || '홍보 업무를 불러오지 못했습니다.', 'message error'));
    }
  }

  function navButton(label, handler, key) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.dataset.phaseCV2Nav = key;
    node.addEventListener('click', () => { closeSidebar(); handler(); });
    return node;
  }

  function replaceButton(nav, label, handler, key) {
    const current = [...nav.querySelectorAll('button')].find(node => node.textContent.trim() === label);
    if (!current) return null;
    if (current.dataset.phaseCV2Nav) return current;
    const replacement = navButton(label, handler, key);
    current.replaceWith(replacement);
    return replacement;
  }

  function syncNavigation() {
    const nav = document.getElementById('app-nav');
    const currentRoute = route();
    if (!nav || !currentRoute) return;
    [...nav.querySelectorAll('button')].forEach(node => {
      if (node.textContent.trim() === '신규 사업 기획') node.remove();
    });
    if (currentRoute === 'promotion_staff') {
      const write = replaceButton(nav, '홍보 작성', () => openPromotion('write'), 'write');
      if (!nav.querySelector('[data-phase-c-v2-nav="revision"]')) {
        const revision = navButton('수정·보완 요청', () => openPromotion('revision'), 'revision');
        if (write) nav.insertBefore(revision, write); else nav.append(revision);
      }
    }
    if (currentRoute === 'promotion_lead') {
      replaceButton(nav, '홍보 검토', () => openPromotion('review'), 'review');
      replaceButton(nav, '홍보 작성', () => openPromotion('write'), 'write');
    }
    if (currentRoute === 'operations_manager' || currentRoute === 'ceo') {
      replaceButton(nav, '홍보 검토', () => openPromotion('review'), 'review');
    }
    if (['promotion_lead', 'operations_manager'].includes(currentRoute) && !nav.querySelector('[data-phase-c-v2-nav="homepage"]')) {
      const homepageLink = [...nav.querySelectorAll('a')].find(node => node.textContent.trim() === '홈페이지');
      const node = navButton('홈페이지 내용 관리', openHomepageManagement, 'homepage');
      if (homepageLink) nav.insertBefore(node, homepageLink); else nav.append(node);
    }
  }

  function syncDashboardActions() {
    const target = main();
    const currentRoute = route();
    if (!target) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!heading.includes('대시보드')) return;
    if (currentRoute === 'promotion_staff') {
      const revisionCard = [...target.querySelectorAll('.dashboard-card')].find(node => node.querySelector('h3')?.textContent.trim() === '수정·보완 요청');
      const action = revisionCard?.querySelector('button');
      if (action && !action.dataset.phaseCV2Dashboard) {
        const replacement = button(action.textContent.trim() || '보완 내용 확인', () => openPromotion('revision'), true);
        replacement.dataset.phaseCV2Dashboard = '1';
        action.replaceWith(replacement);
      }
      const writeCard = [...target.querySelectorAll('.dashboard-card')].find(node => node.querySelector('h3')?.textContent.trim() === '홍보자료 작성');
      const writeAction = writeCard?.querySelector('button');
      if (writeAction && !writeAction.dataset.phaseCV2Dashboard) {
        const replacement = button(writeAction.textContent.trim() || '홍보 작성 열기', () => openPromotion('write'), true);
        replacement.dataset.phaseCV2Dashboard = '1';
        writeAction.replaceWith(replacement);
      }
    }
    if (currentRoute === 'promotion_lead') {
      [...target.querySelectorAll('.dashboard-card')].forEach(card => {
        const title = card.querySelector('h3')?.textContent.trim();
        const action = card.querySelector('button');
        if (!action || action.dataset.phaseCV2Dashboard) return;
        if (title === '홍보 검토 대기') {
          const replacement = button(action.textContent.trim(), () => openPromotion('review'), true);
          replacement.dataset.phaseCV2Dashboard = '1'; action.replaceWith(replacement);
        }
        if (title === '홍보자료 직접 작성') {
          const replacement = button(action.textContent.trim(), () => openPromotion('write'), true);
          replacement.dataset.phaseCV2Dashboard = '1'; action.replaceWith(replacement);
        }
      });
    }
  }

  function pageOptions() {
    return Object.entries(HOMEPAGE_PAGES).map(([key, [label]]) => [key, label]);
  }

  function homepageRequestCard(item, canReview) {
    const [pageLabel, sections] = HOMEPAGE_PAGES[item.page_key] || [item.page_key, []];
    const sectionLabel = sections.find(([key]) => key === item.section_key)?.[1] || item.section_key;
    const card = el('article', null, 'dashboard-card phase-c-homepage-request');
    card.append(el('span', item.status === 'pending' ? '승인 대기' : item.status === 'approved' ? '최종 승인' : item.status === 'changes_requested' ? '보완 요청' : '반려', 'status-label'));
    card.append(el('h3', `${pageLabel} · ${sectionLabel}`));
    card.append(el('p', item.change_kind === 'text' ? '글 수정' : '사진 수정'));
    if (item.proposed_text) card.append(el('p', item.proposed_text));
    if (item.proposed_image_url) {
      const image = document.createElement('img'); image.src = item.proposed_image_url; image.alt = item.image_alt || '변경할 사진'; image.style.width = '100%'; image.style.borderRadius = '10px'; card.append(image);
    }
    if (item.reason) card.append(el('p', `수정 이유: ${item.reason}`));
    if (item.decision_comment) card.append(el('p', `검토 의견: ${item.decision_comment}`, 'phase-c-review-note'));
    const actions = el('div', null, 'quick-links');
    const link = document.createElement('a');
    link.href = ({ home: '../index.html', about: '../about.html', business: '../business.html', workplace: '../workplace.html', archive: '../archive.html', partnership: '../partnership.html' })[item.page_key] || '../index.html';
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'button button-quiet'; link.textContent = '현재 홈페이지 확인';
    actions.append(link);
    if (canReview && item.status === 'pending') {
      actions.append(button('최종 승인', () => reviewHomepageRequest(item.id, 'approve')));
      actions.append(button('보완 요청', () => reviewHomepageRequest(item.id, 'changes_requested'), true));
      actions.append(button('반려', () => reviewHomepageRequest(item.id, 'reject'), true));
    }
    card.append(actions);
    return card;
  }

  async function reviewHomepageRequest(id, action) {
    let comment = '';
    if (action === 'changes_requested' || action === 'reject') {
      comment = window.prompt(action === 'changes_requested' ? '보완할 내용을 적어주세요.' : '반려 이유를 적어주세요.', '') || '';
      if (!comment.trim()) return;
    }
    try {
      await app().rpc('review_homepage_change_request', { p_request_id: id, p_action: action, p_comment: comment.trim() || null });
      await openHomepageManagement();
    } catch (error) { window.alert(app().friendlyError?.(error) || '검토 결과를 저장하지 못했습니다.'); }
  }

  function buildHomepageForm(kind, onSaved) {
    const wrap = el('section', null, 'phase-c-homepage-form');
    wrap.append(el('h2', kind === 'text' ? '홈페이지 글 수정' : '홈페이지 사진 수정'));
    wrap.append(el('p', '기존 홈페이지의 정해진 페이지와 섹션만 수정합니다. 메뉴나 전체 구조 변경은 여기서 하지 않습니다.', 'help'));
    const form = el('form', null, 'phase-c-board-form');
    form.addEventListener('submit', event => event.preventDefault());
    const page = select(pageOptions());
    const section = select([]);
    const reason = document.createElement('textarea'); reason.rows = 3; reason.maxLength = 1000; reason.placeholder = '왜 수정하는지 적어주세요.'; reason.required = true;
    const proposed = document.createElement('textarea'); proposed.rows = 8; proposed.maxLength = 12000; proposed.placeholder = '새로 바꿀 문구를 입력하세요.';
    const imageAlt = input(); imageAlt.maxLength = 300; imageAlt.placeholder = '사진 설명(선택)';
    let uploadedUrl = null;
    const imageBox = el('div', null, 'phase-c-link-tools');
    const file = input('file'); file.accept = 'image/jpeg,image/png,image/webp,image/gif';
    const preview = el('div', null, 'phase-c-link-preview');
    const status = el('p', 'JPG, PNG, WEBP, GIF · 8MB 이하', 'phase-c-upload-status');
    file.addEventListener('change', async () => {
      if (!file.files?.[0]) return;
      status.textContent = '사진을 업로드하고 있습니다.';
      file.disabled = true;
      try {
        uploadedUrl = await uploadImage(file.files[0]);
        const image = document.createElement('img'); image.src = uploadedUrl; image.alt = imageAlt.value || '변경할 사진';
        preview.replaceChildren(image, el('p', '새 사진 업로드 완료'));
        status.textContent = '사진 업로드 완료';
      } catch (error) {
        uploadedUrl = null; status.textContent = '사진 업로드 실패'; window.alert(error.message || '사진 업로드에 실패했습니다.');
      } finally { file.disabled = false; }
    });
    imageBox.append(field('새 사진 파일', file), field('사진 설명', imageAlt), status, preview);

    const updateSections = () => {
      section.replaceChildren();
      HOMEPAGE_PAGES[page.value][1].forEach(([value, label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label; section.append(option);
      });
    };
    page.addEventListener('change', updateSections); updateSections();
    const row = el('div', null, 'phase-c-board-row'); row.append(field('페이지', page), field('수정할 영역', section));
    form.append(row);
    if (kind === 'text') form.append(field('새 문구', proposed)); else form.append(imageBox);
    form.append(field('수정 이유', reason));
    form.append(button('운영총괄에게 수정 요청', async () => {
      if (!reason.value.trim()) { window.alert('수정 이유를 적어주세요.'); return; }
      if (kind === 'text' && !proposed.value.trim()) { window.alert('바꿀 문구를 입력해 주세요.'); return; }
      if (kind === 'image' && !uploadedUrl) { window.alert('새 사진을 먼저 업로드해 주세요.'); return; }
      try {
        await app().rpc('create_homepage_change_request', {
          p_page_key: page.value,
          p_section_key: section.value,
          p_change_kind: kind,
          p_current_summary: null,
          p_proposed_text: kind === 'text' ? proposed.value.trim() : null,
          p_proposed_image_url: kind === 'image' ? uploadedUrl : null,
          p_image_alt: kind === 'image' ? (imageAlt.value.trim() || null) : null,
          p_reason: reason.value.trim()
        });
        onSaved();
      } catch (error) { window.alert(app().friendlyError?.(error) || '수정 요청을 저장하지 못했습니다.'); }
    }));
    wrap.append(form);
    return wrap;
  }

  async function openHomepageManagement(initialKind = null) {
    closeSidebar();
    const target = main();
    const currentRoute = route();
    if (!target || !['promotion_lead', 'operations_manager'].includes(currentRoute)) return;
    document.getElementById('desktop-page-title').textContent = '홈페이지 내용 관리';
    target.classList.add('phase-c-v2');
    target.replaceChildren(el('p', '홈페이지 내용을 불러오고 있습니다.', 'message'));
    try {
      const requests = arr(await app().rpc('get_homepage_change_requests'));
      const intro = renderIntro('홈페이지 운영', '홈페이지 내용 관리', currentRoute === 'promotion_lead' ? '홈페이지의 기존 글과 사진을 수정 요청하는 화면입니다.' : '홍보팀장이 요청한 홈페이지 글·사진 변경을 최종 검토합니다.');
      target.replaceChildren(intro);
      if (currentRoute === 'promotion_lead') {
        const entry = el('div', null, 'phase-c-homepage-entry');
        const textEntry = el('button'); textEntry.type = 'button'; textEntry.append(el('strong', '홈페이지 글 수정'), el('span', '페이지와 영역을 고르고 새 문구를 입력합니다.'));
        const imageEntry = el('button'); imageEntry.type = 'button'; imageEntry.append(el('strong', '홈페이지 사진 수정'), el('span', '새 사진 파일을 직접 업로드해 변경 요청합니다.'));
        const formSlot = el('div');
        const showForm = kind => formSlot.replaceChildren(buildHomepageForm(kind, () => openHomepageManagement(kind)));
        textEntry.addEventListener('click', () => showForm('text'));
        imageEntry.addEventListener('click', () => showForm('image'));
        entry.append(textEntry, imageEntry); target.append(entry, formSlot);
        if (initialKind) showForm(initialKind);
      }
      const section = el('section', null, 'dashboard-section');
      const pending = requests.filter(item => item.status === 'pending');
      section.append(el('h2', currentRoute === 'operations_manager' ? `승인 대기 ${pending.length}건` : '내 홈페이지 수정 요청'));
      const grid = el('div', null, 'phase-c-homepage-request-grid');
      const visible = currentRoute === 'operations_manager' ? [...pending, ...requests.filter(item => item.status !== 'pending')] : requests;
      if (!visible.length) grid.append(el('p', '현재 등록된 홈페이지 수정 요청이 없습니다.', 'empty'));
      visible.forEach(item => grid.append(homepageRequestCard(item, currentRoute === 'operations_manager')));
      section.append(grid); target.append(section);
    } catch (error) {
      target.replaceChildren(renderIntro('홈페이지 운영', '홈페이지 내용 관리', '내용을 불러오지 못했습니다.'), el('p', app().friendlyError?.(error) || error.message || '잠시 후 다시 시도해 주세요.', 'message error'));
    }
  }

  function syncAll() {
    syncNavigation();
    syncDashboardActions();
  }

  injectStyles();

  document.addEventListener('taejang-open-promotion-workspace', event => {
    event.stopImmediatePropagation();
    openPromotion(event.detail?.mode || 'review');
  }, true);

  document.addEventListener('taejang-open-homepage-content', event => {
    event.stopImmediatePropagation();
    openHomepageManagement();
  }, true);

  document.addEventListener('taejang-app-ready', () => setTimeout(syncAll, 120));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(syncAll, 160));

  const observer = new MutationObserver(() => setTimeout(syncAll, 30));
  const start = () => {
    const shell = document.getElementById('desktop-app-shell');
    if (shell) observer.observe(shell, { childList: true, subtree: true });
    if (window.TaejangApp) syncAll();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangPromotionWorkspaceV2Api = { openPromotion, openHomepageManagement, uploadImage };
})();
