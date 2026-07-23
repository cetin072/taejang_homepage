(() => {
  'use strict';
  const ui = window.TaejangStaffInformationUI;
  let items = []; let category = null; let query = '';

  function showList() { ui.setWorkerScreen('guidance-screen'); ui.element('guidance-list-view').hidden = false; ui.element('guidance-detail-view').hidden = true; ui.element('guidance-list-title').focus?.(); }
  function showToday() { ui.setWorkerScreen('general-worker-board'); ui.element('today-title').focus?.(); }
  function filtered() { const needle = query.trim().toLowerCase(); return items.filter(item => (!category || item.category === category) && (!needle || `${item.title} ${item.summary_easy}`.toLowerCase().includes(needle))); }
  function renderFilters() {
    const wrap = ui.element('guidance-filters'); wrap.replaceChildren();
    [['all', '전체'], ...Object.entries(ui.GUIDANCE_CATEGORIES)].forEach(([id, label]) => {
      const button = ui.text('button', label, 'button button-quiet'); button.type = 'button';
      button.dataset.filter = id; button.setAttribute('aria-pressed', String((id === 'all' && !category) || id === category));
      button.addEventListener('click', () => { category = id === 'all' ? null : id; render(); }); wrap.append(button);
    });
  }
  function card(item) {
    const node = document.createElement('article'); node.className = `guidance-card${item.is_featured ? ' is-featured' : ''}`;
    if (item.is_featured) node.append(ui.text('p', '꼭 기억해 주세요', 'status-banner'));
    node.append(ui.text('p', ui.GUIDANCE_CATEGORIES[item.category] || '기타', 'card-kicker'), ui.text('h2', item.title), ui.text('p', item.summary_easy, 'card-body'), ui.text('p', `최종 수정일: ${ui.formatDate(item.updated_at)}`, 'help'));
    const button = ui.text('button', '안내 자세히 보기', 'button button-quiet'); button.type = 'button'; button.addEventListener('click', () => openDetail(item.id)); node.append(button); return node;
  }
  function render() { const list = ui.element('guidance-list'); const result = filtered(); renderFilters(); list.replaceChildren(...(result.length ? result.map(card) : [ui.text('p', '등록된 안내가 없습니다.', 'empty')])); ui.element('guidance-filter-status').textContent = `현재 ${category ? ui.GUIDANCE_CATEGORIES[category] : '전체'} 안내 ${result.length}개를 보고 있습니다.`; }
  async function loadList() { showList(); ui.message('guidance-message', '안내를 불러오고 있습니다.'); try { items = ui.array(await window.TaejangApp.rpc('get_my_staff_guidance_list', { p_category: null, p_limit: 100 })); ui.message('guidance-message', ''); render(); } catch { ui.message('guidance-message', '안내를 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true); } }
  function externalLink(item) { const url = ui.safeHttpsUrl(item.related_link_url); if (!url || !item.related_link_label) return null; const box = document.createElement('div'); box.className = 'external-link-box'; const link = ui.text('a', `${item.related_link_label} — ${url.hostname}`, 'button button-quiet'); link.href=url.href; link.target='_blank'; link.rel='noopener noreferrer'; box.append(ui.text('p', '외부 링크', 'card-kicker'), link, ui.text('p', `실제 주소: ${url.href}`, 'link-address')); return box; }
  function targetDescription(scope) { return { company:'회사 전체에 적용되는 안내입니다.', department:'내 부서에 적용되는 안내입니다.', work_group:'내 작업반에 적용되는 안내입니다.', profile:'나에게 적용되는 안내입니다.' }[scope] || ''; }
  function renderDetail(item) {
    ui.element('guidance-detail-category').textContent = ui.GUIDANCE_CATEGORIES[item.category] || '기타'; ui.element('guidance-detail-title').textContent = item.title;
    const content = ui.element('guidance-detail-content'); content.replaceChildren();
    if (item.category === 'safety') content.append(ui.text('p', '안전 관련 안내', 'status-banner'));
    if (item.category === 'help_request') content.append(ui.text('p', '도움이 필요할 때 사용하세요', 'status-banner'));
    content.append(ui.text('p', item.summary_easy, 'card-primary'), ui.text('p', item.body_easy, 'notice-body'));
    const details = document.createElement('dl'); details.className='detail-list'; ui.appendDetail(details, '적용 대상', targetDescription(item.target_scope)); ui.appendDetail(details, '관련 장소', item.location_text); ui.appendDetail(details, '문의 담당자', item.help_contact_label); ui.appendDetail(details, '문의 또는 도움 요청 방법', item.help_method_text); ui.appendDetail(details, '등록일', ui.formatDateTime(item.created_at)); ui.appendDetail(details, '최종 수정일', ui.formatDateTime(item.updated_at)); content.append(details);
    if (item.related_work_guide_id) { const button=ui.text('button','관련 작업방법 보기','button button-quiet'); button.type='button'; button.addEventListener('click',()=>window.TaejangWorkGuides?.openDetail(item.related_work_guide_id,{fromToday:false})); content.append(button); }
    if (item.related_schedule_id) { const button=ui.text('button','관련 일정 보기','button button-quiet'); button.type='button'; button.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('taejang-open-schedule',{detail:{id:item.related_schedule_id,fromToday:false}}))); content.append(button); }
    const link=externalLink(item); if(link) content.append(link);
  }
  async function openDetail(id) { ui.setWorkerScreen('guidance-screen'); ui.element('guidance-list-view').hidden=true; ui.element('guidance-detail-view').hidden=false; ui.message('guidance-detail-message','안내 상세를 불러오고 있습니다.'); try { const item=await window.TaejangApp.rpc('get_my_staff_guidance_detail',{p_guidance_id:id}); ui.message('guidance-detail-message',''); renderDetail(item); ui.element('guidance-detail-title').focus?.(); } catch { ui.message('guidance-detail-message','이 안내는 지금 볼 수 없습니다. 담당 반장에게 확인하세요.',true); } }
  function bind() { ui.element('open-guidance-list').addEventListener('click',loadList); ui.element('guidance-back-today').addEventListener('click',showToday); ui.element('guidance-detail-today').addEventListener('click',showToday); ui.element('guidance-detail-back').addEventListener('click',loadList); ui.element('guidance-search').addEventListener('input', event=>{query=event.target.value; render();}); }
  document.addEventListener('taejang-app-ready', event=>{if(event.detail.route==='general_worker') bind();},{once:true});
})();
