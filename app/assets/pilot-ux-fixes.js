(() => {
  'use strict';

  const managementCalendarRoles = new Set(['department_lead', 'field_lead', 'promotion_lead', 'operations_manager', 'ceo']);
  const stageLabels = { lead: '홍보팀장', operations: '운영총괄', ceo: '대표이사' };
  const calendarState = { view: 'week', cursor: new Date() };
  let promotionEnhancing = false;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(label, onClick, quiet = false) {
    const node = el('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function app() { return window.TaejangApp; }
  function route() { return app()?.getRoute?.(); }
  function main() { return document.getElementById('dashboard-main'); }

  function injectStyles() {
    if (document.getElementById('pilot-ux-style')) return;
    const style = document.createElement('style');
    style.id = 'pilot-ux-style';
    style.textContent = `
      .pilot-calendar { margin: 28px 0 0; padding: 20px; border: 1px solid var(--app-border); border-radius: var(--app-radius); background: #fff; box-shadow: var(--app-shadow); }
      .pilot-calendar-head { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:16px; }
      .pilot-calendar-head h2 { margin:0 auto 0 0; font-size:1.25rem; }
      .pilot-calendar-controls { display:flex; flex-wrap:wrap; gap:8px; }
      .pilot-calendar-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); border-top:1px solid var(--app-border); border-left:1px solid var(--app-border); }
      .pilot-calendar-weekday { padding:8px; text-align:center; font-weight:800; background:#f7f8f6; border-right:1px solid var(--app-border); border-bottom:1px solid var(--app-border); }
      .pilot-calendar-day { min-height:112px; padding:8px; border-right:1px solid var(--app-border); border-bottom:1px solid var(--app-border); min-width:0; }
      .pilot-calendar-day.is-outside { background:#fafafa; color:var(--app-muted); }
      .pilot-calendar-day.is-today { outline:2px solid currentColor; outline-offset:-2px; }
      .pilot-calendar-date { font-weight:850; margin-bottom:6px; }
      .pilot-calendar-event { display:block; width:100%; margin:4px 0; padding:5px 6px; border-radius:7px; background:#edf3ee; font-size:.78rem; line-height:1.35; overflow-wrap:anywhere; }
      .pilot-calendar-event.is-cancelled { text-decoration:line-through; opacity:.65; }
      .pilot-week-list { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:8px; }
      .pilot-week-day { min-height:150px; padding:12px; border:1px solid var(--app-border); border-radius:10px; background:#fff; }
      .pilot-week-day h3 { margin:0 0 8px; font-size:.95rem; }
      .pilot-empty-day { color:var(--app-muted); font-size:.85rem; }
      .pilot-review-section { margin-top:0; }
      .pilot-review-card { padding:20px; border:1px solid var(--app-border); border-radius:var(--app-radius); background:#fff; box-shadow:0 5px 16px rgba(22,53,38,.04); margin-bottom:14px; }
      .pilot-review-card h3 { margin:6px 0 10px; }
      .pilot-review-meta { display:flex; flex-wrap:wrap; gap:8px 14px; margin:10px 0; color:var(--app-muted); font-size:.9rem; }
      .pilot-review-note { margin:12px 0; padding:12px 14px; border-radius:10px; background:#f4f6f2; white-space:pre-wrap; line-height:1.6; }
      .pilot-review-warning { margin:8px 0; padding:8px 10px; border-radius:8px; background:#fff5d9; font-weight:750; }
      .pilot-review-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
      .pilot-date-confirm { display:grid; gap:5px; max-width:240px; margin:12px 0; font-weight:750; }
      .pilot-date-confirm input { min-height:44px; padding:8px 10px; border:1px solid var(--app-border); border-radius:8px; font:inherit; }
      .pilot-public-preview { margin:18px 0 26px; border:1px solid var(--app-border); border-radius:16px; overflow:hidden; background:#fff; box-shadow:var(--app-shadow); }
      .pilot-public-preview-top { padding:12px 18px; background:#183d2a; color:#fff; font-weight:800; }
      .pilot-public-preview article { width:min(100% - 32px, 820px); margin:0 auto; padding:34px 0 42px; }
      .pilot-public-preview .eyebrow { margin-bottom:8px; }
      .pilot-public-preview h1 { margin:0 0 12px; font-size:clamp(1.7rem,4vw,2.7rem); line-height:1.25; }
      .pilot-public-preview .pilot-public-date { color:var(--app-muted); margin-bottom:22px; }
      .pilot-public-preview img { display:block; width:100%; max-height:520px; object-fit:cover; border-radius:12px; margin:18px 0 24px; }
      .pilot-public-body { white-space:pre-wrap; line-height:1.85; font-size:1.02rem; }
      .pilot-lead-editor { margin:16px 0; padding:16px; border:1px solid var(--app-border); border-radius:12px; background:#fafbf9; }
      .pilot-lead-editor label { display:grid; gap:6px; margin:10px 0; font-weight:750; }
      .pilot-lead-editor input,.pilot-lead-editor textarea { min-height:44px; padding:10px 12px; border:1px solid var(--app-border); border-radius:8px; font:inherit; }
      .pilot-lead-editor textarea { min-height:180px; resize:vertical; }
      .pilot-meta-result { margin:8px 0 0; padding:10px; border-radius:8px; background:#eef4ef; font-size:.9rem; }
      .pilot-meta-image { display:block; width:min(100%,260px); max-height:150px; object-fit:cover; margin-top:8px; border-radius:8px; }
      .pilot-publish-location { margin:10px 0; padding:10px 12px; border:1px solid var(--app-border); border-radius:8px; background:#f7f9f7; font-weight:750; }
      .pilot-feedback { margin:10px 0; padding:10px 12px; border-radius:8px; background:#fff5d9; white-space:pre-wrap; }
      @media (max-width:800px) { .pilot-calendar-grid { grid-template-columns:repeat(7,minmax(72px,1fr)); overflow-x:auto; } .pilot-week-list { grid-template-columns:1fr; } }
    `;
    document.head.append(style);
  }

  function localDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  function startOfWeek(date) {
    const result = new Date(date);
    result.setHours(12, 0, 0, 0);
    const day = result.getDay();
    result.setDate(result.getDate() - day);
    return result;
  }

  function addDays(date, count) {
    const result = new Date(date);
    result.setDate(result.getDate() + count);
    return result;
  }

  function monthGridStart(date) {
    const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    return startOfWeek(first);
  }

  function calendarTitle() {
    if (calendarState.view === 'month') return `${calendarState.cursor.getFullYear()}년 ${calendarState.cursor.getMonth() + 1}월`;
    const start = startOfWeek(calendarState.cursor);
    const end = addDays(start, 6);
    return `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`;
  }

  function eventTime(item) {
    if (item.all_day) return '종일';
    try { return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul', hour12: false }).format(new Date(item.starts_at)); }
    catch { return ''; }
  }

  function eventDates(item) {
    const start = localDateKey(new Date(item.starts_at));
    const end = localDateKey(new Date(item.ends_at || item.starts_at));
    return { start, end };
  }

  function eventsForDate(items, dateKey) {
    return items.filter(item => {
      const range = eventDates(item);
      return range.start <= dateKey && range.end >= dateKey;
    });
  }

  async function renderManagementCalendar() {
    const currentRoute = route();
    const target = main();
    if (!target || !managementCalendarRoles.has(currentRoute)) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (heading.includes('홍보 검토') || heading.includes('작성과 보완')) return;

    target.querySelector('[data-pilot-calendar]')?.remove();
    const section = el('section', null, 'pilot-calendar');
    section.dataset.pilotCalendar = '';
    const head = el('div', null, 'pilot-calendar-head');
    head.append(el('h2', '일정 캘린더'));
    const controls = el('div', null, 'pilot-calendar-controls');
    controls.append(
      button('주간', () => { calendarState.view = 'week'; renderManagementCalendar(); }, calendarState.view !== 'week'),
      button('월간', () => { calendarState.view = 'month'; renderManagementCalendar(); }, calendarState.view !== 'month'),
      button('이전', () => { calendarState.cursor = calendarState.view === 'month' ? new Date(calendarState.cursor.getFullYear(), calendarState.cursor.getMonth() - 1, 1, 12) : addDays(calendarState.cursor, -7); renderManagementCalendar(); }, true),
      button('오늘', () => { calendarState.cursor = new Date(); renderManagementCalendar(); }, true),
      button('다음', () => { calendarState.cursor = calendarState.view === 'month' ? new Date(calendarState.cursor.getFullYear(), calendarState.cursor.getMonth() + 1, 1, 12) : addDays(calendarState.cursor, 7); renderManagementCalendar(); }, true)
    );
    head.append(controls);
    section.append(head, el('p', calendarTitle(), 'help'));
    const anchor = target.querySelector('.dashboard-grid') || target.querySelector('.dashboard-intro');
    anchor?.after(section);

    const rangeStart = calendarState.view === 'month' ? monthGridStart(calendarState.cursor) : startOfWeek(calendarState.cursor);
    const days = calendarState.view === 'month' ? 42 : 7;
    let items = [];
    try { items = await app().rpc('get_my_schedule_list', { p_from_date: localDateKey(rangeStart), p_limit: 200 }) || []; }
    catch { section.append(el('p', '일정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'message error')); return; }

    const today = localDateKey(new Date());
    if (calendarState.view === 'month') {
      const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
      const grid = el('div', null, 'pilot-calendar-grid');
      weekdays.forEach(day => grid.append(el('div', day, 'pilot-calendar-weekday')));
      for (let i = 0; i < days; i += 1) {
        const date = addDays(rangeStart, i);
        const key = localDateKey(date);
        const cell = el('div', null, 'pilot-calendar-day');
        if (date.getMonth() !== calendarState.cursor.getMonth()) cell.classList.add('is-outside');
        if (key === today) cell.classList.add('is-today');
        cell.append(el('div', String(date.getDate()), 'pilot-calendar-date'));
        eventsForDate(items, key).slice(0, 4).forEach(item => {
          const event = el('span', `${eventTime(item)} ${item.title}`, 'pilot-calendar-event');
          if (item.status === 'cancelled') event.classList.add('is-cancelled');
          event.title = [item.title, item.location].filter(Boolean).join(' · ');
          cell.append(event);
        });
        grid.append(cell);
      }
      section.append(grid);
    } else {
      const list = el('div', null, 'pilot-week-list');
      for (let i = 0; i < 7; i += 1) {
        const date = addDays(rangeStart, i);
        const key = localDateKey(date);
        const day = el('section', null, 'pilot-week-day');
        if (key === today) day.classList.add('is-today');
        day.append(el('h3', new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(date)));
        const dayItems = eventsForDate(items, key);
        if (!dayItems.length) day.append(el('p', '일정 없음', 'pilot-empty-day'));
        dayItems.forEach(item => {
          const event = el('span', `${eventTime(item)} ${item.title}`, 'pilot-calendar-event');
          if (item.status === 'cancelled') event.classList.add('is-cancelled');
          event.title = [item.title, item.location].filter(Boolean).join(' · ');
          day.append(event);
        });
        list.append(day);
      }
      section.append(list);
    }
  }

  function managementLabels() {
    if (!['super_admin', 'operations_manager', 'department_lead', 'field_lead'].includes(route())) return;
    const nav = document.getElementById('app-nav');
    if (nav) {
      [...nav.querySelectorAll('button')].forEach(node => {
        if (node.textContent === '오늘 관리') node.textContent = '업무 배정';
        if (node.textContent === '작업방법 관리') node.textContent = '작업 매뉴얼';
        if (node.textContent === '업무 배정' && !node.dataset.pilotTaskNav) {
          node.dataset.pilotTaskNav = '1';
          node.addEventListener('click', () => setTimeout(() => focusAdminEditor('오늘 업무 등록·수정'), 30));
        }
        if (node.textContent === '작업 매뉴얼' && !node.dataset.pilotGuideNav) {
          node.dataset.pilotGuideNav = '1';
          node.addEventListener('click', () => setTimeout(() => focusAdminEditor('작업방법 기본정보 등록·수정'), 30));
        }
      });
    }
    const target = main();
    if (target) {
      [...target.querySelectorAll('button')].forEach(node => {
        if (node.textContent === '오늘 관리') node.textContent = '업무 배정';
        if (node.textContent === '작업방법 관리') node.textContent = '작업 매뉴얼';
      });
      [...target.querySelectorAll('h3')].forEach(node => { if (node.textContent === '작업방법') node.textContent = '작업 매뉴얼'; });
    }
    const title = document.getElementById('today-admin-title');
    if (title) title.textContent = '업무 배정·오늘 관리';
    const summaries = [...document.querySelectorAll('#today-admin-panel details > summary')];
    summaries.forEach(summary => {
      if (summary.textContent.trim() === '오늘 업무 등록·수정') summary.textContent = '새 업무 배정·수정';
      if (summary.textContent.trim() === '작업방법 기본정보 등록·수정') summary.textContent = '작업 매뉴얼 등록·수정';
      if (summary.textContent.trim() === '작업순서 등록·수정') summary.textContent = '작업 매뉴얼 단계 등록·수정';
    });
  }

  function focusAdminEditor(summaryText) {
    const summaries = [...document.querySelectorAll('#today-admin-panel details > summary')];
    const wanted = summaries.find(summary => summary.textContent.includes(summaryText.includes('오늘') ? '업무' : '매뉴얼'));
    if (!wanted) return;
    const details = wanted.parentElement;
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function findFormLabel(form, text) {
    return [...form.querySelectorAll('label')].find(label => label.querySelector(':scope > span')?.textContent.trim() === text || label.childNodes[0]?.textContent?.trim() === text);
  }

  function makeSlug() {
    const now = new Date();
    const date = localDateKey(now).replaceAll('-', '');
    const token = Math.random().toString(36).slice(2, 8);
    return `post-${date}-${token}`;
  }

  async function fetchExternalMeta(url) {
    const stored = sessionStorage.getItem('taejang-staff-session-v1');
    let token = '';
    try { token = JSON.parse(stored || '{}').access_token || ''; } catch { /* noop */ }
    if (!token) throw new Error('로그인 정보를 확인할 수 없습니다.');
    const response = await fetch('/.netlify/functions/external-content-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error('외부 페이지 정보를 자동으로 가져오지 못했습니다. 제목은 직접 입력해 주세요.');
    return payload;
  }

  function simplifyStaffComposer() {
    if (!['promotion_staff', 'promotion_lead'].includes(route())) return;
    const form = main()?.querySelector('.promotion-form');
    if (!form || form.dataset.pilotSimplified) return;
    form.dataset.pilotSimplified = '1';

    const hiddenLabels = ['게시 주소(영문·숫자·하이픈)', '요약', '작성 명의', '작성자 표기', '관련 기관', '자료 확인 링크(내부)', '대표 이미지 링크'];
    hiddenLabels.forEach(labelText => {
      const label = findFormLabel(form, labelText);
      if (label) label.hidden = true;
    });
    const media = form.querySelector('.promotion-media-fields');
    if (media) {
      media.hidden = true;
      media.querySelectorAll('input').forEach(input => { input.value = ''; });
    }

    const slug = form.elements.namedItem('slug');
    const summary = form.elements.namedItem('summary');
    const body = form.elements.namedItem('public_body');
    const bylineKind = form.elements.namedItem('byline_kind');
    const byline = form.elements.namedItem('byline');
    const related = form.elements.namedItem('related_organization');
    const source = form.elements.namedItem('source_reference_url');
    const hero = form.elements.namedItem('hero_image_url');
    const contentType = form.elements.namedItem('content_type');
    const external = form.elements.namedItem('external_url');
    const title = form.elements.namedItem('title');

    if (slug && !slug.value) slug.value = makeSlug();
    if (bylineKind) bylineKind.value = 'company';
    if (byline) byline.value = '';
    if (related) related.value = '';
    if (source) source.value = '';

    const syncSummary = () => {
      if (!summary || !body) return;
      summary.value = body.value.replace(/\s+/g, ' ').trim().slice(0, 220);
    };
    body?.addEventListener('input', syncSummary);
    if (!summary?.value) syncSummary();

    const externalLabel = findFormLabel(form, '외부 게시 링크');
    const location = el('p', '', 'pilot-publish-location');
    location.dataset.pilotPublishLocation = '1';
    const updateExternalVisibility = () => {
      const type = contentType?.value || 'homepage_article';
      const usesExternal = type === 'external_content' || type === 'press_release';
      if (externalLabel) {
        externalLabel.hidden = !usesExternal;
        if (usesExternal && form.firstElementChild !== externalLabel) form.insertBefore(externalLabel, form.firstElementChild);
      }
      if (!usesExternal && external) external.value = '';
      location.textContent = type === 'external_content'
        ? '게시 위치: 홈페이지 > 소식·기록 > 외부 기사·콘텐츠'
        : type === 'press_release'
          ? '게시 위치: 홈페이지 > 소식·기록 > 보도자료'
          : '게시 위치: 홈페이지 > 소식·기록 > 태장 소식';
    };
    if (!form.querySelector('[data-pilot-publish-location]')) form.insertBefore(location, form.querySelector('.quick-links'));
    updateExternalVisibility();
    contentType?.addEventListener('change', updateExternalVisibility);

    if (externalLabel && !externalLabel.querySelector('[data-pilot-meta-button]')) {
      const metaButton = button('링크 정보 자동 가져오기', async () => {
        if (!external?.value?.trim()) { window.alert('외부 링크를 먼저 붙여넣어 주세요.'); return; }
        metaButton.disabled = true;
        try {
          const metadata = await fetchExternalMeta(external.value.trim());
          external.value = metadata.url || external.value;
          if (metadata.title && title) title.value = metadata.title;
          if (metadata.description && summary) summary.value = metadata.description.slice(0, 500);
          if (metadata.image && hero) hero.value = metadata.image;
          let result = externalLabel.querySelector('.pilot-meta-result');
          if (!result) { result = el('div', '', 'pilot-meta-result'); externalLabel.append(result); }
          result.replaceChildren(el('span', metadata.title ? `자동으로 가져옴: ${metadata.title}` : '링크는 확인했지만 제목을 찾지 못했습니다. 제목을 직접 입력해 주세요.'));
          if (metadata.image) {
            const image = document.createElement('img'); image.src = metadata.image; image.alt = '자동으로 가져온 대표 이미지'; image.className = 'pilot-meta-image'; result.append(image);
          }
        } catch (error) { window.alert(error.message); }
        finally { metaButton.disabled = false; }
      }, true);
      metaButton.dataset.pilotMetaButton = '1';
      externalLabel.append(metaButton);
      external?.addEventListener('change', () => { if (external.value.trim()) metaButton.click(); });
    }

    const intro = form.closest('.promotion-composer')?.querySelector('.help');
    if (intro) intro.textContent = '제목과 본문 중심으로 작성하면 됩니다. 외부 기사·보도자료는 링크를 먼저 넣으면 가능한 정보를 자동으로 가져옵니다.';
  }

  async function enhanceStaffCards(workspace) {
    if (!['promotion_staff', 'promotion_lead'].includes(workspace.role)) return;
    const section = [...main().querySelectorAll('.dashboard-section')].find(node => ['내 콘텐츠', '내가 작성한 콘텐츠'].includes(node.querySelector('h2')?.textContent));
    if (!section) return;
    const cards = [...section.querySelectorAll('.promotion-card')];
    const items = Array.isArray(workspace.my_items) ? workspace.my_items : [];
    for (let index = 0; index < Math.min(cards.length, items.length); index += 1) {
      const card = cards[index];
      const item = items[index];
      const actions = card.querySelector('.quick-links') || card.appendChild(el('div', null, 'quick-links'));
      if (item.lifecycle === 'review_pending' && !actions.querySelector('[data-pilot-withdraw]')) {
        const withdraw = button('승인 요청 취소하고 수정', async () => {
          if (!window.confirm('첫 검토 전 승인 요청을 취소하고 수정하시겠습니까?')) return;
          try {
            await app().rpc('withdraw_promotion_submission', { p_content_id: item.content_id });
            document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'write' } }));
            setTimeout(() => {
              const matching = [...main().querySelectorAll('.promotion-card')].find(node => node.querySelector('h3')?.textContent === item.title);
              [...(matching?.querySelectorAll('button') || [])].find(node => node.textContent.includes('열어 수정'))?.click();
            }, 500);
          } catch (error) { window.alert(app().friendlyError(error)); }
        }, true);
        withdraw.dataset.pilotWithdraw = '1';
        actions.append(withdraw);
      }
      if (item.lifecycle === 'needs_revision' && !card.querySelector('[data-pilot-feedback]')) {
        try {
          const feedback = await app().rpc('get_my_promotion_feedback', { p_content_id: item.content_id });
          if (feedback?.comment) {
            const note = el('p', `보완 요청: ${feedback.comment}`, 'pilot-feedback');
            note.dataset.pilotFeedback = '1';
            card.querySelector('h3')?.after(note);
          }
        } catch { /* feedback is convenience-only */ }
      }
    }
  }

  function publicPreview(detail) {
    const wrapper = el('section', null, 'pilot-public-preview');
    wrapper.dataset.pilotPublicPreview = '';
    wrapper.append(el('div', 'TAEJANG · 소식·기록', 'pilot-public-preview-top'));
    const article = document.createElement('article');
    article.append(el('p', detail.content_type === 'press_release' ? 'PRESS RELEASE' : 'TAEJANG NEWS', 'eyebrow'));
    article.append(el('h1', detail.title || '제목 없음'));
    article.append(el('p', detail.requested_publish_date ? `게시 예정일 ${detail.requested_publish_date}` : '게시일 미정', 'pilot-public-date'));
    if (detail.hero_image_url) {
      const image = document.createElement('img'); image.src = detail.hero_image_url; image.alt = `${detail.title || '콘텐츠'} 대표 이미지`; article.append(image);
    }
    if (detail.public_body) article.append(el('div', detail.public_body, 'pilot-public-body'));
    if (detail.external_url) {
      const link = document.createElement('a'); link.href = detail.external_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'button button-quiet'; link.textContent = '원문 보기'; article.append(link);
    }
    article.append(button('미리보기 닫기', () => wrapper.remove(), true));
    wrapper.append(article);
    return wrapper;
  }

  function showPublicPreview(detail, beforeNode) {
    main().querySelector('[data-pilot-public-preview]')?.remove();
    const preview = publicPreview(detail);
    beforeNode?.before(preview);
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function leadEditor(detail, onSaved) {
    const panel = el('div', null, 'pilot-lead-editor');
    const title = document.createElement('input'); title.value = detail.title || '';
    const body = document.createElement('textarea'); body.value = detail.public_body || '';
    const external = document.createElement('input'); external.type = 'url'; external.value = detail.external_url || '';
    const date = document.createElement('input'); date.type = 'date'; date.value = detail.requested_publish_date || '';
    const label = (name, control) => { const node = document.createElement('label'); node.append(el('span', name), control); return node; };
    panel.append(el('h4', '홍보팀장 직접 수정'), label('제목', title), label('본문', body));
    if (detail.content_type === 'external_content') panel.append(label('외부 링크', external));
    panel.append(label('게시 예정일', date));
    const actions = el('div', null, 'pilot-review-actions');
    actions.append(button('수정본 저장', async () => {
      if (!title.value.trim()) { window.alert('제목을 입력해 주세요.'); return; }
      try {
        await app().rpc('lead_replace_promotion_revision', {
          p_content_id: detail.content_id,
          p_title: title.value.trim(),
          p_public_body: body.value,
          p_external_url: detail.content_type === 'external_content' ? (external.value.trim() || null) : null,
          p_requested_publish_date: date.value || null
        });
        onSaved();
      } catch (error) { window.alert(app().friendlyError(error)); }
    }), button('취소', () => panel.remove(), true));
    panel.append(actions);
    return panel;
  }

  function reviewPrompt(action) {
    if (action === 'changes_requested') {
      const value = window.prompt('보완이 필요한 이유를 구체적으로 적어주세요.', '');
      return value?.trim() || null;
    }
    if (action === 'rejected') {
      const value = window.prompt('반려 이유를 기록해 주세요.', '');
      return value?.trim() || null;
    }
    if (action === 'escalate_to_operations') {
      const value = window.prompt('운영총괄에게 상신하는 이유를 적어주세요.', '');
      return value?.trim() || null;
    }
    if (action === 'escalate_to_ceo') {
      const summary = window.prompt('대표이사에게 전달할 핵심 요약을 적어주세요.', '');
      if (!summary?.trim()) return null;
      const reason = window.prompt('대표이사 확인이 필요한 이유를 적어주세요.', '');
      if (!reason?.trim()) return null;
      const opinion = window.prompt('운영총괄 검토 의견을 적어주세요.', '');
      if (opinion === null) return null;
      return `요약: ${summary.trim()}\n확인 이유: ${reason.trim()}\n운영총괄 의견: ${opinion.trim() || '별도 의견 없음'}`;
    }
    return null;
  }

  async function runReview(detail, action, dateInput) {
    let current = detail;
    if (detail.stage === 'lead' && dateInput) {
      const requested = dateInput.value || null;
      const previous = detail.requested_publish_date || null;
      if (requested !== previous) {
        await app().rpc('lead_replace_promotion_revision', {
          p_content_id: detail.content_id,
          p_title: detail.title,
          p_public_body: detail.public_body,
          p_external_url: detail.external_url,
          p_requested_publish_date: requested
        });
        current = await app().rpc('get_promotion_review_detail', { p_content_id: detail.content_id });
      }
      if (action === 'approve' && !requested && !window.confirm('게시 예정일을 정하지 않고 승인하시겠습니까?')) return;
    }

    let comment = reviewPrompt(action);
    if (['changes_requested', 'rejected', 'escalate_to_operations', 'escalate_to_ceo'].includes(action) && !comment) return;
    let revisit = null;
    if (action === 'on_hold') {
      comment = window.prompt('보류 사유를 적어주세요. (선택)', '')?.trim() || null;
      revisit = window.prompt('재확인 날짜를 YYYY-MM-DD 형식으로 적어주세요.', '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(revisit || '')) { window.alert('재확인 날짜를 확인해 주세요.'); return; }
    }
    await app().rpc('review_promotion_revision', {
      p_content_id: current.content_id,
      p_action: action,
      p_comment: comment,
      p_revisit_at: revisit
    });
    document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'review' } }));
  }

  async function enhancedReviewSection(workspace) {
    if (!['promotion_lead', 'operations_manager', 'ceo'].includes(workspace.role)) return;
    if (main().querySelector('[data-pilot-review-section]')) return;
    const original = [...main().querySelectorAll('.dashboard-section')].find(node => ['검토 대기 안건', '대표이사 확인 안건'].includes(node.querySelector('h2')?.textContent));
    if (!original) return;
    original.hidden = true;

    const section = el('section', null, 'dashboard-section pilot-review-section');
    section.dataset.pilotReviewSection = '';
    section.append(el('h2', workspace.role === 'ceo' ? '대표이사 확인 안건' : '검토 대기 안건'));
    const reviewItems = Array.isArray(workspace.review_items) ? workspace.review_items : [];
    if (!reviewItems.length) section.append(el('p', '현재 검토 대기 안건이 없습니다.', 'empty'));

    for (const item of reviewItems) {
      let detail;
      try { detail = await app().rpc('get_promotion_review_detail', { p_content_id: item.content_id }); }
      catch { detail = { ...item, content_id: item.content_id, stage: item.stage }; }
      const card = el('article', null, 'pilot-review-card');
      card.append(el('span', `${stageLabels[detail.stage] || '검토'} 단계`, 'status-label'), el('h3', detail.title || item.title || '제목 없음'));
      const meta = el('div', null, 'pilot-review-meta');
      meta.append(el('span', `최소 승인: ${stageLabels[detail.minimum_review_stage || item.required_stage] || '홍보팀장'}`));
      meta.append(el('span', detail.requested_publish_date ? `게시 예정일: ${detail.requested_publish_date}` : '게시 예정일: 미정'));
      card.append(meta);
      if (detail.previous_stage_comment) {
        const label = detail.stage === 'ceo' ? '운영총괄 전달 의견' : '이전 검토자 전달 의견';
        card.append(el('p', `${label}\n${detail.previous_stage_comment}`, 'pilot-review-note'));
      }
      if (detail.people_photo === 'yes' || detail.people_photo === 'unsure') card.append(el('p', '인물사진 공개 여부 확인 필요', 'pilot-review-warning'));
      if (detail.number_or_amount === 'yes' || detail.number_or_amount === 'unsure') card.append(el('p', '숫자·금액 확인 필요', 'pilot-review-warning'));

      let dateInput = null;
      if (workspace.role === 'promotion_lead') {
        const label = el('label', null, 'pilot-date-confirm');
        label.append(el('span', '게시 예정일 최종 확인'));
        dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.value = detail.requested_publish_date || ''; label.append(dateInput); card.append(label);
      }

      const actions = el('div', null, 'pilot-review-actions');
      actions.append(button('실제 홈페이지 모습 미리보기', () => showPublicPreview(detail, section), true));
      if (workspace.role === 'promotion_lead') {
        actions.append(button('직접 수정', () => {
          card.querySelector('.pilot-lead-editor')?.remove();
          card.append(leadEditor(detail, () => document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'review' } }))));
        }, true));
        actions.append(button('보완 요청', () => runReview(detail, 'changes_requested', dateInput), true));
        actions.append(button('게시일 확인 후 승인', () => runReview(detail, 'approve', dateInput)));
        actions.append(button('운영총괄 상신', () => runReview(detail, 'escalate_to_operations', dateInput), true));
      } else if (workspace.role === 'operations_manager') {
        actions.append(button('승인', () => runReview(detail, 'approve')));
        actions.append(button('보완 요청', () => runReview(detail, 'changes_requested'), true));
        actions.append(button('대표이사 상신', () => runReview(detail, 'escalate_to_ceo'), true));
        actions.append(button('검토 보류', () => runReview(detail, 'on_hold'), true));
      } else {
        actions.append(button('승인', () => runReview(detail, 'approve')));
        actions.append(button('보완 요청', () => runReview(detail, 'changes_requested'), true));
        actions.append(button('반려', () => runReview(detail, 'rejected'), true));
        actions.append(button('검토 보류', () => runReview(detail, 'on_hold'), true));
      }
      card.append(actions);
      section.append(card);
    }
    original.before(section);
  }

  async function enhancePromotionWorkspace() {
    if (promotionEnhancing || !app()) return;
    const target = main();
    if (!target) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!['작성과 보완', '홍보 검토', '홍보 검토 · 작성'].includes(heading)) return;
    const currentRoute = route();
    const composerNeedsEnhancement = ['promotion_staff', 'promotion_lead'].includes(currentRoute) && !!target.querySelector('.promotion-form:not([data-pilot-simplified])');
    const reviewNeedsEnhancement = ['promotion_lead', 'operations_manager', 'ceo'].includes(currentRoute) && !target.querySelector('[data-pilot-review-section]');
    const cardsNeedEnhancement = ['promotion_staff', 'promotion_lead'].includes(currentRoute) && !!target.querySelector('.promotion-card');
    if (!composerNeedsEnhancement && !reviewNeedsEnhancement && !cardsNeedEnhancement) return;
    promotionEnhancing = true;
    try {
      const workspace = await app().rpc('get_my_promotion_workspace');
      simplifyStaffComposer();
      await enhanceStaffCards(workspace || {});
      await enhancedReviewSection(workspace || {});
    } catch { /* core workspace remains available if enhancement fails */ }
    finally { promotionEnhancing = false; }
  }

  function scheduleEnhancements() {
    setTimeout(() => {
      managementLabels();
      renderManagementCalendar();
      enhancePromotionWorkspace();
    }, 180);
  }

  injectStyles();
  document.addEventListener('taejang-app-ready', scheduleEnhancements);
  document.addEventListener('taejang-dashboard-refresh', scheduleEnhancements);
  document.addEventListener('taejang-open-promotion-workspace', () => setTimeout(enhancePromotionWorkspace, 260));

  const observer = new MutationObserver(() => {
    managementLabels();
    const target = main();
    const heading = target?.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!['작성과 보완', '홍보 검토', '홍보 검토 · 작성'].includes(heading)) return;
    const currentRoute = route();
    const needsComposer = ['promotion_staff', 'promotion_lead'].includes(currentRoute) && !!target.querySelector('.promotion-form:not([data-pilot-simplified])');
    const needsReview = ['promotion_lead', 'operations_manager', 'ceo'].includes(currentRoute) && !target.querySelector('[data-pilot-review-section]');
    if (needsComposer || needsReview) setTimeout(enhancePromotionWorkspace, 80);
  });
  const startObserver = () => {
    const target = document.getElementById('dashboard-main');
    if (target) observer.observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true }); else startObserver();
})();
