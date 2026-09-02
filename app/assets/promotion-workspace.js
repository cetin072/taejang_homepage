(() => {
  'use strict';

  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value || '';
    if (className) node.className = className;
    return node;
  };
  const array = value => Array.isArray(value) ? value : [];
  const lifecycleLabel = {
    draft: '작성 중', review_pending: '승인 대기', needs_revision: '보완 필요',
    approved: '승인 완료', scheduled: '게시 예정', published: '게시 완료',
    hidden: '숨김', archived: '보관'
  };
  const stageLabel = { lead: '홍보팀장', operations: '운영총괄', ceo: '대표이사' };
  let editingContentId = null;

  async function open() {
    const app = window.TaejangApp;
    const main = document.getElementById('dashboard-main');
    if (!app || !main) return;
    main.hidden = false;
    main.replaceChildren(text('p', '홍보 업무를 불러오고 있습니다.', 'message'));
    try {
      const workspace = await app.rpc('get_my_promotion_workspace');
      render(main, workspace || {});
    } catch (error) {
      main.replaceChildren(text('p', app.friendlyError(error), 'message error'));
    }
  }

  function actionButton(label, handler, quiet = false) {
    const button = text('button', label, `button${quiet ? ' button-quiet' : ''}`);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function field(label, control, help) {
    const wrapper = document.createElement('label');
    wrapper.append(text('span', label));
    if (help) wrapper.append(text('small', help, 'field-help'));
    wrapper.append(control);
    return wrapper;
  }

  function input(name, value = '', type = 'text') {
    const control = document.createElement('input');
    control.name = name;
    control.type = type;
    control.value = value || '';
    return control;
  }

  function select(options, value) {
    const control = document.createElement('select');
    options.forEach(([optionValue, optionLabel]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionLabel;
      option.selected = optionValue === value;
      control.append(option);
    });
    return control;
  }

  function mediaMap(publicMedia) {
    const map = new Map();
    array(publicMedia).forEach((item, index) => {
      if (!item || typeof item !== 'object' || !item.url) return;
      const slot = typeof item.slot === 'string' ? item.slot : `PHOTO ${String(index + 1).padStart(2, '0')}`;
      map.set(slot, item.url);
    });
    return map;
  }

  function publicMediaFromForm(form) {
    const items = [];
    for (let index = 1; index <= 11; index += 1) {
      const slot = `PHOTO ${String(index).padStart(2, '0')}`;
      const url = form.elements.namedItem(`photo_${index}`)?.value?.trim();
      if (url) items.push({ slot, kind: 'fixed', url });
    }
    const recent = form.elements.namedItem('recent_photo')?.value?.trim();
    if (recent) items.push({ slot: 'RECENT', kind: 'recent', url: recent });
    return items;
  }

  function previewPanel(item) {
    const panel = document.createElement('section');
    panel.className = 'dashboard-section promotion-preview-panel';
    panel.tabIndex = -1;
    panel.append(text('p', '직원용 미리보기', 'eyebrow'), text('h2', item.title || '제목 없음'));
    if (item.summary) panel.append(text('p', item.summary, 'promotion-preview-summary'));
    const meta = document.createElement('dl');
    meta.className = 'promotion-preview-meta';
    const addMeta = (label, value) => {
      if (!value) return;
      const row = document.createElement('div');
      row.append(text('dt', label), text('dd', value));
      meta.append(row);
    };
    addMeta('작성 표기', item.byline);
    addMeta('관련 기관', item.related_organization);
    addMeta('게시 희망일', item.requested_publish_date);
    if (meta.childElementCount) panel.append(meta);
    if (item.hero_image_url) {
      const image = document.createElement('img');
      image.src = item.hero_image_url;
      image.alt = item.title ? `${item.title} 대표 이미지 미리보기` : '대표 이미지 미리보기';
      image.loading = 'lazy';
      panel.append(image);
    }
    if (item.public_body) panel.append(text('div', item.public_body, 'promotion-preview-body'));
    const media = array(item.public_media);
    if (media.length) {
      const mediaList = document.createElement('ul');
      mediaList.className = 'promotion-media-list';
      media.forEach((entry, index) => {
        const link = document.createElement('a');
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = entry.slot || `게시 사진 ${index + 1}`;
        const li = document.createElement('li');
        li.append(link);
        mediaList.append(li);
      });
      panel.append(text('h3', '게시용 선별 사진'), mediaList);
    }
    panel.append(actionButton('미리보기 닫기', () => panel.remove(), true));
    return panel;
  }

  function showPreview(main, item) {
    main.querySelector('.promotion-preview-panel')?.remove();
    const panel = previewPanel(item);
    main.querySelector('.dashboard-intro')?.after(panel);
    panel.focus();
  }

  function card(item, main, { allowEdit = false } = {}) {
    const node = document.createElement('article');
    node.className = 'dashboard-card promotion-card';
    node.append(
      text('span', lifecycleLabel[item.lifecycle] || '검토', 'status-label'),
      text('h3', item.title),
      text('p', item.requested_publish_date ? `게시 희망일: ${item.requested_publish_date}` : '게시 희망일을 정하지 않았습니다.')
    );
    if (item.summary) node.append(text('p', item.summary));
    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.append(actionButton('미리보기', () => showPreview(main, item), true));
    if (allowEdit && (item.lifecycle === 'draft' || item.lifecycle === 'needs_revision')) {
      actions.append(actionButton(item.lifecycle === 'needs_revision' ? '보완해서 새 수정본 만들기' : '열어 수정', () => {
        editingContentId = item.content_id;
        open();
      }));
      actions.append(actionButton('승인 요청', async () => {
        try {
          await window.TaejangApp.rpc('submit_promotion_revision', { p_content_id: item.content_id });
          editingContentId = null;
          await open();
        } catch (error) {
          window.alert(window.TaejangApp.friendlyError(error));
        }
      }));
    }
    node.append(actions);
    return node;
  }

  async function saveDraft(form, submitAfterSave, existingItem) {
    const value = name => form.elements.namedItem(name)?.value || null;
    const payload = {
      p_content_id: existingItem?.content_id || null,
      p_content_type: value('content_type'),
      p_slug: value('slug'),
      p_title: value('title'),
      p_summary: value('summary'),
      p_public_body: value('public_body'),
      p_external_url: value('external_url'),
      p_byline: value('byline'),
      p_byline_kind: value('byline_kind'),
      p_related_organization: value('related_organization'),
      p_source_reference_url: value('source_reference_url'),
      p_hero_image_url: value('hero_image_url'),
      p_public_media: publicMediaFromForm(form),
      p_people_photo: value('people_photo'),
      p_number_or_amount: value('number_or_amount'),
      p_requested_publish_date: value('requested_publish_date'),
      p_change_reason: existingItem ? '홍보 콘텐츠 보완·수정본 저장' : '홍보 콘텐츠 초안 저장'
    };
    try {
      const saved = await window.TaejangApp.rpc('save_promotion_draft', payload);
      if (submitAfterSave) await window.TaejangApp.rpc('submit_promotion_revision', { p_content_id: saved.content_id });
      editingContentId = submitAfterSave ? null : saved.content_id;
      await open();
    } catch (error) {
      window.alert(window.TaejangApp.friendlyError(error));
    }
  }

  function composer(existingItem = null) {
    const section = document.createElement('section');
    section.className = 'dashboard-section promotion-composer';
    section.append(
      text('h2', existingItem ? '콘텐츠 수정·보완' : '새 콘텐츠 작성'),
      text('p', '중요도와 승인선은 고르지 않아도 됩니다. 사실과 자료를 입력하면 시스템과 관리자가 확인합니다.', 'help')
    );
    if (existingItem?.submitted_at || existingItem?.lifecycle === 'needs_revision') {
      section.append(text('p', '이전 제출본은 보존됩니다. 저장하면 새 수정본으로 이어집니다.', 'message'));
    }
    const form = document.createElement('form');
    form.className = 'promotion-form';
    const grid = document.createElement('div');
    grid.className = 'promotion-form-grid';

    const contentType = select([['homepage_article', '홈페이지 글'], ['external_content', '외부 콘텐츠'], ['press_release', '보도자료']], existingItem?.content_type || 'homepage_article');
    contentType.name = 'content_type';
    const titleInput = input('title', existingItem?.title); titleInput.maxLength = 160; titleInput.required = true;
    const slugInput = input('slug', existingItem?.slug); slugInput.maxLength = 160; slugInput.pattern = '[a-z0-9]+(?:-[a-z0-9]+){0,79}'; slugInput.placeholder = '예: autumn-harvest';
    const bylineKind = select([['company', '회사 명의'], ['ceo', '대표이사 명의'], ['other', '기타 명의']], existingItem?.byline_kind || 'company'); bylineKind.name = 'byline_kind';
    const peoplePhoto = select([['unsure', '잘 모르겠음'], ['yes', '있음'], ['no', '없음']], existingItem?.people_photo || 'unsure'); peoplePhoto.name = 'people_photo';
    const numberAmount = select([['unsure', '잘 모르겠음'], ['yes', '있음'], ['no', '없음']], existingItem?.number_or_amount || 'unsure'); numberAmount.name = 'number_or_amount';
    const requestedDate = input('requested_publish_date', existingItem?.requested_publish_date, 'date');
    grid.append(
      field('글 종류', contentType),
      field('제목', titleInput),
      field('게시 주소(영문·숫자·하이픈)', slugInput),
      field('작성 명의', bylineKind),
      field('사람이 나온 사진', peoplePhoto),
      field('숫자·금액 포함', numberAmount),
      field('게시 희망일', requestedDate)
    );

    const summary = document.createElement('textarea'); summary.name = 'summary'; summary.maxLength = 500; summary.rows = 2; summary.value = existingItem?.summary || '';
    const body = document.createElement('textarea'); body.name = 'public_body'; body.maxLength = 30000; body.rows = 7; body.value = existingItem?.public_body || '';
    const externalUrl = input('external_url', existingItem?.external_url, 'url'); externalUrl.placeholder = 'https://';
    const bylineText = input('byline', existingItem?.byline); bylineText.maxLength = 120;
    const organization = input('related_organization', existingItem?.related_organization); organization.maxLength = 160;
    const sourceUrl = input('source_reference_url', existingItem?.source_reference_url, 'url'); sourceUrl.placeholder = 'https://';
    const heroUrl = input('hero_image_url', existingItem?.hero_image_url, 'url'); heroUrl.placeholder = 'https://';
    form.append(
      grid,
      field('요약', summary),
      field('본문', body),
      field('외부 게시 링크', externalUrl),
      field('작성자 표기', bylineText),
      field('관련 기관', organization),
      field('자료 확인 링크(내부)', sourceUrl, '공개 export에는 포함되지 않습니다.'),
      field('대표 이미지 링크', heroUrl)
    );

    const media = mediaMap(existingItem?.public_media);
    const mediaSection = document.createElement('fieldset');
    mediaSection.className = 'promotion-media-fields';
    mediaSection.append(text('legend', '홈페이지 PHOTO / 최근 활동 대표사진'));
    mediaSection.append(text('p', '원본 전체를 올리지 않고 게시에 쓸 선별 이미지 URL만 연결합니다. 최대 12개입니다.', 'help'));
    const mediaGrid = document.createElement('div');
    mediaGrid.className = 'promotion-media-grid';
    for (let index = 1; index <= 11; index += 1) {
      const slot = `PHOTO ${String(index).padStart(2, '0')}`;
      const control = input(`photo_${index}`, media.get(slot), 'url'); control.placeholder = 'https://';
      mediaGrid.append(field(slot, control));
    }
    const recent = input('recent_photo', media.get('RECENT'), 'url'); recent.placeholder = 'https://';
    mediaGrid.append(field('최근 활동 대표사진', recent));
    mediaSection.append(mediaGrid);
    form.append(mediaSection);

    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.append(
      actionButton(existingItem ? '수정본 저장' : '임시저장', () => { if (form.reportValidity()) saveDraft(form, false, existingItem); }),
      actionButton(existingItem ? '저장 후 다시 승인 요청' : '저장 후 승인 요청', () => { if (form.reportValidity()) saveDraft(form, true, existingItem); })
    );
    if (existingItem) actions.append(actionButton('수정 취소', () => { editingContentId = null; open(); }, true));
    form.append(actions);
    section.append(form);
    return section;
  }

  function reviewComment(action) {
    if (action === 'escalate_to_ceo') {
      const summary = window.prompt('대표이사에게 전달할 핵심 요약을 적어주세요.', '');
      if (summary === null || !summary.trim()) return null;
      const reason = window.prompt('대표이사 확인이 필요한 이유를 적어주세요.', '');
      if (reason === null || !reason.trim()) return null;
      const opinion = window.prompt('운영총괄 검토 의견을 적어주세요.', '');
      if (opinion === null) return null;
      return `요약: ${summary.trim()}\n확인 이유: ${reason.trim()}\n운영총괄 의견: ${opinion.trim() || '별도 의견 없음'}`;
    }
    const message = action === 'changes_requested'
      ? '보완이 필요한 이유를 구체적으로 적어주세요.'
      : action === 'rejected'
        ? '반려 이유를 기록해 주세요.'
        : action.startsWith('escalate_')
          ? '상신 이유를 적어주세요.'
          : '검토 의견(선택)을 적어주세요.';
    const value = window.prompt(message, '');
    if (value === null) return null;
    return value.trim() || null;
  }

  async function review(contentId, action) {
    const comment = reviewComment(action);
    if (comment === null && ['changes_requested', 'rejected', 'escalate_to_operations', 'escalate_to_ceo'].includes(action)) return;
    let revisit = null;
    if (action === 'on_hold') {
      revisit = window.prompt('재확인 날짜를 YYYY-MM-DD 형식으로 적어주세요.', '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(revisit || '')) {
        window.alert('재확인 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
        return;
      }
    }
    try {
      await window.TaejangApp.rpc('review_promotion_revision', {
        p_content_id: contentId, p_action: action, p_comment: comment, p_revisit_at: revisit
      });
      await open();
    } catch (error) {
      window.alert(window.TaejangApp.friendlyError(error));
    }
  }

  function reviewCard(item, role, main) {
    const node = card({ ...item, lifecycle: 'review_pending' }, main);
    node.append(text('p', `현재 단계: ${stageLabel[item.stage] || item.stage || '검토'}`));
    if (role !== 'ceo' && item.required_stage) node.append(text('p', `최소 필요 승인: ${stageLabel[item.required_stage] || item.required_stage}`));
    if (item.people_photo === 'yes' || item.people_photo === 'unsure') node.append(text('p', '인물사진 공개 여부 확인 필요', 'review-warning'));
    if (item.number_or_amount === 'yes' || item.number_or_amount === 'unsure') node.append(text('p', '숫자·금액 확인 필요', 'review-warning'));
    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.append(actionButton('승인', () => review(item.content_id, 'approve')));
    actions.append(actionButton('보완 요청', () => review(item.content_id, 'changes_requested'), true));
    if (role === 'promotion_lead') actions.append(actionButton('운영총괄 상신', () => review(item.content_id, 'escalate_to_operations'), true));
    if (role === 'operations_manager') actions.append(actionButton('대표이사 상신', () => review(item.content_id, 'escalate_to_ceo'), true));
    if (role === 'ceo') actions.append(actionButton('반려', () => review(item.content_id, 'rejected'), true));
    if (role === 'operations_manager' || role === 'ceo') actions.append(actionButton('검토 보류', () => review(item.content_id, 'on_hold'), true));
    node.append(actions);
    return node;
  }

  function scheduleValue(raw) {
    if (!raw?.trim()) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) throw new Error('게시 예약일은 YYYY-MM-DD 형식으로 입력해 주세요.');
    return `${raw.trim()}T00:00:00+09:00`;
  }

  async function queuePublication(contentId) {
    try {
      const raw = window.prompt('게시 예약일이 있으면 YYYY-MM-DD로 입력하세요. 바로 대기함에 넣으려면 비워두세요.', '');
      if (raw === null) return;
      await window.TaejangApp.rpc('queue_promotion_revision', { p_content_id: contentId, p_scheduled_for: scheduleValue(raw) });
      await open();
    } catch (error) {
      window.alert(window.TaejangApp.friendlyError(error));
    }
  }

  function render(main, workspace) {
    const role = workspace.role;
    const intro = document.createElement('header');
    intro.className = 'dashboard-intro';
    intro.append(text('p', '홍보 업무', 'eyebrow'));
    intro.append(text('h2', role === 'promotion_staff' ? '작성과 보완' : '홍보 검토'));
    intro.append(text('p', role === 'promotion_staff'
      ? '중요도나 승인선을 고르지 않아도 됩니다. 사실과 자료를 입력하고 승인 요청하세요.'
      : '역할에 배정된 검토 안건만 표시합니다. 검토 의견은 구체적으로 남겨주세요.'));
    intro.append(actionButton('대시보드로', () => document.dispatchEvent(new Event('taejang-dashboard-refresh')), true));
    main.replaceChildren(intro);

    const mine = array(workspace.my_items);
    const editingItem = mine.find(item => item.content_id === editingContentId) || null;
    if (editingContentId && !editingItem) editingContentId = null;
    if (role === 'promotion_staff') main.append(composer(editingItem));

    const mySection = document.createElement('section');
    mySection.className = 'dashboard-section';
    mySection.append(text('h2', role === 'promotion_staff' ? '내 콘텐츠' : '내가 작성한 콘텐츠'));
    const myGrid = document.createElement('div');
    myGrid.className = 'dashboard-grid';
    if (mine.length) mine.forEach(item => myGrid.append(card(item, main, { allowEdit: role === 'promotion_staff' })));
    else myGrid.append(text('p', '아직 작성한 홍보 콘텐츠가 없습니다.', 'empty'));
    mySection.append(myGrid);
    main.append(mySection);

    if (role === 'promotion_lead') {
      const planning = document.createElement('section');
      planning.className = 'dashboard-section';
      planning.append(text('h2', '신규 사업기획'), text('p', '운영총괄이 공식 요청으로 전환한 항목만 후속 화면에서 연결합니다. 비공식 아이디어는 실행업무로 만들지 않습니다.', 'help'));
      main.append(planning);
    }

    const reviews = array(workspace.review_items);
    const reviewSection = document.createElement('section');
    reviewSection.className = 'dashboard-section';
    reviewSection.append(text('h2', role === 'ceo' ? '대표이사 확인 안건' : '검토 대기 안건'));
    const reviewGrid = document.createElement('div');
    reviewGrid.className = 'dashboard-grid';
    if (reviews.length) reviews.forEach(item => reviewGrid.append(reviewCard(item, role, main)));
    else reviewGrid.append(text('p', '현재 검토 대기 안건이 없습니다.', 'empty'));
    reviewSection.append(reviewGrid);
    main.append(reviewSection);

    if (role === 'promotion_lead') {
      const publicationItems = array(workspace.publication_items);
      const publication = document.createElement('section');
      publication.className = 'dashboard-section';
      publication.append(text('h2', '홈페이지 발행 대기'));
      const publicationGrid = document.createElement('div');
      publicationGrid.className = 'dashboard-grid';
      if (!publicationItems.length) publicationGrid.append(text('p', '현재 최종 승인된 발행 대상이 없습니다.', 'empty'));
      publicationItems.forEach(item => {
        const node = card(item, main);
        const actions = document.createElement('div'); actions.className = 'quick-links';
        if (item.queue_status === 'queued' || item.lifecycle === 'scheduled') {
          actions.append(text('span', item.scheduled_for ? `예약: ${item.scheduled_for}` : '발행 대기함 등록 완료', 'status-label'));
        } else {
          actions.append(actionButton('발행 대기함에 넣기', () => queuePublication(item.content_id)));
        }
        const previewLink = document.createElement('a');
        previewLink.href = '../promotion-preview/';
        previewLink.className = 'button button-quiet';
        previewLink.textContent = '공개 결과 경로 확인';
        actions.append(previewLink);
        node.append(actions);
        publicationGrid.append(node);
      });
      publication.append(publicationGrid);
      main.append(publication);
    }
  }

  document.addEventListener('taejang-open-promotion-workspace', open);
})();
