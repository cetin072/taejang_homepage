(() => {
  'use strict';

  let wrapped=false;
  const isOps=()=>Boolean(window.TaejangSupportRadarAccess?.canManagementEdit?.());
  const array=value=>Array.isArray(value)?value:[];

  function candidateMessage(items) {
    const first=items[0];
    const more=items.length>1?`\n외 ${items.length-1}건의 후보가 더 있습니다.`:'';
    return `같은 제목의 기존 지원사업 공고가 있습니다.\n\n${first.title}\n${first.organization||'기관 미확인'}\n\n[확인] 기존 공고에 새 출처만 연결\n[취소] 별도 공고로 등록하고 중복후보 표시${more}`;
  }

  function wrapRpc() {
    if(wrapped || !isOps() || !window.TaejangApp?.rpc) return;
    const original=window.TaejangApp.rpc;
    window.TaejangApp.rpc=async function(name,body={}){
      if(name!=='support_create_notice') return original(name,body);

      let candidates=[];
      try {
        candidates=array(await original('support_find_duplicate_candidates',{
          p_title:body.p_title,
          p_deadline_at:body.p_deadline_at||null,
          p_managing_organization:body.p_managing_organization||null
        }));
      } catch {
        // Duplicate assistance must never block a legitimate manual registration.
      }

      if(candidates.length) {
        const first=candidates[0];
        if(window.confirm(candidateMessage(candidates))) {
          return original('support_attach_notice_occurrence',{
            p_notice_id:first.notice_id,
            p_source_id:body.p_source_id,
            p_source_url:body.p_source_url,
            p_source_notice_id:body.p_source_notice_id||null,
            p_raw_title:body.p_title||null
          });
        }
      }

      const result=await original(name,body);
      if(candidates.length && result?.occurrence_id) {
        try {
          await original('support_mark_occurrence_duplicate_candidate',{p_occurrence_id:result.occurrence_id});
        } catch {
          // The notice itself is already safely registered; duplicate marking is secondary.
        }
      }
      return result;
    };
    wrapped=true;
  }

  function setup(){wrapRpc();}
  document.addEventListener('taejang-app-ready',setup);
  window.TaejangSupportRadarDedupe={wrapRpc};
})();
