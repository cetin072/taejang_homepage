(() => {
  'use strict';

  const assigneeRoles = new Set([
    'department_lead','promotion_lead','promotion_staff',
    'worker_support_lead','worker_support_staff','office_staff'
  ]);
  const el=id=>document.getElementById(id);
  const text=(tag,value,className)=>{const node=document.createElement(tag);if(className)node.className=className;node.textContent=value??'';return node;};
  const array=value=>Array.isArray(value)?value:[];
  const button=(label,action,quiet=false)=>{const node=text('button',label,quiet?'button button-quiet':'button');node.type='button';node.addEventListener('click',action);return node;};
  let observer;

  function canUse(){return assigneeRoles.has(window.TaejangApp?.getRoute?.());}
  function closeSidebar(){el('desktop-app-shell')?.classList.remove('sidebar-open');el('sidebar-toggle')?.setAttribute('aria-expanded','false');}
  function setTitle(value){const node=el('desktop-page-title');if(node)node.textContent=value;}
  function formatDate(value){if(!value)return '미정';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'}).format(d);}
  function statusLabel(value){return ({reviewing:'검토 중',contacting_agency:'기관 문의',collecting_documents:'자료 수집',drafting_application:'신청서 작성',ready_to_submit:'제출 준비',submitted:'제출 완료',selected:'선정',not_selected:'미선정',cancelled:'취소'})[value]||value||'신청 전';}
  function modeLabel(value){return ({direct:'직접신청',joint:'공동신청',partner:'협력기관',none:'진행 안 함',verify:'확인 필요'})[value]||'미평가';}

  function header(title,copy,actions=[]){const node=document.createElement('header');node.className='support-radar-header';const left=document.createElement('div');left.append(text('p','내 지원사업','eyebrow'),text('h2',title),text('p',copy));const right=document.createElement('div');right.className='support-radar-actions';actions.forEach(item=>right.append(item));node.append(left,right);return node;}
  function section(title,copy=''){const node=document.createElement('section');node.className='support-radar-section';node.append(text('h3',title));if(copy)node.append(text('p',copy,'support-radar-muted'));return node;}

  function injectNav(){
    if(!canUse())return;
    const nav=el('app-nav');
    if(!nav||nav.querySelector('[data-support-my-work-nav]'))return;
    const group=document.createElement('section');group.className='support-radar-nav-group';group.dataset.supportMyWorkNav='1';
    group.append(text('p','지원사업','support-radar-nav-label'),button('내 지원사업',renderList));
    const official=nav.querySelector('[data-official-channel-group]');
    if(official)nav.insertBefore(group,official);else nav.append(group);
  }

  function card(item){
    const node=document.createElement('article');node.className='support-radar-row';
    const top=document.createElement('div');top.className='support-radar-header';
    const left=document.createElement('div');left.append(text('p',item.organization||'기관 미확인','eyebrow'),text('h3',item.title||'제목 없음'));
    top.append(left,text('strong',item.score===null||item.score===undefined?'미평가':`${item.score}점`,'support-score-badge'));node.append(top);
    const tags=document.createElement('div');tags.className='support-radar-tag-list';
    [`마감 ${formatDate(item.deadline_at)}`,modeLabel(item.application_mode),statusLabel(item.application_status)].forEach(value=>tags.append(text('span',value,'support-radar-tag')));
    node.append(tags);
    if(item.recommendation)node.append(text('p',item.recommendation));
    node.append(button('업무 열기',()=>renderDetail(item.id),true));
    return node;
  }

  async function renderList(){
    if(!canUse())return;
    closeSidebar();setTitle('내 지원사업');
    const main=el('dashboard-main');main.replaceChildren(text('p','배정된 지원사업을 불러오고 있습니다.','message'));
    try{
      const items=array(await window.TaejangApp.rpc('support_list_notices',{p_limit:200}));
      const root=document.createElement('div');root.className='support-radar-shell';
      root.append(header('내 지원사업','운영총괄이 나에게 배정한 지원사업만 표시합니다. 기관 문의·자료 수집·신청 준비 상태를 여기서 업데이트하세요.'));
      const list=section('배정된 공고');
      if(!items.length)list.append(text('p','현재 나에게 배정된 지원사업이 없습니다.','support-radar-empty'));
      items.forEach(item=>list.append(card(item)));root.append(list);main.replaceChildren(root);main.focus();
    }catch(error){main.replaceChildren(text('p',window.TaejangApp.friendlyError(error),'message error'));}
  }

  async function saveProgress(noticeId,status,nextAction){
    try{
      await window.TaejangApp.rpc('support_update_application_status',{p_notice_id:noticeId,p_status:status,p_next_action:nextAction||null});
      await renderDetail(noticeId);
    }catch(error){window.alert(window.TaejangApp.friendlyError(error));}
  }

  async function renderDetail(id){
    if(!canUse())return;
    closeSidebar();setTitle('내 지원사업 상세');
    const main=el('dashboard-main');main.replaceChildren(text('p','지원사업 업무를 불러오고 있습니다.','message'));
    try{
      const data=await window.TaejangApp.rpc('support_get_notice_detail',{p_notice_id:id});const n=data.notice;const e=data.evaluation;const a=data.application;
      const root=document.createElement('div');root.className='support-radar-shell';
      root.append(header(n.title,'배정된 지원사업의 핵심 판단과 내가 할 다음 행동을 확인합니다.',[button('내 지원사업 목록',renderList,true)]));
      const summary=section('핵심정보');
      summary.append(text('p',`${n.implementing_organization||n.managing_organization||'기관 미확인'} · 마감 ${formatDate(n.deadline_at)}`));
      if(n.eligibility_summary)summary.append(text('p',n.eligibility_summary,'support-radar-note'));
      if(e){
        const tags=document.createElement('div');tags.className='support-radar-tag-list';
        tags.append(text('span',`적합도 ${e.overall_score}점`,'support-radar-tag'),text('span',`추천 ${modeLabel(e.recommended_application_mode)}`,'support-radar-tag'),text('span',`신뢰도 ${e.confidence}`,'support-radar-tag'));summary.append(tags);
        if(e.recommendation_reason)summary.append(text('p',e.recommendation_reason,'support-radar-muted'));
        if(array(e.questions_to_confirm).length){const q=document.createElement('div');q.className='support-radar-note';q.append(text('strong','확인할 것'));array(e.questions_to_confirm).forEach(item=>q.append(text('p',`• ${item}`)));summary.append(q);}
      }
      root.append(summary);

      const progress=section('내 진행상태','운영총괄의 신청 결정 이후 실제 진행상태와 다음 행동을 기록합니다.');
      if(!a){
        progress.append(text('p','아직 운영총괄의 신청 결정이 없어 진행상태를 수정할 수 없습니다.','support-radar-warning'));
      }else{
        progress.append(text('p',`현재: ${statusLabel(a.status)}`));
        if(a.next_action)progress.append(text('p',`다음 행동: ${a.next_action}`,'support-radar-note'));
        const controls=document.createElement('div');controls.className='support-radar-grid';
        const select=document.createElement('select');
        [['reviewing','검토 중'],['contacting_agency','기관 문의'],['collecting_documents','자료 수집'],['drafting_application','신청서 작성'],['ready_to_submit','제출 준비'],['submitted','제출 완료'],['selected','선정'],['not_selected','미선정'],['cancelled','취소']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===a.status;select.append(option);});
        const next=document.createElement('input');next.type='text';next.maxLength=2000;next.placeholder='다음 행동 예: 공단 담당자에게 자격 문의';next.value=a.next_action||'';
        controls.append(select,next,button('진행상태 저장',()=>saveProgress(id,select.value,next.value)));progress.append(controls);
      }
      root.append(progress);
      main.replaceChildren(root);main.focus();
    }catch(error){main.replaceChildren(text('p',window.TaejangApp.friendlyError(error),'message error'));}
  }

  function watch(){if(observer)return;const nav=el('app-nav');if(!nav)return;observer=new MutationObserver(()=>queueMicrotask(injectNav));observer.observe(nav,{childList:true,subtree:true});}
  function setup(){if(!canUse())return;queueMicrotask(()=>{injectNav();watch();});}
  document.addEventListener('taejang-app-ready',setup);
  window.TaejangSupportRadarMyWork={renderList,renderDetail};
})();
