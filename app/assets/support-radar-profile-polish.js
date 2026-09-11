(() => {
  'use strict';

  const allowedRoles = new Set(['operations_manager', 'ceo']);
  const state = {
    observer: null,
    profileLoading: false,
    editorForm: null,
    inputBaseline: new WeakMap(),
    initialRowCounts: null,
    editorObserver: null
  };
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value ?? '';
    return node;
  };
  const array = value => Array.isArray(value) ? value : [];
  const canUse = () => allowedRoles.has(window.TaejangApp?.getRoute?.());
  const canEdit = () => window.TaejangApp?.getRoute?.() === 'operations_manager';

  function isProfileSurface(root) {
    const heading = root?.querySelector('h2');
    return heading && (heading.textContent === '기업 프로필' || /기업 프로필 v\d+ 수정/.test(heading.textContent) || heading.textContent === '첫 기업 프로필 만들기');
  }

  function qualificationState(item) {
    const status = item?.status || 'unknown';
    if (status === 'expired') return { rank: 0, label: '만료', className: 'support-radar-warning' };
    if (status === 'missing') return { rank: 1, label: '현재 없음', className: 'support-radar-warning' };
    if (status === 'planned') return { rank: 2, label: '취득 예정', className: 'support-radar-note' };
    if (status === 'unknown') return { rank: 3, label: '확인 필요', className: 'support-radar-warning' };
    if (status === 'valid' && item.valid_until) {
      const end = new Date(`${item.valid_until}T23:59:59+09:00`);
      const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
      if (Number.isFinite(days) && days < 0) return { rank: 0, label: '유효기간 경과', className: 'support-radar-warning' };
      if (Number.isFinite(days) && days <= 60) return { rank: 1, label: `${Math.max(days, 0)}일 후 만료`, className: 'support-radar-warning' };
    }
    return null;
  }

  async function injectQualificationHealth() {
    if (!canUse() || state.profileLoading) return;
    const root = el('dashboard-main')?.querySelector('.support-radar-shell');
    if (!root || !isProfileSurface(root) || root.querySelector('form.support-radar-form') || root.querySelector('[data-support-profile-health]')) return;
    state.profileLoading = true;
    try {
      const data = await window.TaejangApp.rpc('support_get_company_profile');
      if (!data?.profile) return;
      const items = array(data.qualifications)
        .map(item => ({ item, state: qualificationState(item) }))
        .filter(entry => entry.state)
        .sort((a, b) => a.state.rank - b.state.rank);

      const section = document.createElement('section');
      section.className = 'support-radar-section';
      section.dataset.supportProfileHealth = '1';
      section.append(text('h3', '자격·확인서 점검'));
      section.append(text('p', '만료·미보유·취득예정·확인필요 항목을 먼저 보여줍니다. 중요한 자격이 바뀌면 기업 프로필을 바로 업데이트하세요.', 'support-radar-muted'));

      if (!items.length) {
        section.append(text('p', '현재 즉시 확인할 자격·확인서 항목이 없습니다.', 'support-radar-success'));
      } else {
        const list = document.createElement('div');
        list.className = 'support-radar-list';
        items.forEach(({ item, state: itemState }) => {
          const card = document.createElement('article');
          card.className = 'support-radar-row';
          const header = document.createElement('div');
          header.className = 'support-radar-header';
          header.append(text('strong', item.name || item.code || '자격·확인서'), text('span', itemState.label, itemState.className));
          card.append(header);
          if (item.valid_until) card.append(text('p', `유효 종료일 ${item.valid_until}`, 'support-radar-muted'));
          if (item.evidence_summary) card.append(text('p', item.evidence_summary, 'support-radar-muted'));
          list.append(card);
        });
        section.append(list);
      }

      if (canEdit()) {
        const edit = text('button', '기업 프로필에서 바로 수정', 'button button-quiet');
        edit.type = 'button';
        edit.addEventListener('click', () => {
          const existing = [...root.querySelectorAll('button')].find(node => node.textContent === '기업 프로필 수정');
          existing?.click();
        });
        section.append(edit);
      }

      const summary = root.querySelector('.support-radar-summary');
      if (summary) summary.insertAdjacentElement('afterend', section);
      else root.append(section);
    } catch {
      // Profile itself remains usable if the convenience panel cannot be loaded.
    } finally {
      state.profileLoading = false;
    }
  }

  function fieldLabel(input) {
    const label = input.closest('label');
    const explicit = label?.querySelector(':scope > span')?.textContent?.trim();
    return explicit || input.name || '항목';
  }

  function inputValue(input) {
    if (input.type === 'checkbox' || input.type === 'radio') return input.checked ? '1' : '0';
    return String(input.value ?? '');
  }

  function rowCounts(form) {
    const result = {};
    form.querySelectorAll('.support-radar-row[data-kind]').forEach(row => {
      result[row.dataset.kind] = (result[row.dataset.kind] || 0) + 1;
    });
    return result;
  }

  function rowKindLabel(kind) {
    return ({
      location: '사업장·농장',
      qualification: '자격·확인서',
      business_area: '사업분야',
      partner: '협력기관',
      benefit: '수혜사업'
    })[kind] || kind;
  }

  function captureNewInputs(form) {
    form.querySelectorAll('input, select, textarea').forEach(input => {
      if (!state.inputBaseline.has(input)) state.inputBaseline.set(input, inputValue(input));
    });
  }

  function renderChangeSummary(form, panel) {
    captureNewInputs(form);
    const changedLabels = [];
    form.querySelectorAll('input, select, textarea').forEach(input => {
      if (input.name === 'change_reason') return;
      if (state.inputBaseline.get(input) !== inputValue(input)) changedLabels.push(fieldLabel(input));
    });

    const currentRows = rowCounts(form);
    const rowChanges = [];
    const kinds = new Set([...Object.keys(state.initialRowCounts || {}), ...Object.keys(currentRows)]);
    kinds.forEach(kind => {
      const before = state.initialRowCounts?.[kind] || 0;
      const after = currentRows[kind] || 0;
      if (before !== after) rowChanges.push(`${rowKindLabel(kind)} ${before}→${after}건`);
    });

    const uniqueLabels = [...new Set(changedLabels)];
    const parts = [];
    if (uniqueLabels.length) {
      const visible = uniqueLabels.slice(0, 8);
      parts.push(`수정: ${visible.join(', ')}${uniqueLabels.length > visible.length ? ` 외 ${uniqueLabels.length - visible.length}개` : ''}`);
    }
    if (rowChanges.length) parts.push(`항목 수 변경: ${rowChanges.join(', ')}`);

    panel.replaceChildren(
      text('strong', '저장 전 변경내용 요약'),
      text('p', parts.length ? parts.join(' · ') : '아직 변경된 항목이 없습니다.', parts.length ? 'support-radar-note' : 'support-radar-muted')
    );
  }

  function bindEditorSummary() {
    if (!canEdit()) return;
    const root = el('dashboard-main')?.querySelector('.support-radar-shell');
    const form = root?.querySelector('form.support-radar-form');
    if (!root || !form || !isProfileSurface(root) || form.dataset.profileChangeSummaryBound === '1') return;

    form.dataset.profileChangeSummaryBound = '1';
    state.editorForm = form;
    state.inputBaseline = new WeakMap();
    captureNewInputs(form);
    state.initialRowCounts = rowCounts(form);

    const panel = document.createElement('div');
    panel.className = 'support-radar-note';
    panel.dataset.supportProfileChangeSummary = '1';
    const saveSections = [...form.querySelectorAll('.support-radar-section')];
    const saveSection = saveSections[saveSections.length - 1];
    const actions = saveSection?.querySelector('.form-actions');
    if (actions) saveSection.insertBefore(panel, actions);
    else form.append(panel);
    renderChangeSummary(form, panel);

    const update = () => renderChangeSummary(form, panel);
    form.addEventListener('input', update);
    form.addEventListener('change', update);

    state.editorObserver?.disconnect();
    state.editorObserver = new MutationObserver(mutations => {
      const selfOnly = mutations.every(mutation =>
        mutation.target === panel || panel.contains(mutation.target)
      );
      if (selfOnly) return;
      captureNewInputs(form);
      update();
    });
    state.editorObserver.observe(form, { childList: true, subtree: true });
  }

  function inspectSurface() {
    injectQualificationHealth();
    bindEditorSummary();
  }

  function setup() {
    if (!canUse()) return;
    const main = el('dashboard-main');
    if (!main) return;
    inspectSurface();
    if (state.observer) return;
    state.observer = new MutationObserver(() => queueMicrotask(inspectSurface));
    state.observer.observe(main, { childList: true, subtree: true });
  }

  document.addEventListener('taejang-app-ready', setup);
  document.addEventListener('taejang-dashboard-refresh', () => queueMicrotask(inspectSurface));
  window.TaejangSupportRadarProfilePolish = { inspectSurface };
})();
