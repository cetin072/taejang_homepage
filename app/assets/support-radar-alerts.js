(() => {
  'use strict';

  const state = { currentNoticeId: null, dashboardLoading: false, priorityLoading: false };
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => { const node=document.createElement(tag); if(className)node.className=className; node.textContent=value??''; return node; };
  const array = value => Array.isArray(value)?value:[];
  const isOps = () => Boolean(window.TaejangSupportRadarAccess?.canManagementEdit?.());
  const canUse = () => Boolean(window.TaejangSupportRadarAccess?.canManagementView?.());
  const button = (label,action,quiet=false) => { const node=text('button',label,quiet?'button button-quiet':'button'); node.type='button'; node.addEventListener('click',action); return node; };

  const reasonLabels = {
    score_85: '적합도 85점 이상',
    amount_5m: '지원규모 500만원 이상',
    in_kind_vehicle_facility_equipment: '차량·시설·장비 현물지원',
    priority_domain: '최우선 분야',
    deadline_7: '7일 내 마감',
    rare_national: '희소 전국공모',
    manual_priority: '운영총괄 중요지정'
  };

  function formatDate(value) {
    if(!value) return '미정';
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'}).format(date);
  }

  function money(value) {
    const amount=Number(value||0);
    return amount>0?`${new Intl.NumberFormat('ko-KR').format(amount)}원`:'미정';
  }

  function alertCard(item) {
    const card=document.createElement('article'); card.className='support-radar-row';
    const top=document.createElement('div'); top.className='support-radar-header';
    const copy=document.createElement('div');
    copy.append(text('p',item.organization||'기관 미확인','eyebrow'),text('h3',item.title||'제목 없음'));
    top.append(copy,text('strong',`${item.score??'-'}점`,'support-score-badge'));
    card.append(top);
    const reasons=document.createElement('div'); reasons.className='support-radar-tag-list';
    array(item.trigger_reasons).forEach(reason=>reasons.append(text('span',reasonLabels[reason]||reason,'support-radar-tag')));
    card.append(reasons);
    const meta=[`마감 ${formatDate(item.deadline_at)}`];
    const amount=Math.max(Number(item.cash_support_max||0),Number(item.cash_support_min||0));
    if(amount>0) meta.push(`최대 ${money(amount)}`);
    if(item.in_kind_available) meta.push('현물지원 포함');
    card.append(text('p',meta.join(' · '),'support-radar-muted'));
    if(item.recommendation) card.append(text('p',item.recommendation));
    card.append(button('상세 확인',()=>window.TaejangSupportRadarNotices?.renderDetail?.(item.notice_id),true));
    return card;
  }

  async function injectDashboardAlerts() {
    if(!canUse() || state.dashboardLoading) return;
    const main=el('dashboard-main');
    const root=main?.querySelector('.support-radar-shell');
    if(!root || root.querySelector('[data-support-alert-panel]')) return;
    const heading=root.querySelector('h2');
    if(!heading || heading.textContent!=='지원사업 레이더') return;

    state.dashboardLoading=true;
    try {
      const data=await window.TaejangApp.rpc('support_get_alert_candidates');
      const liveRoot=el('dashboard-main')?.querySelector('.support-radar-shell');
      if(liveRoot!==root || root.querySelector('[data-support-alert-panel]')) return;
      const panel=document.createElement('section');
      panel.className='support-radar-section'; panel.dataset.supportAlertPanel='1';
      panel.append(text('h3','긴급 확인'),text('p','조건만 맞는 공고가 아니라 현재 태장 기업 프로필과 Rule Engine 관련성까지 통과한 공고만 표시합니다.','support-radar-muted'));
      const items=array(data.items);
      if(data.profile_required) panel.append(text('p','기업 프로필을 먼저 등록해야 긴급 확인 후보를 계산할 수 있습니다.','support-radar-warning'));
      else if(!items.length) panel.append(text('p','현재 즉시 확인할 중요 공고가 없습니다.','support-radar-empty'));
      else items.slice(0,10).forEach(item=>panel.append(alertCard(item)));
      const firstSection=root.querySelector('.support-radar-section');
      if(firstSection) root.insertBefore(panel,firstSection); else root.append(panel);
    } catch(error) {
      const panel=document.createElement('section'); panel.className='support-radar-section'; panel.dataset.supportAlertPanel='1';
      panel.append(text('h3','긴급 확인'),text('p','긴급 확인 후보를 불러오지 못했습니다.','message error'));
      root.append(panel);
    } finally { state.dashboardLoading=false; }
  }

  async function saveFlags(rare,force,note) {
    if(!isOps() || !state.currentNoticeId) return;
    try {
      await window.TaejangApp.rpc('support_set_notice_priority_flags',{
        p_notice_id:state.currentNoticeId,
        p_rare_national_opportunity:rare,
        p_force_alert:force,
        p_note:note||null
      });
      await window.TaejangSupportRadarNotices?.renderDetail?.(state.currentNoticeId);
    } catch(error) { window.alert(window.TaejangApp.friendlyError(error)); }
  }

  async function injectPriorityFlags() {
    if(!isOps() || !state.currentNoticeId || state.priorityLoading) return;
    const root=el('dashboard-main')?.querySelector('.support-radar-shell');
    if(!root || root.querySelector('[data-support-priority-flags]')) return;
    const headings=[...root.querySelectorAll('h3')];
    if(!headings.some(node=>node.textContent==='태장 적합도')) return;

    state.priorityLoading=true;
    let data;
    try { data=await window.TaejangApp.rpc('support_get_notice_priority_flags',{p_notice_id:state.currentNoticeId}); }
    catch { return; }
    finally { state.priorityLoading=false; }
    const liveRoot=el('dashboard-main')?.querySelector('.support-radar-shell');
    if(liveRoot!==root || root.querySelector('[data-support-priority-flags]')) return;

    const panel=document.createElement('section'); panel.className='support-radar-section'; panel.dataset.supportPriorityFlags='1';
    panel.append(text('h3','중요 공고 표시'),text('p','자동 판단이 어려운 희소 전국공모나 반드시 확인할 공고만 수동으로 표시하세요.','support-radar-muted'));
    const rare=document.createElement('input'); rare.type='checkbox'; rare.checked=Boolean(data.rare_national_opportunity);
    const force=document.createElement('input'); force.type='checkbox'; force.checked=Boolean(data.force_alert);
    const rareLabel=document.createElement('label'); rareLabel.className='check-label'; rareLabel.append(rare,document.createTextNode(' 희소 전국공모'));
    const forceLabel=document.createElement('label'); forceLabel.className='check-label'; forceLabel.append(force,document.createTextNode(' 긴급 확인에 반드시 표시'));
    const note=document.createElement('input'); note.type='text'; note.maxLength=1000; note.placeholder='표시 이유 또는 확인 메모'; note.value=data.note||'';
    const controls=document.createElement('div'); controls.className='support-radar-grid'; controls.append(rareLabel,forceLabel,note,button('중요 표시 저장',()=>saveFlags(rare.checked,force.checked,note.value)));
    panel.append(controls);

    const evalHeading=headings.find(node=>node.textContent==='태장 적합도');
    const evalSection=evalHeading?.closest('.support-radar-section');
    if(evalSection) evalSection.insertAdjacentElement('afterend',panel); else root.append(panel);
  }

  function setup() {
    if(!canUse()) return;
    queueMicrotask(injectDashboardAlerts);
  }

  document.addEventListener('taejang-app-ready',setup);
  document.addEventListener('taejang-dashboard-refresh',()=>queueMicrotask(injectDashboardAlerts));
  document.addEventListener('taejang-support-radar-rendered',event=>{
    if(event.detail?.surface==='dashboard') queueMicrotask(injectDashboardAlerts);
    if(event.detail?.surface==='notice-detail') {
      state.currentNoticeId=event.detail.noticeId;
      queueMicrotask(injectPriorityFlags);
    }
  });
  window.TaejangSupportRadarAlerts={injectDashboardAlerts,injectPriorityFlags};
})();
