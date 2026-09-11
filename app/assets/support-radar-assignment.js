(() => {
  'use strict';

  const state = { currentNoticeId: null, currentDetail: null, wrapped: false, observer: null, injecting: false };
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => { const node=document.createElement(tag); if(className)node.className=className; node.textContent=value??''; return node; };
  const array = value => Array.isArray(value)?value:[];
  const isOps = () => window.TaejangApp?.getRoute?.()==='operations_manager';
  const button = (label,action,quiet=false) => { const node=text('button',label,quiet?'button button-quiet':'button'); node.type='button'; node.addEventListener('click',action); return node; };
  const decisionLabel = value => ({ apply: '신청', hold: '보류', exclude: '제외' })[value] || value || '미결정';
  const prepLabels = new Set(['검토 중','기관 문의','자료 수집','신청서 작성','제출 준비']);

  function simplifyProgress(root) {
    const heading=[...root.querySelectorAll('h3')].find(node=>node.textContent==='신청 진행'||node.textContent==='진행 현황');
    const section=heading?.closest('.support-radar-section');
    if(!section || section.dataset.supportOpsProgressSimplified==='1') return;
    section.dataset.supportOpsProgressSimplified='1';
    heading.textContent='진행 현황';

    const directParagraphs=[...section.children].filter(node=>node.tagName==='P');
    const current=directParagraphs.find(node=>node.textContent.startsWith('현재 상태:')||node.textContent.startsWith('현재:'));
    if(current){
      const raw=current.textContent.replace(/^현재 상태:\s*/,'').replace(/^현재:\s*/,'').trim();
      current.textContent=`현재: ${prepLabels.has(raw)?'신청 진행 중':raw}`;
      current.classList.add('support-radar-note');
    }

    const reviewing=section.querySelector('option[value="reviewing"]');
    if(reviewing) reviewing.textContent='신청 준비';

    const advanced=[...section.children].filter(node=>node!==heading && node!==current);
    if(advanced.length){
      const details=document.createElement('details');
      details.className='support-radar-advanced';
      const summary=document.createElement('summary');
      summary.textContent='필요할 때 진행상태 직접 관리';
      details.append(summary,...advanced);
      section.append(details);
    }
  }

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
    if(!root) return;

    simplifyProgress(root);

    const headings=[...root.querySelectorAll('h3')];
    const decisionHeading=headings.find(node=>node.textContent==='운영총괄 결정');
    const decisionSection=decisionHeading?.closest('.support-radar-section');
    if(!decisionSection) return;

    const decision=state.currentDetail?.decision?.decision;
    const decisionReason=state.currentDetail?.decision?.decision_reason;
    if(decision){
      const note=decisionSection.querySelector('.support-radar-note');
      const desired=`현재 결정: ${decisionLabel(decision)}${decisionReason ? ` — ${decisionReason}` : ''}`;
      if(note && note.textContent !== desired) note.textContent=desired;
    }

    if(decision!=='apply') return;
    if(root.querySelector('[data-support-assignment-panel]') || state.injecting) return;

    state.injecting=true;
    try {
      const assignments=array(state.currentDetail.assignments);
      const candidates=array(await window.TaejangApp.rpc('support_list_assignable_profiles'));

      const liveRoot=el('dashboard-main')?.querySelector('.support-radar-shell');
      if(liveRoot!==root || root.querySelector('[data-support-assignment-panel]')) return;

      const panel=document.createElement('section');
      panel.className='support-radar-section';
      panel.dataset.supportAssignmentPanel='1';
      panel.append(text('h3','담당자 배정'),text('p','신청을 실제로 진행할 직원을 지정합니다. 배정된 직원은 자기 지원사업의 진행상태만 볼 수 있습니다.','support-radar-muted'));

      const current=document.createElement('div'); current.className='support-radar-list';
      if(!assignments.length) current.append(text('p','현재 담당자가 지정되지 않았습니다.','support-radar-empty'));
      assignments.forEach(item=>{
        const row=document.createElement('div'); row.className='support-radar-row';
        const info=document.createElement('div'); info.append(text('strong',item.display_name||'이름 미확인'),text('p',`배정 ${new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'}).format(new Date(item.assigned_at))}`,'support-radar-muted'));
        row.append(info,button('배정 해제',()=>unassign(item.profile_id,item.display_name),true)); current.append(row);
      });
      panel.append(current);

      const assignedIds=new Set(assignments.map(item=>item.profile_id));
      const available=candidates.filter(item=>!assignedIds.has(item.profile_id));
      if(available.length){
        const controls=document.createElement('div'); controls.className='support-radar-grid';
        const select=document.createElement('select'); select.setAttribute('aria-label','지원사업 담당자 선택');
        const first=document.createElement('option'); first.value=''; first.textContent='담당자 선택'; select.append(first);
        available.forEach(item=>{const option=document.createElement('option');option.value=item.profile_id;option.textContent=[item.display_name,item.department,item.position].filter(Boolean).join(' · ');select.append(option);});
        const assignButton=button('담당자로 배정',()=>assign(select.value)); controls.append(select,assignButton); panel.append(controls);
      } else panel.append(text('p','추가로 배정할 수 있는 활성 담당자가 없습니다.','support-radar-muted'));

      decisionSection.insertAdjacentElement('afterend',panel);
    } catch(error) {
      const liveRoot=el('dashboard-main')?.querySelector('.support-radar-shell');
      if(liveRoot===root && !root.querySelector('[data-support-assignment-panel]')) {
        const panel=document.createElement('section');
        panel.className='support-radar-section'; panel.dataset.supportAssignmentPanel='1';
        panel.append(text('h3','담당자 배정'),text('p','담당자 후보를 불러오지 못했습니다.','message error'));
        decisionSection.insertAdjacentElement('afterend',panel);
      }
    } finally {
      state.injecting=false;
    }
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
