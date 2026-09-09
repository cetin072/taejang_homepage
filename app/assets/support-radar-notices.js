(() => {
  'use strict';

  const allowedRoles = new Set(['operations_manager', 'ceo']);
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => { const node = document.createElement(tag); if (className) node.className = className; node.textContent = value ?? ''; return node; };
  const array = value => Array.isArray(value) ? value : [];
  const clean = value => String(value ?? '').trim();
  const unique = values => [...new Set(values.map(clean).filter(Boolean))];
  let observer;

  function canUse() { return allowedRoles.has(window.TaejangApp?.getRoute?.()); }
  function canEdit() { return window.TaejangApp?.getRoute?.() === 'operations_manager'; }
  function closeSidebar() { el('desktop-app-shell')?.classList.remove('sidebar-open'); el('sidebar-toggle')?.setAttribute('aria-expanded','false'); }
  function setTitle(value) { const node=el('desktop-page-title'); if(node) node.textContent=value; }
  function button(label, action, quiet=false) { const node=text('button',label,quiet?'button button-quiet':'button'); node.type='button'; node.addEventListener('click',action); return node; }
  function formatDate(value) { if(!value) return '미정'; const d=new Date(value); return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'}).format(d); }
  function money(value) { const amount=Number(value); return Number.isFinite(amount)&&amount>0?`${new Intl.NumberFormat('ko-KR').format(amount)}원`:'미정'; }
  function eligibilityLabel(value) { return ({eligible:'가능',conditional:'조건부',ineligible:'불가',verify:'확인 필요'})[value] || '미평가'; }
  function modeLabel(value) { return ({direct:'직접신청',joint:'공동신청',partner:'협력기관',none:'진행 안 함',verify:'확인 필요'})[value] || '미평가'; }
  function statusLabel(value) { return ({reviewing:'검토 중',contacting_agency:'기관 문의',collecting_documents:'자료 수집',drafting_application:'신청서 작성',ready_to_submit:'제출 준비',submitted:'제출 완료',selected:'선정',not_selected:'미선정',cancelled:'취소'})[value] || value || '없음'; }

  function header(title, copy, actions=[]) {
    const node=document.createElement('header'); node.className='support-radar-header';
    const left=document.createElement('div'); left.append(text('p','지원사업 레이더','eyebrow'),text('h2',title),text('p',copy));
    const right=document.createElement('div'); right.className='support-radar-actions'; actions.forEach(item=>right.append(item));
    node.append(left,right); return node;
  }
  function section(title, copy='') { const node=document.createElement('section'); node.className='support-radar-section'; node.append(text('h3',title)); if(copy) node.append(text('p',copy,'support-radar-muted')); return node; }
  function stat(label,value,note='') { const node=document.createElement('article'); node.className='support-radar-stat'; node.append(text('span',label,'support-radar-muted'),text('strong',value)); if(note) node.append(text('span',note,'support-radar-muted')); return node; }

  function goHome() { window.TaejangSupportRadar?.open?.('dashboard'); }
  function goProfile() { window.TaejangSupportRadar?.open?.('profile'); }

  function injectNav() {
    if(!canUse()) return;
    const group=document.querySelector('[data-support-radar-nav-group]');
    if(!group || group.querySelector('[data-support-notices-nav]')) return;
    const notices=button('전체 공고',renderList); notices.dataset.supportNoticesNav='list';
    group.append(notices);
    if(canEdit()) {
      const add=button('공고 등록',renderCreateNotice); add.dataset.supportNoticesNav='create';
      const sources=button('정보원 관리',renderSources); sources.dataset.supportNoticesNav='sources';
      group.append(add,sources);
    }
  }

  async function enrichDashboard() {
    if(!canUse()) return;
    const main=el('dashboard-main');
    const shell=main?.querySelector('.support-radar-shell');
    if(!shell || shell.dataset.noticeDashboardEnriched==='1') return;
    const title=shell.querySelector('h2')?.textContent;
    if(title!=='지원사업 레이더') return;
    shell.dataset.noticeDashboardEnriched='1';
    try {
      const data=await window.TaejangApp.rpc('support_get_dashboard');
      const summary=document.createElement('div'); summary.className='support-radar-summary'; summary.dataset.supportDashboardLive='1';
      summary.append(
        stat('열린 공고',`${data.open_count||0}건`,'현재 검토 대상'),
        stat('7일 내 마감',`${data.deadline_7_count||0}건`,'우선 확인'),
        stat('미평가',`${data.unreviewed_count||0}건`,'현재 기업 프로필 기준'),
        stat('신청 진행',`${data.application_count||0}건`,'선정·종료 전')
      );
      shell.append(summary);
      const top=section('이번 주 우선 검토 TOP 5','현재 기업 프로필과 Rule Engine 평가를 기준으로 정렬합니다.');
      const items=array(data.top_items);
      if(!items.length) top.append(text('p',data.profile_required?'기업 프로필을 먼저 등록한 뒤 공고를 평가하세요.':'평가된 열린 공고가 아직 없습니다.','support-radar-empty'));
      items.forEach(item=>top.append(noticeCard(item,()=>renderDetail(item.notice_id))));
      const actions=document.createElement('div'); actions.className='support-radar-actions'; actions.append(button('전체 공고 보기',renderList)); if(canEdit()) actions.append(button('공고 직접 등록',renderCreateNotice,true)); top.append(actions);
      shell.append(top);
    } catch(error) {
      shell.append(text('p',window.TaejangApp.friendlyError(error),'message error'));
    }
  }

  function noticeCard(item,onOpen) {
    const card=document.createElement('article'); card.className='support-radar-row';
    const top=document.createElement('div'); top.className='support-radar-header';
    const left=document.createElement('div'); left.append(text('p',item.organization||'기관 미확인','eyebrow'),text('h3',item.title||'제목 없음'));
    const score=Number.isFinite(Number(item.score))&&item.score!==null?`${item.score}점`:'미평가';
    const badge=text('strong',score,'support-score-badge'); top.append(left,badge); card.append(top);
    const meta=document.createElement('div'); meta.className='support-radar-tag-list';
    [
      `마감 ${formatDate(item.deadline_at||item.deadline)}`,
      item.application_mode?modeLabel(item.application_mode):'신청방식 미평가',
      item.decision?`결정 ${item.decision}`:null,
      item.application_status?statusLabel(item.application_status):null,
      item.in_kind_available?'현물지원':null,
      Number(item.cash_support_max)>0?`최대 ${money(item.cash_support_max)}`:null
    ].filter(Boolean).forEach(value=>meta.append(text('span',value,'support-radar-tag')));
    card.append(meta);
    if(item.recommendation) card.append(text('p',item.recommendation));
    if(item.needs_current_profile_evaluation) card.append(text('p','현재 기업 프로필 기준 재평가가 필요합니다.','support-radar-warning'));
    card.append(button('상세 보기',onOpen,true));
    return card;
  }

  async function renderList() {
    if(!canUse()) return;
    closeSidebar(); setTitle('지원사업 전체 공고');
    const main=el('dashboard-main'); main.replaceChildren(text('p','지원사업 공고를 불러오고 있습니다.','message'));
    try {
      const items=array(await window.TaejangApp.rpc('support_list_notices',{p_limit:200}));
      const root=document.createElement('div'); root.className='support-radar-shell';
      root.append(header('전체 공고','수집·등록된 공고를 마감일과 태장 적합도 기준으로 검토합니다.',[button('레이더 홈',goHome,true),canEdit()?button('공고 등록',renderCreateNotice):null].filter(Boolean)));
      const filter=section('빠른 찾기');
      const search=document.createElement('input'); search.type='search'; search.placeholder='사업명·기관·분야 검색'; search.setAttribute('aria-label','지원사업 검색');
      const list=document.createElement('div'); list.className='support-radar-list';
      const render=()=>{
        list.replaceChildren(); const q=clean(search.value).toLowerCase();
        const filtered=items.filter(item=>!q||[item.title,item.organization,JSON.stringify(item.categories)].join(' ').toLowerCase().includes(q));
        if(!filtered.length) list.append(text('p','조건에 맞는 공고가 없습니다.','support-radar-empty'));
        filtered.forEach(item=>list.append(noticeCard(item,()=>renderDetail(item.id))));
      };
      search.addEventListener('input',render); filter.append(search); root.append(filter,list); main.replaceChildren(root); render(); main.focus();
    } catch(error) { main.replaceChildren(text('p',window.TaejangApp.friendlyError(error),'message error')); }
  }

  function infoRow(label,value) { const wrap=document.createElement('div'); wrap.className='support-radar-profile-card'; wrap.append(text('strong',label),text('span',value||'미확인')); return wrap; }

  async function renderDetail(id) {
    if(!canUse()) return;
    closeSidebar(); setTitle('지원사업 상세');
    const main=el('dashboard-main'); main.replaceChildren(text('p','공고 상세를 불러오고 있습니다.','message'));
    try {
      const data=await window.TaejangApp.rpc('support_get_notice_detail',{p_notice_id:id}); const n=data.notice; const e=data.evaluation;
      const root=document.createElement('div'); root.className='support-radar-shell';
      root.append(header(n.title,'원문·태장 적합도·사람의 결정·신청 진행을 한 화면에서 확인합니다.',[button('전체 공고',renderList,true),button('레이더 홈',goHome,true)]));
      const base=section('공고 기본정보'); const grid=document.createElement('div'); grid.className='support-radar-summary';
      grid.append(infoRow('기관',n.implementing_organization||n.managing_organization),infoRow('마감',formatDate(n.deadline_at)),infoRow('지원규모',money(n.cash_support_max||n.cash_support_min)),infoRow('현물지원',n.in_kind_available?'있음':'없음'),infoRow('자부담',n.self_funding_rate!==null&&n.self_funding_rate!==undefined?`${n.self_funding_rate}%`:(n.self_funding_required?'있음':'미확인'))); base.append(grid);
      if(n.eligibility_summary) base.append(text('p',n.eligibility_summary));
      if(n.canonical_url) { const link=document.createElement('a'); link.href=n.canonical_url; link.target='_blank'; link.rel='noopener noreferrer'; link.className='button button-quiet'; link.textContent='원문 열기'; base.append(link); }
      root.append(base);

      const evalSection=section('태장 적합도');
      if(!e) {
        evalSection.append(text('p','현재 기업 프로필 기준 평가가 없습니다.','support-radar-warning'));
        if(canEdit()) evalSection.append(button('Rule Engine v1 평가 실행',async()=>{ await evaluate(id); }));
      } else {
        const scores=document.createElement('div'); scores.className='support-radar-summary';
        scores.append(stat('종합',`${e.overall_score}점`,e.recommendation||''),stat('자격',`${e.eligibility_score}/30`),stat('전략연관',`${e.strategic_fit_score}/20`),stat('경제가치',`${e.economic_value_score}/15`),stat('실행가능',`${e.execution_score}/15`),stat('선정가능',`${e.selection_score}/10`),stat('시급성',`${e.urgency_score}/10`),stat('신뢰도',e.confidence)); evalSection.append(scores);
        const paths=document.createElement('div'); paths.className='support-radar-summary'; paths.append(stat('A 직접',eligibilityLabel(e.direct_eligibility)),stat('B 공동',eligibilityLabel(e.joint_eligibility)),stat('C 협력',eligibilityLabel(e.partner_eligibility)),stat('추천 경로',modeLabel(e.recommended_application_mode))); evalSection.append(paths);
        if(e.recommendation_reason) evalSection.append(text('p',e.recommendation_reason,'support-radar-note'));
        if(array(e.qualification_gaps).length) { const gap=section('자격 Gap'); array(e.qualification_gaps).forEach(item=>gap.append(text('p',item.label||String(item)))); evalSection.append(gap); }
        if(array(e.questions_to_confirm).length) { const questions=section('반드시 확인할 것'); array(e.questions_to_confirm).forEach(item=>questions.append(text('p',`• ${item}`))); evalSection.append(questions); }
        if(canEdit()) evalSection.append(button('현재 프로필로 다시 평가',async()=>{ await evaluate(id); },true));
      }
      root.append(evalSection);

      const decision=section('운영총괄 결정');
      if(data.decision) decision.append(text('p',`현재 결정: ${data.decision.decision} — ${data.decision.decision_reason}`,'support-radar-note'));
      else decision.append(text('p','아직 신청/보류/제외 결정이 없습니다.','support-radar-muted'));
      if(canEdit()) {
        const actions=document.createElement('div'); actions.className='support-radar-actions';
        [['apply','신청'],['hold','보류'],['exclude','제외']].forEach(([value,label])=>actions.append(button(label,()=>decide(id,value,label),value!=='apply'))); decision.append(actions);
      }
      root.append(decision);

      if(data.application) {
        const app=section('신청 진행'); app.append(text('p',`현재 상태: ${statusLabel(data.application.status)}`));
        if(data.application.next_action) app.append(text('p',`다음 행동: ${data.application.next_action}`));
        if(canEdit()) {
          const select=document.createElement('select');
          [['reviewing','검토 중'],['contacting_agency','기관 문의'],['collecting_documents','자료 수집'],['drafting_application','신청서 작성'],['ready_to_submit','제출 준비'],['submitted','제출 완료'],['selected','선정'],['not_selected','미선정'],['cancelled','취소']].forEach(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;o.selected=value===data.application.status;select.append(o);});
          const next=document.createElement('input'); next.type='text'; next.placeholder='다음 행동'; next.value=data.application.next_action||'';
          const save=button('진행상태 저장',async()=>{ try{await window.TaejangApp.rpc('support_update_application_status',{p_notice_id:id,p_status:select.value,p_next_action:next.value||null}); await renderDetail(id);}catch(error){window.alert(window.TaejangApp.friendlyError(error));} });
          const controls=document.createElement('div'); controls.className='support-radar-grid'; controls.append(select,next,save); app.append(controls);
        }
        root.append(app);
      }
      main.replaceChildren(root); main.focus();
    } catch(error) { main.replaceChildren(text('p',window.TaejangApp.friendlyError(error),'message error')); }
  }

  async function evaluate(id) {
    try { await window.TaejangApp.rpc('support_evaluate_notice_v1',{p_notice_id:id}); await renderDetail(id); }
    catch(error) { window.alert(error?.message?.includes('PROFILE_REQUIRED')?'기업 프로필을 먼저 저장해주세요.':window.TaejangApp.friendlyError(error)); }
  }

  async function decide(id,value,label) {
    const reason=window.prompt(`${label} 사유를 입력하세요.`,'지원사업 공고와 태장 적합도를 검토함'); if(!reason) return;
    try { await window.TaejangApp.rpc('support_set_decision',{p_notice_id:id,p_decision:value,p_reason:reason}); await renderDetail(id); }
    catch(error) { window.alert(window.TaejangApp.friendlyError(error)); }
  }

  function formField(label,type='text') { const wrap=document.createElement('label'); wrap.append(text('span',label)); const input=document.createElement('input'); input.type=type; wrap.append(input); return {wrap,input}; }
  function textarea(label,rows=3) { const wrap=document.createElement('label'); wrap.append(text('span',label)); const input=document.createElement('textarea'); input.rows=rows; wrap.append(input); return {wrap,input}; }

  async function renderCreateNotice() {
    if(!canEdit()) return;
    closeSidebar(); setTitle('지원사업 공고 등록'); const main=el('dashboard-main'); main.replaceChildren(text('p','등록 화면을 준비하고 있습니다.','message'));
    try {
      const sources=array(await window.TaejangApp.rpc('support_list_sources'));
      const root=document.createElement('div'); root.className='support-radar-shell'; root.append(header('공고 직접 등록','자동수집 전에도 중요한 공고를 URL과 핵심정보만 입력해 즉시 관리할 수 있습니다.',[button('전체 공고',renderList,true),button('정보원 관리',renderSources,true)]));
      if(!sources.length){const empty=section('정보원이 먼저 필요합니다.'); empty.append(text('p','공고가 올라온 기관 또는 사이트를 먼저 등록하세요.'),button('정보원 등록하기',renderSources)); root.append(empty); main.replaceChildren(root); return;}
      const form=document.createElement('form'); form.className='support-radar-form'; const base=section('공고 핵심정보'); const grid=document.createElement('div'); grid.className='support-radar-grid';
      const title=formField('사업명'); title.input.required=true; const sourceUrl=formField('공고 URL','url'); sourceUrl.input.required=true; const sourceId=document.createElement('select'); sources.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;sourceId.append(o);}); const sourceWrap=document.createElement('label'); sourceWrap.append(text('span','정보원'),sourceId);
      const sourceNoticeId=formField('정보원 공고 ID'); const agency=formField('주관·수행기관'); const announced=formField('공고일','date'); const start=formField('신청 시작일','date'); const deadline=formField('마감일','date'); const amount=formField('최대 지원금','number'); amount.input.min='0'; const regions=formField('대상지역'); regions.input.placeholder='예: 전국, 경상남도, 창원시'; const categories=formField('분야'); categories.input.placeholder='예: 고용, 원예, AI·디지털';
      grid.append(title.wrap,sourceWrap,sourceUrl.wrap,sourceNoticeId.wrap,agency.wrap,announced.wrap,start.wrap,deadline.wrap,amount.wrap,regions.wrap,categories.wrap); base.append(grid);
      const inKind=document.createElement('label'); const inKindInput=document.createElement('input'); inKindInput.type='checkbox'; inKind.append(inKindInput,text('span','차량·시설·장비 등 현물지원 있음')); base.append(inKind);
      const eligibility=textarea('신청자격 요약',4); const duplicate=textarea('중복지원 제한',2); base.append(eligibility.wrap,duplicate.wrap); form.append(base);
      const save=button('공고 저장 후 평가',()=>{}); save.type='submit'; form.append(save);
      form.addEventListener('submit',async event=>{event.preventDefault(); save.disabled=true; try{const result=await window.TaejangApp.rpc('support_create_notice',{p_title:clean(title.input.value),p_source_id:sourceId.value,p_source_url:clean(sourceUrl.input.value),p_source_notice_id:clean(sourceNoticeId.input.value)||null,p_managing_organization:clean(agency.input.value)||null,p_announced_at:announced.input.value?`${announced.input.value}T00:00:00+09:00`:null,p_application_start_at:start.input.value?`${start.input.value}T00:00:00+09:00`:null,p_deadline_at:deadline.input.value?`${deadline.input.value}T23:59:59+09:00`:null,p_notice_status:'open',p_cash_support_max:amount.input.value||null,p_in_kind_available:inKindInput.checked,p_target_regions:unique(regions.input.value.split(',')),p_categories:unique(categories.input.value.split(',')),p_eligibility_summary:clean(eligibility.input.value)||null,p_duplicate_support_rule:clean(duplicate.input.value)||null}); if(!result?.notice_id) throw new Error('SAVE_FAILED'); try{await window.TaejangApp.rpc('support_evaluate_notice_v1',{p_notice_id:result.notice_id});}catch{} await renderDetail(result.notice_id);}catch(error){window.alert(window.TaejangApp.friendlyError(error));}finally{save.disabled=false;}});
      root.append(form); main.replaceChildren(root); main.focus();
    } catch(error) { main.replaceChildren(text('p',window.TaejangApp.friendlyError(error),'message error')); }
  }

  async function renderSources() {
    if(!canEdit()) return;
    closeSidebar(); setTitle('지원사업 정보원'); const main=el('dashboard-main'); main.replaceChildren(text('p','정보원을 불러오고 있습니다.','message'));
    try {
      const sources=array(await window.TaejangApp.rpc('support_list_sources')); const root=document.createElement('div'); root.className='support-radar-shell'; root.append(header('정보원 관리','기업마당·공공기관·지자체 등 공고 출처를 관리합니다. 자동수집은 공식 접근방식이 확인된 정보원만 후속 연결합니다.',[button('공고 등록',renderCreateNotice,true),button('레이더 홈',goHome,true)]));
      const list=section('현재 정보원'); if(!sources.length) list.append(text('p','등록된 정보원이 없습니다.','support-radar-empty')); sources.forEach(s=>list.append(noticeCard({title:s.name,organization:s.organization_name,deadline:null,recommendation:`${s.access_method} · ${s.terms_review_status} · 자동화 ${s.automation_status}`},()=>{}))); root.append(list);
      const form=document.createElement('form'); form.className='support-radar-section'; form.append(text('h3','정보원 추가')); const code=formField('내부 코드'); code.input.placeholder='예: bizinfo'; code.input.required=true; const name=formField('정보원 이름'); name.input.required=true; const org=formField('운영기관'); const url=formField('기본 URL','url'); const grid=document.createElement('div');grid.className='support-radar-grid';grid.append(code.wrap,name.wrap,org.wrap,url.wrap); form.append(grid); const submit=button('정보원 저장',()=>{}); submit.type='submit'; form.append(submit); form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{await window.TaejangApp.rpc('support_create_source',{p_code:clean(code.input.value).toLowerCase(),p_name:clean(name.input.value),p_organization_name:clean(org.input.value)||null,p_base_url:clean(url.input.value)||null,p_access_method:'manual',p_terms_review_status:'unreviewed',p_automation_status:'manual_only'});await renderSources();}catch(error){window.alert(window.TaejangApp.friendlyError(error));}finally{submit.disabled=false;}}); root.append(form); main.replaceChildren(root); main.focus();
    } catch(error){main.replaceChildren(text('p',window.TaejangApp.friendlyError(error),'message error'));}
  }

  function watch() {
    if(observer) return; const main=el('dashboard-main'); if(!main) return;
    observer=new MutationObserver(()=>queueMicrotask(()=>{injectNav();enrichDashboard();})); observer.observe(main,{childList:true,subtree:true});
  }
  function setup(){if(!canUse()) return;queueMicrotask(()=>{injectNav();watch();enrichDashboard();});}
  document.addEventListener('taejang-app-ready',setup);
  document.addEventListener('taejang-dashboard-refresh',()=>queueMicrotask(injectNav));
  window.TaejangSupportRadarNotices={renderList,renderDetail,renderCreateNotice,renderSources,enrichDashboard};
})();
