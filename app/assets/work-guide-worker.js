(() => {
  'use strict';
  const CATEGORY = {
    all: '전체', today: '오늘 하는 작업', featured: '자주 보는 작업',
    packing: '포장', inspection: '검수', organization: '정리', safety: '안전', company_life: '회사생활'
  };
  let fromToday = false;
  let currentGuide = null;
  let currentStep = 0;
  const ui = () => window.TaejangAppUi;
  const app = () => window.TaejangApp;

  function showScreen(name) {
    ui().element('general-worker-board').hidden = name !== 'today';
    ui().element('work-guide-screen').hidden = name === 'today';
    ui().element('work-guide-list-view').hidden = name !== 'list';
    ui().element('work-guide-detail-view').hidden = name !== 'detail';
    if (name !== 'today') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function card(guide) {
    const article = document.createElement('article');
    article.className = 'guide-card';
    article.append(ui().imageOrNotice(guide.cover_image_url, guide.cover_image_alt, '대표 이미지 없음'));
    const content = ui().text('div', '', 'guide-card-content');
    content.append(ui().text('p', `${CATEGORY[guide.category] || '작업방법'}${guide.is_today ? ' · 오늘 업무' : ''}`, 'card-kicker'));
    content.append(ui().text('h2', guide.title));
    if (guide.summary) content.append(ui().text('p', guide.summary, 'card-body'));
    content.append(ui().text('p', `최종 수정 ${new Intl.DateTimeFormat('ko-KR').format(new Date(guide.updated_at))}`, 'help'));
    const button = ui().text('button', '작업방법 보기', 'button');
    button.type = 'button';
    button.addEventListener('click', () => openDetail(guide.id));
    content.append(button); article.append(content); return article;
  }

  async function loadList(filter = 'all') {
    ui().message('work-guide-message', '작업방법을 불러오고 있습니다.');
    ui().clear('work-guide-list');
    try {
      const params = { p_category: null, p_today_only: filter === 'today', p_featured_only: filter === 'featured' };
      if (CATEGORY[filter] && !['all', 'today', 'featured'].includes(filter)) params.p_category = filter;
      const guides = await app().rpc('get_my_work_guide_list', params);
      ui().message('work-guide-message', '');
      if (!guides.length) {
        ui().element('work-guide-list').append(ui().text('p', '지금 볼 수 있는 작업방법이 없습니다. 담당 반장에게 확인하세요.', 'empty'));
        return;
      }
      guides.forEach(guide => ui().element('work-guide-list').append(card(guide)));
    } catch {
      ui().message('work-guide-message', '작업방법을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true);
    }
  }

  function detailMeta(label, value) {
    const row = document.createElement('div');
    row.className = 'task-meta-row';
    row.append(ui().text('dt', label), ui().text('dd', value || '등록되지 않음'));
    return row;
  }

  function renderStep() {
    const steps = currentGuide.steps || [];
    const box = ui().element('work-guide-step');
    box.replaceChildren();
    if (!steps.length) {
      box.append(ui().text('p', '등록된 작업순서가 없습니다. 담당 반장에게 확인하세요.', 'empty'));
      ui().element('guide-prev').disabled = true; ui().element('guide-next').disabled = true;
      ui().element('guide-step-status').textContent = '작업순서 없음'; return;
    }
    const step = steps[currentStep];
    ui().element('guide-step-status').textContent = `${currentStep + 1} / ${steps.length} 단계`;
    const heading = ui().text('h2', `${step.step_order}. ${step.title}`);
    heading.tabIndex = -1;
    box.append(heading, ui().imageOrNotice(step.image_url, step.image_alt, '단계 이미지 없음. 아래 글을 확인하세요.'), ui().text('p', step.easy_text, 'step-easy-text'));
    if (step.caution) box.append(ui().text('p', `주의: ${step.caution}`, 'caution-note'));
    ui().element('guide-prev').disabled = currentStep === 0;
    ui().element('guide-next').disabled = currentStep === steps.length - 1;
  }

  function renderDetail() {
    const guide = currentGuide;
    ui().element('work-guide-detail-title').textContent = guide.title;
    const intro = ui().element('work-guide-intro'); intro.replaceChildren();
    intro.append(ui().imageOrNotice(guide.cover_image_url, guide.cover_image_alt, '대표 이미지 없음. 글 안내를 확인하세요.'));
    if (guide.summary) intro.append(ui().text('p', guide.summary, 'card-body'));
    const meta = document.createElement('dl'); meta.className = 'task-meta';
    meta.append(detailMeta('준비물', guide.materials), detailMeta('담당자', guide.contact_label), detailMeta('최종 수정일', new Intl.DateTimeFormat('ko-KR').format(new Date(guide.updated_at))));
    intro.append(meta); renderStep();
    const final = ui().element('work-guide-final'); final.replaceChildren();
    final.append(ui().text('h2', '올바른 완성 모습'));
    final.append(ui().text('p', guide.completion || '완성 모습 안내가 등록되지 않았습니다. 담당 반장에게 확인하세요.', 'card-body'));
    final.append(ui().text('h2', '핵심 주의사항'));
    final.append(ui().text('p', guide.caution || '등록된 주의사항이 없습니다. 담당 반장에게 확인하세요.', 'caution-note'));
    final.append(ui().text('h2', '자주 하는 실수'));
    final.append(ui().text('p', guide.common_mistakes || '등록된 실수 안내가 없습니다.', 'card-body'));
  }

  async function openDetail(id, options = {}) {
    fromToday = Boolean(options.fromToday);
    showScreen('detail'); ui().message('work-guide-detail-message', '작업방법을 불러오고 있습니다.');
    try {
      currentGuide = await app().rpc('get_my_work_guide_detail', { p_work_guide_id: id });
      currentStep = 0; ui().message('work-guide-detail-message', ''); renderDetail();
    } catch {
      ui().message('work-guide-detail-message', '이 작업방법은 지금 볼 수 없습니다. 담당 반장에게 확인하세요.', true);
    }
  }

  function bind() {
    ui().element('open-work-guide-list').addEventListener('click', () => { showScreen('list'); loadList(); });
    ui().element('back-to-today').addEventListener('click', () => showScreen('today'));
    ui().element('back-to-guide-list').addEventListener('click', () => { showScreen('list'); loadList(); });
    ui().element('back-from-detail-today').addEventListener('click', () => showScreen(fromToday ? 'today' : 'list'));
    ui().element('guide-restart').addEventListener('click', () => { currentStep = 0; renderStep(); ui().element('work-guide-step').querySelector('h2')?.focus(); });
    ui().element('guide-prev').addEventListener('click', () => { if (currentStep > 0) { currentStep -= 1; renderStep(); } });
    ui().element('guide-next').addEventListener('click', () => { if (currentStep < (currentGuide.steps?.length || 1) - 1) { currentStep += 1; renderStep(); } });
    ui().element('work-guide-filters').addEventListener('click', event => {
      const button = event.target.closest('button[data-filter]'); if (!button) return;
      ui().element('work-guide-filters').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      loadList(button.dataset.filter);
    });
    window.TaejangWorkGuides = { openDetail };
  }
  document.addEventListener('taejang-app-ready', event => { if (event.detail.route === 'general_worker') bind(); }, { once: true });
})();
