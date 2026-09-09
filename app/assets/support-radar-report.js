(() => {
  'use strict';
  const allowed = new Set(['operations_manager','ceo']);
  const el = id => document.getElementById(id);
  const text = (tag,value,className) => { const node=document.createElement(tag); if(className)node.className=className; node.textContent=value??''; return node; };
  const array = value => Array.isArray(value)?value:[];
  const money = value => `${new Intl.NumberFormat('ko-KR').format(Number(value||0))}원`;
  const formatDate = value => value ? new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'}).format(new Date(value)) : '미정';
  function canUse(){return allowed.has(window.TaejangApp?.getRoute?.());}
  function button(label,action,quiet=false){const node=text('button',label,quiet?'button button-quiet':'button');node.type='button';node.addEventListener('click',action);return node;}
  function stat(label,value,note=''){const node=document.createElement('article');node.className='support-radar-stat';node.append(text('span',label,'support-radar-muted'),text('strong',value));if(note)node.append(text('span',note,'support-radar-muted'));return node;}
  function section(title,copy=''){const node=document.createElement('section');node.className='support-radar-section';node.append(text('h3',title));if(copy)node.append(text('p',copy,'support-radar-muted'));return node;}
  function goHome(){window.TaejangSupportRadar?.open?.('dashboard');}
  async function render(){
    if(!canUse())return;
    el('desktop-app-shell')?.classList.remove('sidebar-open');
    const title=el('desktop-page-title');if(title)title.textContent='지원사업 주간 보고';
    const main=el('dashboard-main');main.replaceChildren(text('p','주간 보고를 만들고 있습니다.','message'));
    try{
      const data=await window.TaejangApp.rpc('support_get_weekly_report',{});
      const root=document.createElement('div');root.className='support-radar-shell';
      const head=document.createElement('header');head.className='support-radar-header';
      const left=document.createElement('div');left.append(text('p','지원사업 레이더','eyebrow'),text('h2','주간 종합보고'),text('p',`${formatDate(data.period_start)} ~ ${formatDate(data.period_end)}`));
      const actions=document.createElement('div');actions.className='support-radar-actions';actions.append(button('레이더 홈',goHome,true),button('인쇄',()=>window.print(),true));head.append(left,actions);root.append(head);
      const weekly=document.createElement('div');weekly.className='support-radar-summary';weekly.append(
        stat('새 공고',`${data.new_notices||0}건`),stat('평가 완료',`${data.evaluated||0}건`),stat('신청 결정',`${data.apply_decisions||0}건`),stat('제출',`${data.submitted||0}건`),stat('선정',`${data.selected||0}건`),stat('확보 지원금',money(data.selected_cash)),stat('확보 현물',money(data.selected_in_kind_value))
      );root.append(weekly);
      const current=document.createElement('div');current.className='support-radar-summary';current.append(
        stat('현재 열린 공고',`${data.open_count||0}건`),stat('7일 내 마감',`${data.deadline_7_count||0}건`),stat('미평가',`${data.unreviewed_count||0}건`),stat('신청 진행',`${data.application_count||0}건`)
      );root.append(current);
      const top=section('이번 주 우선 검토 TOP 5','운영총괄이 먼저 판단할 공고입니다.');
      const items=array(data.top_items);if(!items.length)top.append(text('p','평가된 우선 공고가 아직 없습니다.','support-radar-empty'));
      items.forEach((item,index)=>{const card=document.createElement('article');card.className='support-radar-row';card.append(text('p',`TOP ${index+1} · ${item.score??'미평가'}점`,'eyebrow'),text('h3',item.title),text('p',`${item.organization||'기관 미확인'} · 마감 ${formatDate(item.deadline)}`));if(item.recommendation)card.append(text('p',item.recommendation));if(window.TaejangSupportRadarNotices?.renderDetail)card.append(button('상세 보기',()=>window.TaejangSupportRadarNotices.renderDetail(item.notice_id),true));top.append(card);});root.append(top);
      main.replaceChildren(root);main.focus();
    }catch(error){main.replaceChildren(text('p',window.TaejangApp.friendlyError(error),'message error'));}
  }
  function inject(){if(!canUse())return;const group=document.querySelector('[data-support-radar-nav-group]');if(!group||group.querySelector('[data-support-weekly-report]'))return;const node=button('주간 보고',render);node.dataset.supportWeeklyReport='1';group.append(node);}
  document.addEventListener('taejang-app-ready',()=>queueMicrotask(inject));
  document.addEventListener('taejang-dashboard-refresh',()=>queueMicrotask(inject));
  window.TaejangSupportRadarReport={render};
})();
