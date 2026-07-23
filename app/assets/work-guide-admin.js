(() => {
  'use strict';
  let options = null;
  let selected = null;
  const ui = () => window.TaejangAppUi;
  const app = () => window.TaejangApp;
  const e = id => ui().element(id);

  function fill(select, values, blank) {
    select.replaceChildren();
    if (blank !== undefined) select.append(new Option(blank, ''));
    values.forEach(value => select.append(new Option(value.name, value.id)));
  }
  function setAudienceFields() {
    const department = e('guide-audience-scope').value === 'department';
    e('guide-audience-department-wrap').hidden = !department;
    e('guide-audience-department').disabled = !department;
  }
  function longTextWarning() {
    document.querySelectorAll('[data-easy-text]').forEach(field => {
      field.setCustomValidity(field.value.length > 240 || field.value.split(/[.!?。]\s*/).filter(Boolean).length > 3
        ? '설명을 더 짧고 쉬운 문장으로 나누어 적어주세요.' : '');
    });
  }
  function renderPreview() {
    const preview = e('guide-preview'); preview.replaceChildren();
    const title = e('guide-title-input').value || '작업방법 제목';
    preview.append(ui().text('p', '일반 근로자 화면 미리보기', 'card-kicker'), ui().text('h3', title));
    preview.append(ui().imageOrNotice(e('guide-cover-url').value, e('guide-cover-alt').value, '대표 이미지 없음. 글 안내를 확인하세요.'));
    if (e('guide-materials').value) preview.append(ui().text('p', `준비물: ${e('guide-materials').value}`, 'card-body'));
    preview.append(ui().text('p', e('guide-completion').value || '올바른 완성 모습 안내', 'card-body'));
    preview.append(ui().text('p', e('guide-caution').value || '핵심 주의사항 안내', 'caution-note'));
  }
  function stepCard(step) {
    const card = document.createElement('article'); card.className = 'admin-record-card';
    card.append(ui().text('p', `${step.step_order}단계 · ${step.status === 'published' ? '게시' : step.status === 'inactive' ? '사용 중지' : '작성 중'}`, 'card-kicker'), ui().text('h4', step.title), ui().text('p', step.easy_text, 'help'));
    const actions = document.createElement('div'); actions.className = 'form-actions';
    const edit = ui().text('button', '단계 수정', 'button button-quiet'); edit.type = 'button'; edit.addEventListener('click', () => fillStep(step)); actions.append(edit);
    for (const [label, delta] of [['위로', -1], ['아래로', 1]]) {
      const button = ui().text('button', label, 'button button-quiet'); button.type = 'button';
      button.disabled = step.step_order + delta < 1 || step.step_order + delta > selected.steps.length;
      button.addEventListener('click', () => reorder(step.id, delta)); actions.append(button);
    }
    card.append(actions); return card;
  }
  function renderSteps() {
    const list = e('guide-step-list'); list.replaceChildren();
    if (!selected) { list.append(ui().text('p', '기본정보를 저장한 뒤 수정할 작업방법을 선택하세요.', 'empty')); return; }
    if (!selected.steps.length) list.append(ui().text('p', '등록된 단계가 없습니다.', 'empty'));
    selected.steps.forEach(step => list.append(stepCard(step)));
  }
  function fillStep(step) {
    e('guide-step-id').value = step.id; e('guide-step-guide-id').value = selected.guide.id;
    e('guide-step-order').value = step.step_order; e('guide-step-title').value = step.title;
    e('guide-step-easy-text').value = step.easy_text; e('guide-step-image-url').value = step.image_url || '';
    e('guide-step-image-alt').value = step.image_alt || ''; e('guide-step-caution').value = step.caution_text || '';
    e('guide-step-status').value = step.status; e('guide-step-reason').value = '';
    e('guide-step-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function resetStep() { e('guide-step-form').reset(); e('guide-step-id').value = ''; e('guide-step-guide-id').value = selected?.guide.id || ''; e('guide-step-order').value = Math.min((selected?.steps.length || 0) + 1, 7); }
  function fillGuide(guide) {
    const data = guide.guide; e('guide-id').value = data.id; e('guide-department').value = data.department_id;
    e('guide-title-input').value = data.title; e('guide-category').value = data.category; e('guide-format').value = data.guide_format;
    e('guide-audience-scope').value = data.audience_scope; e('guide-audience-department').value = data.audience_department_id || '';
    e('guide-summary').value = data.summary_text || ''; e('guide-materials').value = data.materials_text || ''; e('guide-caution').value = data.caution_text || '';
    e('guide-common-mistakes').value = data.common_mistakes_text || ''; e('guide-completion').value = data.completion_text || '';
    e('guide-contact').value = data.contact_label || ''; e('guide-cover-url').value = data.cover_image_url || ''; e('guide-cover-alt').value = data.cover_image_alt || '';
    e('guide-featured').checked = Boolean(data.is_featured); e('guide-status').value = data.status; e('guide-reason').value = '';
    setAudienceFields(); renderPreview(); e('guide-step-editor').open = true; resetStep(); renderSteps();
  }
  async function selectGuide(id) {
    try { selected = await app().rpc('get_manageable_work_guide_detail', { p_work_guide_id: id }); fillGuide(selected); }
    catch { e('admin-message').textContent = '작업방법을 열 수 없습니다. 권한을 확인하세요.'; }
  }
  async function loadGuides() {
    const list = await app().rpc('list_manageable_work_guides');
    const host = e('guide-manage-list'); host.replaceChildren();
    if (!list.length) host.append(ui().text('p', '관리할 작업방법이 없습니다. 기본정보를 새로 작성하세요.', 'empty'));
    list.forEach(guide => {
      const card = document.createElement('article'); card.className = 'admin-record-card';
      card.append(ui().text('p', `${guide.status === 'published' ? '게시' : guide.status === 'inactive' ? '사용 중지' : '작성 중'} · ${guide.published_step_count}/${guide.step_count}단계 게시`, 'card-kicker'), ui().text('h4', guide.title));
      const button = ui().text('button', '열기·수정', 'button button-quiet'); button.type = 'button'; button.addEventListener('click', () => selectGuide(guide.id)); card.append(button); host.append(card);
    });
  }
  async function submitStep(event) {
    event.preventDefault(); longTextWarning(); if (!event.currentTarget.reportValidity() || !selected) return;
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const result = await app().rpc('save_work_guide_step', {
        p_step_id: e('guide-step-id').value || null, p_work_guide_id: selected.guide.id,
        p_step_order: Number(e('guide-step-order').value), p_title: e('guide-step-title').value,
        p_easy_text: e('guide-step-easy-text').value, p_image_url: e('guide-step-image-url').value,
        p_image_alt: e('guide-step-image-alt').value, p_caution_text: e('guide-step-caution').value,
        p_status: e('guide-step-status').value, p_change_reason: e('guide-step-reason').value
      });
      if (!result.ok) throw new Error(result.code); await selectGuide(selected.guide.id); await loadGuides();
    } catch { e('admin-message').textContent = '단계를 저장하지 못했습니다. 번호·설명·이미지 설명을 확인하세요.'; }
    finally { button.disabled = false; }
  }
  async function reorder(id, delta) {
    const steps = [...selected.steps].sort((a, b) => a.step_order - b.step_order); const index = steps.findIndex(step => step.id === id);
    [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
    const reason = window.prompt('단계 순서 변경 사유를 적으세요.'); if (!reason) return;
    try { const result = await app().rpc('reorder_work_guide_steps', { p_work_guide_id: selected.guide.id, p_step_ids: steps.map(step => step.id), p_change_reason: reason }); if (!result.ok) throw new Error(result.code); await selectGuide(selected.guide.id); }
    catch { e('admin-message').textContent = '순서를 바꾸지 못했습니다. 다시 시도하세요.'; }
  }
  function bind() {
    const records = document.createElement('section'); records.className = 'admin-records'; records.innerHTML = '<h3>작업방법 목록</h3><div id="guide-manage-list" class="card-list"></div>';
    e('guide-form').closest('details').before(records); fill(e('guide-audience-department'), options.departments); setAudienceFields();
    e('guide-audience-scope').addEventListener('change', setAudienceFields);
    e('guide-step-form').addEventListener('submit', submitStep); e('reset-guide-step-form').addEventListener('click', resetStep);
    document.querySelectorAll('[data-easy-text]').forEach(field => field.addEventListener('input', () => { longTextWarning(); renderPreview(); }));
    ['guide-title-input', 'guide-materials', 'guide-caution', 'guide-completion', 'guide-cover-url', 'guide-cover-alt'].forEach(id => e(id).addEventListener('input', renderPreview));
    document.addEventListener('taejang-work-guide-saved', async () => { await loadGuides(); renderPreview(); }); loadGuides(); renderPreview();
  }
  document.addEventListener('taejang-app-ready', async event => {
    if (!app().isTodayManager()) return;
    try { options = await app().rpc('get_today_board_admin_options'); bind(); } catch { /* The existing protected manager panel reports access errors. */ }
  }, { once: true });
})();
