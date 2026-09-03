(() => {
  'use strict';

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
  const summaryFromBody = body => (body || '').replace(/\s+/g, ' ').trim().slice(0, 220) || null;
  const containsNumbers = body => /\d|%|₩|원|만원|억원/.test(body || '') ? 'yes' : 'no';
  const makeSlug = () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
    return `post-${date}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
  };

  function injectStyles() {
    if (document.querySelector('style[data-operations-promotion-writer]')) return;
    const style = document.createElement('style');
    style.dataset.operationsPromotionWriter = '1';
    style.textContent = `
      .operations-writer { max-width:980px; padding:22px; border:1px solid var(--app-border); border-radius:16px; background:#fff; }
      .operations-writer form { display:grid; gap:16px; }
      .operations-writer label { display:grid; gap:7px; font-weight:800; }
      .operations-writer input,.operations-writer select,.operations-writer textarea { width:100%; min-height:46px; padding:11px 12px; border:1px solid var(--app-border); border-radius:10px; background:#fff; color:var(--app-text); font:inherit; }
      .operations-writer textarea { min-height:280px; resize:vertical; line-height:1.7; }
      .operations-writer-media { display:grid; gap:10px; padding:14px; border:1px solid var(--app-border); border-radius:12px; background:#f8faf9; }
      .operations-writer-media img { width:min(100%,520px); max-height:340px; object-fit:cover; border-radius:10px; }
      .operations-writer-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
      .operations-writer-card { padding:18px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .operations-writer-card h3 { margin:6px 0 8px; }
      @media(max-width:760px){.operations-writer-list{grid-template-columns:1fr}.operations-writer textarea{min-height:220px}}
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

  function editable(item) {
    return ['draft', 'needs_revision'].includes(item?.lifecycle);
  }

  async function openWriter(editingId = null) {
    const target = prepareWorkspace();
    if (!target || route() !== 'operations_manager') return;
    document.getElementById('desktop-page-title').textContent = '홍보 글 작성';
    target.replaceChildren(el('p', '작성 화면을 불러오고 있습니다.', 'message'));

    try {
      const workspace = await app().rpc('get_my_promotion_workspace');
      const mine = Array.isArray(workspace?.my_items) ? workspace.my_items : [];
      const current = editingId ? mine.find(item => item.content_id === editingId) : null;
      if (editingId && (!current || !editable(current))) {
        window.alert('현재 수정할 수 없는 글입니다.');
        return openWriter();
      }

      const intro = el('header', null, 'dashboard-intro');
      intro.append(el('p', '운영총괄 · 선택 업무', 'eyebrow'), el('h2', current ? '내 홍보 글 수정' : '홍보 글 작성'), el('p', '태장 소식·외부 링크·보도자료를 직접 작성할 수 있습니다. 저장 후 승인 요청하면 기존 운영팀장 검토 흐름으로 전달됩니다.'));

      const section = el('section', null, 'operations-writer');
      const form = document.createElement('form');
      form.addEventListener('submit', event => event.preventDefault());
      const type = select([
        ['homepage_article', '태장 소식'],
        ['external_content', '외부 기사·콘텐츠'],
        ['press_release', '보도자료']
      ]);
      type.value = current?.content_type || 'homepage_article';
      const title = input(); title.maxLength = 160; title.value = current?.title || ''; title.placeholder = '제목을 입력하세요';
      const external = input('url'); external.maxLength = 1000; external.value = current?.external_url || ''; external.placeholder = 'https://...';
      const date = input('date'); date.value = current?.requested_publish_date || '';
      const body = document.createElement('textarea'); body.maxLength = 30000; body.value = current?.public_body || ''; body.placeholder = '본문을 입력하세요.';
      const externalWrap = field('외부 링크', external, '외부 기사·콘텐츠를 선택했을 때만 사용합니다.');

      const mediaBox = el('div', null, 'operations-writer-media');
      const file = input('file'); file.accept = 'image/jpeg,image/png,image/webp,image/gif';
      const alt = input(); alt.maxLength = 300; alt.placeholder = '사진 설명';
      let imageUrl = current?.hero_image_url || null;
      const currentMedia = Array.isArray(current?.public_media) ? current.public_media : [];
      if (!imageUrl && currentMedia[0]?.url) imageUrl = currentMedia[0].url;
      alt.value = currentMedia.find(item => item?.url === imageUrl)?.alt || '';
      const preview = el('div');
      const status = el('p', imageUrl ? '현재 대표사진이 있습니다. 새 파일을 고르면 교체됩니다.' : '사진은 선택사항입니다.', 'field-help');
      const renderPreview = () => {
        preview.replaceChildren();
        if (!imageUrl) return;
        const image = document.createElement('img'); image.src = imageUrl; image.alt = alt.value || '대표사진';
        preview.append(image);
      };
      renderPreview();
      file.addEventListener('change', async () => {
        const selected = file.files?.[0];
        if (!selected) return;
        file.disabled = true;
        status.textContent = '사진을 업로드하고 있습니다.';
        try {
          const uploader = window.TaejangPromotionWorkspaceV2Api?.uploadImage;
          if (!uploader) throw new Error('사진 업로드 기능을 불러오지 못했습니다.');
          imageUrl = await uploader(selected);
          if (!alt.value.trim()) alt.value = selected.name.replace(/\.[^.]+$/, '');
          renderPreview();
          status.textContent = '사진 업로드 완료';
        } catch (error) {
          status.textContent = '사진 업로드 실패';
          window.alert(error.message || '사진을 업로드하지 못했습니다.');
        } finally { file.disabled = false; file.value = ''; }
      });
      mediaBox.append(field('대표사진', file, 'JPG, PNG, WEBP, GIF · 8MB 이하'), field('사진 설명', alt), status, preview);

      const updateType = () => { externalWrap.hidden = type.value !== 'external_content'; };
      type.addEventListener('change', updateType);
      updateType();
      form.append(field('글 종류', type), field('제목', title), externalWrap, field('게시 희망일 (선택)', date), field('본문', body), mediaBox);

      const save = async submit => {
        if (!title.value.trim()) return window.alert('제목을 입력해 주세요.');
        if (type.value !== 'external_content' && !body.value.trim() && !imageUrl) return window.alert('본문이나 사진을 입력해 주세요.');
        if (type.value === 'external_content' && !external.value.trim()) return window.alert('외부 링크를 입력해 주세요.');
        const media = imageUrl ? [{ url: imageUrl, kind: 'selected', alt: alt.value.trim() || undefined }] : [];
        const payload = {
          p_content_id: current?.content_id || null,
          p_content_type: type.value,
          p_slug: current?.slug || makeSlug(),
          p_title: title.value.trim(),
          p_summary: summaryFromBody(body.value),
          p_public_body: body.value.trim() || null,
          p_external_url: type.value === 'external_content' ? external.value.trim() : null,
          p_byline: null,
          p_byline_kind: 'company',
          p_related_organization: null,
          p_source_reference_url: type.value === 'external_content' ? external.value.trim() : null,
          p_hero_image_url: imageUrl,
          p_public_media: media,
          p_people_photo: imageUrl ? 'unsure' : 'no',
          p_number_or_amount: containsNumbers(body.value),
          p_requested_publish_date: date.value || null,
          p_change_reason: current ? '운영총괄 홍보 콘텐츠 수정' : '운영총괄 홍보 콘텐츠 작성'
        };
        try {
          const saved = await app().rpc('save_operations_promotion_draft', payload);
          if (submit) await app().rpc('submit_operations_promotion_revision', { p_content_id: saved.content_id });
          await openWriter();
        } catch (error) {
          window.alert(app().friendlyError?.(error) || error.message || '저장하지 못했습니다.');
        }
      };

      const actions = el('div', null, 'quick-links');
      actions.append(button(current ? '수정본 저장' : '임시저장', () => save(false)), button('저장 후 승인 요청', () => save(true)));
      if (current) actions.append(button('새 글 작성', () => openWriter(), true));
      form.append(actions);
      section.append(form);

      const listSection = el('section', null, 'dashboard-section');
      listSection.append(el('h2', '내 작성 글'));
      const list = el('div', null, 'operations-writer-list');
      const visible = mine.filter(item => item.lifecycle !== 'archived').slice(0, 20);
      if (!visible.length) list.append(el('p', '아직 운영총괄이 직접 작성한 글이 없습니다.', 'empty'));
      visible.forEach(item => {
        const card = el('article', null, 'operations-writer-card');
        card.append(el('span', item.lifecycle === 'draft' ? '작성 중' : item.lifecycle === 'needs_revision' ? '보완 필요' : item.lifecycle === 'review_pending' ? '승인 대기' : item.lifecycle === 'published' ? '게시 완료' : item.lifecycle, 'status-label'), el('h3', item.title || '제목 없음'));
        if (editable(item)) card.append(button('열어 수정', () => openWriter(item.content_id), true));
        list.append(card);
      });
      listSection.append(list);
      target.replaceChildren(intro, section, listSection);
    } catch (error) {
      target.replaceChildren(el('p', app().friendlyError?.(error) || '작성 화면을 불러오지 못했습니다.', 'message error'));
    }
  }

  function addNavigation() {
    if (route() !== 'operations_manager') return;
    const nav = document.getElementById('app-nav');
    if (!nav || nav.querySelector('[data-operations-promotion-writer]')) return;
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = '홍보 글 작성';
    node.dataset.operationsPromotionWriter = '1';
    node.addEventListener('click', () => openWriter());
    const review = [...nav.querySelectorAll('button')].find(item => item.textContent.trim() === '홍보 검토');
    if (review) nav.insertBefore(node, review.nextSibling);
    else nav.append(node);
  }

  function sync() { setTimeout(addNavigation, 140); }
  injectStyles();
  document.addEventListener('taejang-app-ready', sync);
  document.addEventListener('taejang-dashboard-refresh', sync);
  const observer = new MutationObserver(addNavigation);
  const start = () => {
    const nav = document.getElementById('app-nav');
    if (nav) observer.observe(nav, { childList: true });
    addNavigation();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOperationsPromotionWriter = { open: openWriter };
})();
