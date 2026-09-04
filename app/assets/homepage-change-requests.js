(() => {
  'use strict';

  const PAGE_CATALOG = {
    home: {
      label: '메인 페이지', href: '../index.html', sections: [
        ['hero', '첫 화면 소개', '.hero-content'],
        ['about', '태장 소개 요약', '#about'],
        ['business', '지금 태장이 하는 일', '#business'],
        ['workplace', '태장의 일터', '#workplace'],
        ['recent_activities', '활동 기록', '#recent-activities, .recent-activities'],
        ['partnership', '협력 안내', '#partnership, .partnership-bridge'],
        ['contact', '문의', '#contact, .contact-section']
      ]
    },
    about: {
      label: '태장 소개', href: '../about.html', sections: [
        ['page_hero', '페이지 상단 소개', '.about-page-hero, .page-hero'],
        ['at_a_glance', '태장 한눈에 보기', '.about-at-a-glance, #at-a-glance'],
        ['name_meaning', '태장이라는 이름', '.name-section, #name-meaning'],
        ['greeting', '대표 인사말', '.greeting, #greeting'],
        ['values', '태장이 일하는 기준', '#values, .values-section'],
        ['history', '태장의 발걸음', '#history, .timeline'],
        ['about_cta', '협력·문의 안내', '.about-cta, .page-cta']
      ]
    },
    business: {
      label: '하는 일', href: '../business.html', sections: [
        ['page_hero', '페이지 상단 소개', '.page-hero'],
        ['current_operations', '현재 운영 사업', '#current-operations, .business-group'],
        ['partnership_flow', '협력 검토 흐름', '#partnership-flow, .partnership-flow'],
        ['business_in_development', '개발 중인 사업', '#business-in-development, .business-preparing']
      ]
    },
    workplace: {
      label: '우리의 일터', href: '../workplace.html', sections: [
        ['page_hero', '페이지 상단 소개', '.page-hero'],
        ['workplace_overview', '직무와 작업 방식', '#workplace-overview, .workplace-work'],
        ['workplace_stories', '일터 이야기', '#workplace-stories, .workplace-stories']
      ]
    },
    archive: {
      label: '소식·기록', href: '../archive.html', sections: [
        ['page_hero', '페이지 상단 소개', '.page-hero'],
        ['archive_list', '기록 목록 안내', '#archive-list, .archive-list, .content-listing']
      ]
    },
    partnership: {
      label: '협력·문의', href: '../partnership.html', sections: [
        ['page_hero', '페이지 상단 소개', '.page-hero'],
        ['partner_companies', '함께 출발한 기업', '#partner-companies, .partner-company-list'],
        ['partnership_fields', '함께하는 방법', '#partnership-fields, .partnership-visual-grid'],
        ['environment_service', '지역사회공헌·ESG 협력', '#environment-service, .environment-service'],
        ['faq', '자주 묻는 협력 질문', '#faq, .faq'],
        ['contact', '협력 문의', '#contact, .contact-layout']
      ]
    }
  };

  const STATUS = { pending: '승인 대기', approved: '최종 승인', changes_requested: '보완 요청', rejected: '반려' };
  const KIND = { text: '글 수정', image: '사진 수정' };
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');

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

  function closeSidebar() {
    const shell = document.getElementById('desktop-app-shell');
    shell?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function field(labelValue, control, help) {
    const label = document.createElement('label');
    label.append(text('span', labelValue));
    if (help) label.append(text('small', help, 'field-help'));
    label.append(control);
    return label;
  }

  function select(options) {
    const node = document.createElement('select');
    options.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      node.append(option);
    });
    return node;
  }

  function input(type = 'text') {
    const node = document.createElement('input');
    node.type = type;
    return node;
  }

  function textarea(rows = 4) {
    const node = document.createElement('textarea');
    node.rows = rows;
    return node;
  }

  function injectPreviewStyles() {
    if (document.querySelector('style[data-homepage-change-preview]')) return;
    const style = document.createElement('style');
    style.dataset.homepageChangePreview = '1';
    style.textContent = `
      .homepage-current-content { min-height:150px; background:#f7f9f7 !important; color:var(--app-text); }
      .homepage-preview-wrap { display:grid; gap:8px; margin:8px 0 2px; }
      .homepage-preview-wrap > strong { color:var(--app-text); }
      .homepage-preview-frame { width:100%; height:500px; border:1px solid var(--app-border); border-radius:12px; background:#fff; }
      .homepage-preview-help { margin:0; color:var(--app-muted); font-size:.86rem; }
      @media(max-width:760px){.homepage-preview-frame{height:380px}}
    `;
    document.head.append(style);
  }

  function currentPageLink(pageKey) {
    const page = PAGE_CATALOG[pageKey];
    const link = document.createElement('a');
    link.href = page.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'button button-quiet';
    link.textContent = '새 창에서 홈페이지 확인';
    return link;
  }

  function requestCard(item, canReview) {
    const card = document.createElement('article');
    card.className = 'dashboard-card wide homepage-change-card';
    const page = PAGE_CATALOG[item.page_key];
    const sectionLabel = page?.sections.find(([key]) => key === item.section_key)?.[1] || item.section_key;
    card.append(
      text('span', STATUS[item.status] || item.status, `status-label${item.status === 'pending' ? '' : ' preparing'}`),
      text('h3', `${page?.label || item.page_key} · ${sectionLabel}`),
      text('p', `${KIND[item.change_kind] || item.change_kind} · 요청자 ${item.requested_by || '홍보팀장'}`)
    );
    if (item.current_summary) card.append(text('p', `현재 내용: ${item.current_summary}`));
    if (item.proposed_text) {
      const proposed = text('p', item.proposed_text, 'homepage-change-proposed');
      proposed.prepend(text('strong', '변경할 글: '));
      card.append(proposed);
    }
    if (item.proposed_image_url) {
      const image = document.createElement('img');
      image.src = item.proposed_image_url;
      image.alt = item.image_alt || '변경 요청 사진 미리보기';
      image.loading = 'lazy';
      image.className = 'homepage-change-image';
      card.append(image);
    }
    card.append(text('p', `수정 이유: ${item.reason}`));
    if (item.decision_comment) card.append(text('p', `검토 의견: ${item.decision_comment}`, 'homepage-change-decision'));

    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.append(currentPageLink(item.page_key));
    if (canReview && item.status === 'pending') {
      actions.append(button('최종 승인', () => reviewRequest(item.id, 'approve')));
      actions.append(button('보완 요청', () => reviewRequest(item.id, 'changes_requested'), true));
      actions.append(button('반려', () => reviewRequest(item.id, 'reject'), true));
    }
    card.append(actions);
    return card;
  }

  async function reviewRequest(id, action) {
    let comment = null;
    if (action !== 'approve') {
      comment = window.prompt(action === 'changes_requested' ? '보완이 필요한 내용을 적어주세요.' : '반려 이유를 적어주세요.', '');
      if (comment === null || !comment.trim()) return;
    } else {
      comment = window.prompt('최종 승인 의견이 있으면 적어주세요. 없으면 비워두세요.', '');
      if (comment === null) return;
    }
    try {
      await app().rpc('review_homepage_change_request', { p_request_id: id, p_action: action, p_comment: comment?.trim() || null });
      await openWorkspace();
    } catch (error) {
      window.alert(app().friendlyError(error));
    }
  }

  function buildLeadForm() {
    injectPreviewStyles();
    const section = document.createElement('section');
    section.className = 'dashboard-section promotion-composer homepage-change-form-wrap';
    section.append(
      text('h2', '홈페이지 글·사진 수정 요청'),
      text('p', '현재 홈페이지를 바로 확인한 뒤 수정할 내용과 수정 이유만 작성합니다. 기존 페이지·섹션 범위 안에서만 변경 요청할 수 있습니다.', 'help')
    );

    const form = document.createElement('form');
    form.className = 'promotion-form';
    const pageSelect = select(Object.entries(PAGE_CATALOG).map(([key, page]) => [key, page.label]));
    const sectionSelect = select(PAGE_CATALOG.home.sections);
    const kindSelect = select([['text', '글 수정'], ['image', '사진 수정']]);
    const current = textarea(6);
    current.maxLength = 2000;
    current.readOnly = true;
    current.classList.add('homepage-current-content');
    current.placeholder = '선택한 영역의 현재 내용을 불러오는 중입니다.';
    const proposedText = textarea(6); proposedText.maxLength = 12000; proposedText.placeholder = '바꿀 문구를 그대로 적어주세요.';
    const imageUrl = input('url'); imageUrl.maxLength = 2000; imageUrl.placeholder = 'https://...';
    const imageAlt = input(); imageAlt.maxLength = 300; imageAlt.placeholder = '사진에 무엇이 보이는지 짧게 설명';
    const reason = textarea(3); reason.maxLength = 1000; reason.required = true; reason.placeholder = '왜 바꾸는지 적어주세요.';
    let currentContentFound = false;

    const pageField = field('페이지', pageSelect);
    const sectionField = field('현재 섹션', sectionSelect, '정해진 섹션만 선택할 수 있습니다.');
    const kindField = field('수정 종류', kindSelect);
    const currentField = field('현재 홈페이지 내용', current, '선택한 섹션의 실제 화면 문구를 자동으로 읽어옵니다. 수정할 수 없는 확인용입니다.');
    const textField = field('수정할 내용', proposedText);
    const imageField = field('수정할 사진 URL', imageUrl, '직접 파일 업로드는 안전한 사진 저장소를 붙인 뒤 추가합니다.');
    const altField = field('사진 설명', imageAlt);
    const reasonField = field('수정 이유', reason);
    const pageLinkSlot = document.createElement('div');
    pageLinkSlot.className = 'quick-links';

    const previewWrap = document.createElement('div');
    previewWrap.className = 'homepage-preview-wrap';
    previewWrap.append(text('strong', '화면 미리보기'));
    const previewHelp = text('p', '선택한 영역을 초록색 테두리로 표시합니다. 화면이 로드된 뒤 현재 문구도 자동으로 채워집니다.', 'homepage-preview-help');
    const preview = document.createElement('iframe');
    preview.className = 'homepage-preview-frame';
    preview.title = '현재 홈페이지 화면 미리보기';
    preview.loading = 'eager';
    previewWrap.append(previewHelp, preview);

    function selectedSection() {
      return PAGE_CATALOG[pageSelect.value]?.sections.find(([key]) => key === sectionSelect.value) || null;
    }

    function normalizeCurrentText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    }

    function readPreviewSection() {
      currentContentFound = false;
      current.value = '';
      try {
        const doc = preview.contentDocument;
        if (!doc) throw new Error('PREVIEW_NOT_READY');
        doc.querySelectorAll('[data-taejang-change-preview-highlight]').forEach(node => {
          node.style.outline = '';
          node.style.outlineOffset = '';
          delete node.dataset.taejangChangePreviewHighlight;
        });
        const entry = selectedSection();
        const selector = entry?.[2];
        const target = (selector && doc.querySelector(selector)) || doc.getElementById(sectionSelect.value);
        if (!target) {
          current.value = '선택한 영역의 문구를 자동으로 찾지 못했습니다. 아래 미리보기 또는 새 창에서 현재 화면을 확인해 주세요.';
          return;
        }
        target.dataset.taejangChangePreviewHighlight = '1';
        target.style.outline = '4px solid #2D6A4F';
        target.style.outlineOffset = '-4px';
        target.scrollIntoView({ block: 'center', behavior: 'auto' });
        const value = normalizeCurrentText(target.innerText || target.textContent);
        if (value) {
          current.value = value;
          currentContentFound = true;
        } else {
          current.value = '현재 영역에 자동으로 읽을 수 있는 문구가 없습니다. 사진 수정이라면 미리보기 화면을 기준으로 확인해 주세요.';
        }
      } catch {
        current.value = '현재 내용을 자동으로 읽지 못했습니다. 새 창에서 홈페이지를 확인해 주세요.';
      }
    }

    function loadPreview() {
      const page = PAGE_CATALOG[pageSelect.value];
      currentContentFound = false;
      current.value = '현재 홈페이지 내용을 불러오는 중입니다.';
      preview.src = page.href;
      pageLinkSlot.replaceChildren(currentPageLink(pageSelect.value));
    }

    function updateSections() {
      const page = PAGE_CATALOG[pageSelect.value];
      sectionSelect.replaceChildren();
      page.sections.forEach(([key, label]) => {
        const option = document.createElement('option'); option.value = key; option.textContent = label; sectionSelect.append(option);
      });
      loadPreview();
    }

    function updateKind() {
      const isText = kindSelect.value === 'text';
      textField.hidden = !isText;
      imageField.hidden = isText;
      altField.hidden = isText;
      proposedText.required = isText;
      imageUrl.required = !isText;
    }

    preview.addEventListener('load', () => setTimeout(readPreviewSection, 450));
    pageSelect.addEventListener('change', updateSections);
    sectionSelect.addEventListener('change', readPreviewSection);
    kindSelect.addEventListener('change', updateKind);
    updateSections(); updateKind();

    const grid = document.createElement('div');
    grid.className = 'promotion-form-grid';
    grid.append(pageField, sectionField, kindField);
    form.append(grid, pageLinkSlot, previewWrap, currentField, textField, imageField, altField, reasonField);
    const actions = document.createElement('div'); actions.className = 'quick-links';
    actions.append(button('운영총괄에게 수정 요청', async () => {
      if (!form.reportValidity()) return;
      try {
        await app().rpc('create_homepage_change_request', {
          p_page_key: pageSelect.value,
          p_section_key: sectionSelect.value,
          p_change_kind: kindSelect.value,
          p_current_summary: currentContentFound ? current.value.trim() || null : null,
          p_proposed_text: kindSelect.value === 'text' ? proposedText.value.trim() : null,
          p_proposed_image_url: kindSelect.value === 'image' ? imageUrl.value.trim() : null,
          p_image_alt: kindSelect.value === 'image' ? imageAlt.value.trim() || null : null,
          p_reason: reason.value.trim()
        });
        await openWorkspace();
      } catch (error) {
        window.alert(app().friendlyError(error));
      }
    }));
    form.append(actions);
    section.append(form);
    return section;
  }

  async function openWorkspace() {
    const target = main();
    const currentRoute = route();
    if (!target || !['promotion_lead', 'operations_manager'].includes(currentRoute)) return;
    closeSidebar();
    document.getElementById('desktop-page-title').textContent = '홈페이지 내용 관리';
    target.replaceChildren(text('p', '홈페이지 수정 요청을 불러오고 있습니다.', 'message'));
    try {
      const requests = await app().rpc('get_homepage_change_requests');
      const intro = document.createElement('header'); intro.className = 'dashboard-intro';
      intro.append(
        text('p', '홈페이지 운영', 'eyebrow'),
        text('h2', currentRoute === 'promotion_lead' ? '글·사진 수정 요청' : '홈페이지 수정 최종 승인'),
        text('p', currentRoute === 'promotion_lead'
          ? '현재 홈페이지 화면과 기존 문구를 확인한 뒤 변경할 내용과 이유를 요청합니다.'
          : '홍보팀장이 요청한 현재 내용·변경안·수정 이유를 비교해 최종 검토합니다. 홈페이지 구조 변경은 이 화면의 대상이 아닙니다.')
      );
      target.replaceChildren(intro);
      if (currentRoute === 'promotion_lead') target.append(buildLeadForm());

      const listSection = document.createElement('section'); listSection.className = 'dashboard-section';
      const list = Array.isArray(requests) ? requests : [];
      const pending = list.filter(item => item.status === 'pending');
      listSection.append(text('h2', currentRoute === 'operations_manager' ? `승인 대기 ${pending.length}건` : '내 수정 요청'));
      const grid = document.createElement('div'); grid.className = 'dashboard-grid';
      const visible = currentRoute === 'operations_manager' ? [...pending, ...list.filter(item => item.status !== 'pending')] : list;
      if (!visible.length) grid.append(text('p', '현재 홈페이지 글·사진 수정 요청이 없습니다.', 'empty'));
      visible.forEach(item => grid.append(requestCard(item, currentRoute === 'operations_manager')));
      listSection.append(grid); target.append(listSection);
    } catch (error) {
      target.replaceChildren(text('p', app().friendlyError(error), 'message error'));
    }
  }

  function addNavigation(event) {
    const currentRoute = event.detail?.route;
    if (!['promotion_lead', 'operations_manager'].includes(currentRoute)) return;
    queueMicrotask(() => {
      const nav = document.getElementById('app-nav');
      if (!nav || nav.querySelector('[data-homepage-content-nav]')) return;
      const node = button('홈페이지 내용 관리', openWorkspace);
      node.removeAttribute('class');
      node.dataset.homepageContentNav = '1';
      const homepage = [...nav.querySelectorAll('a')].find(link => link.textContent.trim() === '홈페이지');
      if (homepage) nav.insertBefore(node, homepage); else nav.append(node);
    });
  }

  document.addEventListener('taejang-app-ready', addNavigation);
  document.addEventListener('taejang-open-homepage-content', openWorkspace);
  window.TaejangHomepageContent = { open: openWorkspace };
})();