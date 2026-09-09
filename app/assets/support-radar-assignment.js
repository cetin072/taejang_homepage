(() => {
  'use strict';

  const state = { currentNoticeId: null, currentDetail: null, wrapped: false, observer: null };
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => { const node=document.createElement(tag); if(className)node.className=className; node.textContent=value??''; return node; };
  const array = value => Array.isArray(value)?value:[];
  const isOps = () => window.TaejangApp?.getRoute?.()==='operations_manager';
  const button = (label,action,quiet=false) => { const node=text('button',label,quiet?'button button-quiet':'button'); node.type='button'; node.addEventListener('click',action); return node; };

  function wrapRpc() {
    if(state.wrapped || !window.TaejangApp?.rpc) return;
    const original=window.TaejangApp.rpc;
    window.TaejangApp.rpc=async function(name,body={}){
      const result=await original(name,body);
      if(name==='support_get_notice_detail' && body?.p_notice_id){
        state.currentNoticeId=body.p_notice_id;
        state.currentDetail=result;
        queueMicrotask(inject);
      }
      return result;
    };
    state.wrapped=true;
  }

  async function assign(profileId) {
    if(!state.currentNoticeId || !profileId) return;
    try {
      await window.TaejangApp.rpc('support_assign_notice',{p_notice_id:state.currentNoticeId,p_profile_id:profileId,p_note:'지원사업 레이더에서 담당자 배정'});
      await window.TaejangSupportRadarNotices?.renderDetail?.(state.currentNoticeId);
    } catch(error) { window.alert(window.TaejangApp.friendlyError(error)); }
  }

  async function unassign(profileId,name) {
    if(!state.currentNoticeId || !profileId) return;
    if(!window.confirm(`${name||'담당자'} 배정을 해제할까요?`)) return;
    try {
      await window.TaejangApp.rpc('support_unassign_notice',{p_notice_id:state.currentNoticeId,p_profile_id:profileId,p_reason:'운영총괄이 지원사업 레이더에서 배정 해제'});
      await window.TaejangSupportRadarNotices?.renderDetail?.(state.currentNoticeId);
    } catch(error) { window.alert(window.TaejangApp.friendlyError(error)); }
  }

  async function inject() {
    if(!isOps() || !state.currentNoticeId || !state.currentDetail) return;
    const main=el('dashboard-main');
    const root=main?.querySelector('.support-radar-shell');
    if(!root || root.querySelector('[data-support-assignment-panel]')) return;
    const headings=[...root.querySelectorAll('h3')];
    if(!headings.some(node=>node.textContent==='운영총괄 결정')) return;

    const panel=document.createElement('section');
    panel.className='support-radar-section';
    panel.dataset.supportAssignmentPanel='1';
    panel.append(text('h3','담당자 배정'),text('p','신청을 실제로 진행할 직원을 지정합니다. 배정된 직원은 자기 지원사업의 진행상태만 볼 수 있습니다.','support-radar-muted'));

    const current=document.createElement('div'); current.className='support-radar-list';
    const assignments=array(state.currentDetail.assignments);
    if(!assignments.length) current.append(text('p','현재 담당자가 지정되지 않았습니다.','support-radar-empty'));
    assignments.forEach(item=>{
      const row=document.createElement('div'); row.className='support-radar-row';
      const info=document.createElement('div'); info.append(text('strong',item.display_name||'이름 미확인'),text('p',`배정 ${new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'}).format(new Date(item.assigned_at))}`,'support-radar-muted'));
      row.append(info,button('배정 해제',()=>unassign(item.profile_id,item.display_name),true)); current.append(row);
    });
    panel.append(current);

    try {
      const candidates=array(await window.TaejangApp.rpc('support_list_assignable_profiles'));
      const assignedIds=new Set(assignments.map(item=>item.profile_id));
      const available=candidates.filter(item=>!assignedIds.has(item.profile_id));
      if(available.length){
        const controls=document.createElement('div'); controls.className='support-radar-grid';
        const select=document.createElement('select'); select.setAttribute('aria-label','지원사업 담당자 선택');
        const first=document.createElement('option'); first.value=''; first.textContent='담당자 선택'; select.append(first);
        available.forEach(item=>{const option=document.createElement('option');option.value=item.profile_id;option.textContent=[item.display_name,item.department,item.position].filter(Boolean).join(' · ');select.append(option);});
        const assignButton=button('담당자로 배정',()=>assign(select.value)); controls.append(select,assignButton); panel.append(controls);
      } else panel.append(text('p','추가로 배정할 수 있는 활성 담당자가 없습니다.','support-radar-muted'));
    } catch(error) {
      panel.append(text('p','담당자 후보를 불러오지 못했습니다.','message error'));
    }

    const decisionHeading=headings.find(node=>node.textContent==='운영총괄 결정');
    const decisionSection=decisionHeading?.closest('.support-radar-section');
    if(decisionSection) decisionSection.insertAdjacentElement('afterend',panel); else root.append(panel);
  }

  function watch(){
    if(state.observer) return;
    const main=el('dashboard-main'); if(!main) return;
    state.observer=new MutationObserver(()=>queueMicrotask(inject));
    state.observer.observe(main,{childList:true,subtree:true});
  }

  function setup(){ if(!isOps()) return; wrapRpc(); watch(); }
  document.addEventListener('taejang-app-ready',setup);
  window.TaejangSupportRadarAssignment={inject};
})();
