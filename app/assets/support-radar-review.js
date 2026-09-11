(() => {
  'use strict';

  const state={currentNoticeId:null,loading:false};
  const el=id=>document.getElementById(id);
  const text=(tag,value,className)=>{const node=document.createElement(tag);if(className)node.className=className;node.textContent=value??'';return node;};
  const button=(label,action,quiet=false)=>{const node=text('button',label,quiet?'button button-quiet':'button');node.type='button';node.addEventListener('click',action);return node;};
  const canUse=()=>Boolean(window.TaejangSupportRadarAccess?.canUse?.());
  const canMark=()=>Boolean(window.TaejangSupportRadarAccess?.canReview?.());

  function formatDate(value){if(!value)return '아직 없음';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(d);}

  async function markReviewed(kind,note){
    if(!canMark()||!state.currentNoticeId)return;
    try{
      await window.TaejangApp.rpc('support_mark_notice_reviewed',{p_notice_id:state.currentNoticeId,p_review_kind:kind,p_note:note||null});
      const panel=el('dashboard-main')?.querySelector('[data-support-review-panel]');if(panel)panel.remove();
      await inject();
    }catch(error){window.alert(window.TaejangApp.friendlyError(error));}
  }

  async function inject(){
    if(!canUse()||!state.currentNoticeId||state.loading)return;
    const root=el('dashboard-main')?.querySelector('.support-radar-shell');
    if(!root||root.querySelector('[data-support-review-panel]'))return;
    const headings=[...root.querySelectorAll('h3')];
    if(!headings.some(node=>node.textContent==='공고 기본정보'||node.textContent==='핵심정보'))return;
    state.loading=true;
    try{
      const data=await window.TaejangApp.rpc('support_get_notice_review_status',{p_notice_id:state.currentNoticeId});
      const liveRoot=el('dashboard-main')?.querySelector('.support-radar-shell');
      if(liveRoot!==root || root.querySelector('[data-support-review-panel]')) return;
      const panel=document.createElement('section');panel.className='support-radar-section';panel.dataset.supportReviewPanel='1';
      panel.append(text('h3','검토 기록'));
      if(!data.review_count){panel.append(text('p','아직 사람이 검토 완료로 표시한 기록이 없습니다.','support-radar-warning'));}
      else{
        panel.append(text('p',`최초 검토 ${formatDate(data.first_reviewed_at)} · 최근 검토 ${formatDate(data.last_reviewed_at)} · 총 ${data.review_count}회`,'support-radar-muted'));
        if(data.latest_review){panel.append(text('p',`${data.latest_review.reviewer_name||'담당자'} · ${data.latest_review.review_kind}${data.latest_review.note?` · ${data.latest_review.note}`:''}`,'support-radar-note'));}
      }
      if(canMark()){
        const controls=document.createElement('div');controls.className='support-radar-grid';
        const kind=document.createElement('select');
        [['initial','초기 검토'],['eligibility','자격 검토'],['application','신청 준비 검토'],['result','결과 검토'],['other','기타 검토']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;kind.append(option);});
        const note=document.createElement('input');note.type='text';note.maxLength=2000;note.placeholder='검토 메모(선택)';
        controls.append(kind,note,button('검토 완료 표시',()=>markReviewed(kind.value,note.value)));panel.append(controls);
      }
      const baseHeading=headings.find(node=>node.textContent==='공고 기본정보'||node.textContent==='핵심정보');
      const baseSection=baseHeading?.closest('.support-radar-section');
      if(baseSection)baseSection.insertAdjacentElement('afterend',panel);else root.append(panel);
    }catch{/* detail itself remains usable if review metadata cannot be loaded */}
    finally{state.loading=false;}
  }

  document.addEventListener('taejang-support-radar-rendered',event=>{
    if(!['notice-detail','assigned-detail'].includes(event.detail?.surface) || !canUse()) return;
    state.currentNoticeId=event.detail.noticeId;
    queueMicrotask(inject);
  });
  window.TaejangSupportRadarReview={inject};
})();
