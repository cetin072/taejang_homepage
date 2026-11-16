(() => {
  'use strict';
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const rpc = (name, args = {}) => window.TaejangApp.rpc(name, args);
  const labels = { pending:'승인 대기', approved:'승인', rejected:'반려', cancelled:'취소', full:'종일', first_half:'앞 반차', second_half:'뒤 반차' };
  const messages = { LEAVE_THREE_DAYS_REQUIRED:'사용일 최소 3일 전 날짜를 선택해주세요.', REQUEST_ID_CONFLICT:'이전 요청 결과를 먼저 새로고침해 확인해주세요.', LEAVE_ALREADY_INITIALIZED:'이미 연차가 등록된 직원입니다. 새로고침 후 확인해주세요. 개수 변경은 운영총괄에게 요청해주세요.', ROSTER_METADATA_REQUIRED:'직원 재직·직급 정보의 서버 업데이트가 필요합니다. 직원 목록을 불러올 수 없습니다.', WORK_TERMS_ATTENDANCE_CONFLICT:'선택한 적용일에는 이미 출근 기록이 있습니다. 기존 기록은 유지됩니다. 출근 기록이 없는 다음 날짜를 달력에서 선택해주세요.', FUTURE_OR_TODAY_REQUIRED:'지난 날짜에는 적용할 수 없습니다. 오늘 이후 날짜를 달력에서 선택해주세요.', TIME_REQUIRED:'출근·퇴근 시각을 선택해주세요.', INVALID_WORK_TIME:'퇴근 시각은 출근 시각보다 늦어야 합니다. 24시간 기준으로 확인해주세요.', INVALID_BREAK_TIME:'휴게 시작·종료를 근무시간 안에서 순서대로 선택해주세요.', WEEKDAYS_REQUIRED:'근무요일을 선택해주세요.', DATE_REQUIRED:'날짜를 달력에서 선택해주세요.', LOCATION_REQUIRED:'사용할 근무장소를 선택해주세요.', FORBIDDEN:'현재 권한으로 처리할 수 없습니다.', LEAVE_ALREADY_STARTED:'사용일이 된 연차는 이 화면에서 변경할 수 없습니다. 관리자에게 문의해주세요.', LEAVE_CHANGE_PENDING:'취소·수정 요청을 먼저 처리해주세요.', LEAVE_NOT_ACTIVE:'이미 취소되거나 처리된 연차입니다.', SELF_APPROVAL_FORBIDDEN:'본인의 연차는 직접 승인할 수 없습니다.', PROTECTED_EMPLOYEE_REVIEW_REQUIRED:'본인보다 하위 직급의 연차만 처리할 수 있습니다. 운영총괄에게 요청해주세요.', DAY_CONFIRMED_REOPEN_REQUIRED:'확정된 근태입니다. 먼저 확정 재개방이 필요합니다.', LEAVE_SCHEDULE_CONFLICT:'신청된 연차와 겹칩니다. 신청 처리 후 다시 설정해주세요.', APPEND_NEW_EFFECTIVE_DATE_REQUIRED:'기존 적용일보다 뒤의 새 적용일을 입력해주세요.', ATTENDANCE_CONFLICT:'기존 근태와 충돌합니다. 원본을 확인해주세요.', BASELINE_MUST_BE_TODAY:'최초 잔여는 오늘 기준으로 확인해 입력해주세요.', INSUFFICIENT_LEAVE:'신청 예약분을 제외한 잔여가 부족합니다.' };
  Object.assign(messages,{
    URGENT_LEAVE_DATE_REQUIRED:'오늘부터 이틀 뒤까지의 날짜만 대리 등록할 수 있습니다.',
    LEAVE_NOT_CONFIGURED:'직원별 연차 등록·현황에서 해당 직원의 최초 연차를 등록해주세요.',
    NOT_SCHEDULED_WORKDAY:'해당 직원의 근무일을 선택해주세요.',
    EMPLOYEE_NOT_ACTIVE:'근무 중인 직원을 선택해주세요.',
    INVALID_REQUEST:'직원·사용일을 선택하고 등록 사유를 2~300자로 입력해주세요.'
  });
  function errorText(error) { const s = String(error?.message || error || ''); const codes = new Set(s.match(/\b[A-Z][A-Z0-9_]*\b/g) || []); return Object.entries(messages).find(([k]) => codes.has(k))?.[1] || '저장하지 못했습니다. 입력값과 연결 상태를 확인하고 다시 시도해주세요.'; }
  function button(text, run) { const b = el('button',text,'button button-quiet'); b.type='button'; b.addEventListener('click',run); return b; }
  function dateField(form,label,value='',required=true){
    const wrap=el('div',null,'leave-date-field'),name=el('span',label),pick=button('',()=>{calendar.hidden=!calendar.hidden;if(!calendar.hidden){month=(selected||pick.min||new Date().toISOString().slice(0,10)).slice(0,7);draw();}}),calendar=el('div',null,'leave-calendar');
    pick.setAttribute('aria-label',label);pick.setAttribute('aria-expanded','false');pick.classList.add('leave-date-button');calendar.hidden=true;calendar.setAttribute('role','group');calendar.setAttribute('aria-label',label+' 달력');let selected=value,month=(value||new Date().toISOString().slice(0,10)).slice(0,7);
    Object.defineProperty(pick,'value',{get:()=>selected,set:v=>{selected=v;pick.textContent=v?v.replaceAll('-','. '):'달력에서 선택';}});pick.value=value;if(required)pick.dataset.dateRequired='true';
    pick.addEventListener('click',()=>pick.setAttribute('aria-expanded',String(!calendar.hidden)));
    const close=()=>{calendar.hidden=true;pick.setAttribute('aria-expanded','false');pick.focus();};
    function draw(){
      calendar.replaceChildren();const head=el('div',null,'leave-calendar-head');const [y,m]=month.split('-').map(Number);const shift=n=>{const d=new Date(Date.UTC(y,m-1+n,1));month=d.toISOString().slice(0,7);draw();};
      head.append(button('이전 달',()=>shift(-1)),el('strong',`${y}년 ${m}월`),button('다음 달',()=>shift(1)));calendar.append(head);
      const grid=el('div',null,'leave-calendar-grid');['월','화','수','목','금','토','일'].forEach(d=>grid.append(el('span',d)));const offset=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;for(let i=0;i<offset;i++)grid.append(el('span',''));
      for(let n=1;n<=new Date(Date.UTC(y,m,0)).getUTCDate();n++){const d=`${month}-${String(n).padStart(2,'0')}`;const b=button(String(n),()=>{pick.value=d;close();});b.setAttribute('aria-label',d+' 선택');b.setAttribute('aria-pressed',String(d===selected));b.disabled=Boolean(pick.min&&d<pick.min);grid.append(b);}calendar.append(grid,button('달력 닫기',close));
    }
    calendar.addEventListener('keydown',e=>{if(e.key==='Escape')close();});wrap.append(name,pick,calendar);form.append(wrap);return pick;
  }
  function timeField(form,label,value='',required=true){
    const wrap=el('fieldset',null,'leave-time-field');wrap.append(el('legend',label+' (24시간)'));const row=el('div',null,'leave-time-row');
    const h=select(row,label+' 시',[['','시 선택'],...Array.from({length:24},(_,i)=>{const n=String(i).padStart(2,'0');return[n,n+'시'];})],value.slice(0,2));
    const m=select(row,label+' 분',[['','분 선택'],...Array.from({length:60},(_,i)=>{const n=String(i).padStart(2,'0');return[n,n+'분'];})],value.slice(3,5));h.parentNode.firstChild.nodeValue='시';m.parentNode.firstChild.nodeValue='분';h.required=required;m.required=required;wrap.append(row);form.append(wrap);
    return {get value(){return h.value!==''&&m.value!==''?h.value+':'+m.value:'';},set disabled(v){h.disabled=v;m.disabled=v;h.required=!v&&required;m.required=!v&&required;}};
  }
  function field(form, label, type, value='', required=true) { if(type==='date')return dateField(form,label,value,required); const l=el('label',label); const n=el('input'); n.type=type; n.value=value ?? ''; n.required=required; n.setAttribute('aria-label',label); if(type==='number'){n.step='0.5';n.min='0';} l.append(n);form.append(l);return n; }
  function select(form,label,items,value) { const l=el('label',label),n=el('select');n.setAttribute('aria-label',label); items.forEach(([v,t])=>n.add(new Option(t,v,false,v===value)));l.append(n);form.append(l);return n; }
  function rosterSelect(form,label,employees,positions,empty,value){
    const s=select(form,label,[['',empty]],value),groups=new Map();
    window.TaejangEmployeeViews.sortEmployees(employees,positions).forEach(e=>{
      const key=e.position_id||'',name=e.position_name||'직급 미지정';
      if(!groups.has(key)){const g=el('optgroup');g.label=name;groups.set(key,g);s.append(g);}
      const option=new Option(`${e.employee_id} ${e.name}${e.employment_status==='leave'?' · 휴직 중':''}`,e.id,false,e.id===value);groups.get(key).append(option);
    });return s;
  }
  function currentRoster(ctx){return ctx.employees.filter(e=>['active','leave'].includes(e.employment_status)&&(!e.hired_on||e.hired_on<=ctx.server_today)&&(!e.departed_on||e.departed_on>ctx.server_today));}
  function formAction(form,label,run,reload) { const b=el('button',label,'button');b.type='submit';const status=el('p','','message');status.setAttribute('role','status');status.hidden=true;form.append(b,status);let busy=false;
    form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;b.disabled=true;status.hidden=false;status.textContent='저장 중…';try{if([...form.querySelectorAll('[data-date-required]')].some(n=>!n.value))throw Error('DATE_REQUIRED');const result=await run();if(result===false)return;if(form.isConnected){status.textContent='저장했습니다.';await reload();}}catch(e){if(form.isConnected)status.textContent=errorText(e);}finally{busy=false;b.disabled=false;}});
  }
  function renderWorkTerms(host,ctx,employee,reload){
    host.append(el('h3','근무시간'));
    const latest=[...employee.terms].sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
    host.append(el('p',latest?`${latest.effective_from}부터 · ${latest.starts_at.slice(0,5)}~${latest.ends_at.slice(0,5)}`:'등록된 근무시간이 없습니다.'));
    if(ctx.can_manage_work_terms ?? ctx.can_initialize){
      const f=el('form',null,'employee-form app-authoring leave-work-form');
      const scope=select(f,'적용 방식',[['base','기본 근무시간 등록·변경'],['date','하루만 근무시간 변경']]);
      const tomorrow=new Date(Date.parse(ctx.server_today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
      const minimum=latest&&latest.effective_from>=ctx.server_today?new Date(Date.parse(latest.effective_from+'T12:00:00Z')+86400000).toISOString().slice(0,10):ctx.server_today;
      const next=minimum>tomorrow?minimum:tomorrow;
      const date=field(f,'적용 시작일','date',next);date.min=minimum;
      const start=timeField(f,'출근 시각',latest?.starts_at||''),end=timeField(f,'퇴근 시각',latest?.ends_at||'');
      const rest=select(f,'휴게시간',[['none','휴게 없음'],['set','휴게 있음']],latest?.break_starts_at?'set':'none');
      const breaks=el('div',null,'leave-break-fields');const bs=timeField(breaks,'휴게 시작',latest?.break_starts_at||''),be=timeField(breaks,'휴게 종료',latest?.break_ends_at||'');f.append(breaks);
      const showBreak=()=>{breaks.hidden=rest.value==='none';bs.disabled=be.disabled=breaks.hidden;};rest.addEventListener('change',showBreak);showBreak();
      const loc=select(f,'근무장소',[['','장소 선택'],...ctx.locations.map(l=>[l.id,l.name])],latest?.location_id||'');loc.required=true;
      const weekdays=el('fieldset',null,'leave-weekdays');weekdays.append(el('legend','근무요일'));const checks=[];
      ['월','화','수','목','금','토','일'].forEach((name,i)=>{const l=el('label'),c=el('input');c.type='checkbox';c.value=String(i+1);c.checked=Boolean(latest?.weekdays.includes(i+1));l.append(c,el('span',name));weekdays.append(l);checks.push(c);});f.append(weekdays);
      const reason=field(f,latest?'변경 사유':'등록 사유','text',latest?'':'최초 등록');reason.minLength=2;
      const effectiveNote=el('p','기존 출근 기록은 유지하고 선택한 적용일부터 사용합니다.');f.append(effectiveNote);
      scope.addEventListener('change',()=>{date.min=scope.value==='date'?ctx.server_today:minimum;date.value=scope.value==='date'?ctx.server_today:next;weekdays.hidden=scope.value==='date';});
      formAction(f,'근무시간 저장',async()=>{
        if(!start.value||!end.value)throw Error('TIME_REQUIRED');
        if(end.value<=start.value)throw Error('INVALID_WORK_TIME');
        if(rest.value==='set'&&(!bs.value||!be.value||bs.value<start.value||be.value>end.value||be.value<=bs.value||(bs.value===start.value&&be.value===end.value)))throw Error('INVALID_BREAK_TIME');
        const days=checks.filter(c=>c.checked).map(c=>Number(c.value));if(scope.value==='base'&&!days.length)throw Error('WEEKDAYS_REQUIRED');
        try{return await rpc(scope.value==='date'?'save_employee_work_override':'save_employee_work_terms',{p_employee_uuid:employee.id,p_values:{effective_from:date.value,starts_at:start.value,ends_at:end.value,break_starts_at:rest.value==='set'?bs.value:'',break_ends_at:rest.value==='set'?be.value:'',location_id:loc.value,weekdays:days,reason:reason.value}});}catch(e){if(String(e?.message||e).includes('ATTENDANCE_CONFLICT'))throw Error('WORK_TERMS_ATTENDANCE_CONFLICT');throw e;}
      },reload);host.append(f);
    }
    const history=el('details');history.append(el('summary','근무시간 이력'));
    employee.terms.forEach(t=>history.append(el('p',`${t.effective_from}부터 · 요일 ${t.weekdays.join(',')} · ${t.starts_at}~${t.ends_at} · 휴게 ${t.break_starts_at||'없음'}${t.break_ends_at?'~'+t.break_ends_at:''}`)));host.append(history);
    (ctx.overrides||[]).forEach(o=>{const row=el('section');row.append(el('p',`${o.effective_from} 하루 변경 · ${o.starts_at}~${o.ends_at}`));if(ctx.can_manage_work_terms ?? ctx.can_initialize){const f=el('form',null,'employee-form app-authoring');const why=field(f,'예외 철회 사유','text');why.minLength=2;formAction(f,'날짜 예외 철회',()=>rpc('revoke_employee_work_override',{p_id:o.id,p_reason:why.value}),reload);row.append(f);}host.append(row);});
  }
  async function populate(host,employeeId,leaveOnly=false){
    host.replaceChildren(el('p',leaveOnly?'연차를 확인하고 있습니다.':'근무시간을 확인하고 있습니다.'));
    try{
      const ctx=await rpc('get_employee_leave_admin_context',{p_employee_uuid:employeeId});if(!host.isConnected)return;
      host.replaceChildren();const employee=ctx.employees.find(e=>e.id===employeeId);if(!employee){host.append(el('p','직원을 찾을 수 없습니다.'));return;}
      const reload=()=>{if(!leaveOnly)host.dispatchEvent(new Event('employee-work-terms-saved',{bubbles:true}));return populate(host,employeeId,leaveOnly);};if(!leaveOnly){renderWorkTerms(host,ctx,employee,reload);return;}
      const balance=employee.balance;host.append(el('h3',`${employee.name} · 연차 등록·현황`));host.append(el('p',balance?`발생 ${balance.accrued}개 · 남은 ${balance.remaining}개 · 신청 대기 ${balance.reserved}개 · 신청 가능 ${balance.available}개`:'연차 관리자 등록 대기'));
      if(!balance&&ctx.can_initialize){
        const f=el('form',null,'employee-form app-authoring');f.append(el('h4','최초 연차 등록'));
        f.append(el('p',`기준일 ${ctx.server_today} (자동) · 과거 사용분을 뺀 남은 개수를 입력합니다.`,'help'));
        const amounts=el('div',null,'app-form-grid');f.append(amounts);
        const accrued=field(amounts,'지금까지 발생한 연차','number'),remaining=field(amounts,'현재 남은 연차','number');
        const confirmation=el('div',null,'app-form-grid');f.append(confirmation);
        const reason=select(confirmation,'입력 근거',[['','확인한 자료 선택'],['ledger','기존 연차대장 확인'],['records','인사자료·사용 내역 확인'],['other','기타']], '');reason.required=true;
        const monthly=field(confirmation,'매월 1일 1개 발생 대상 확인','checkbox','',true);monthly.checked=true;
        const other=el('div');f.append(other);const detail=field(other,'기타 입력 근거','text','',false);detail.minLength=2;detail.maxLength=300;
        const showOther=()=>{const enabled=reason.value==='other';other.hidden=!enabled;detail.disabled=!enabled;detail.required=enabled;};reason.addEventListener('change',showOther);showOther();
        formAction(f,'최초 연차 등록',()=>rpc('initialize_employee_leave',{p_employee_uuid:employeeId,p_baseline_on:ctx.server_today,p_accrued:Number(accrued.value),p_remaining:Number(remaining.value),p_monthly_enabled:monthly.checked,p_reason:reason.value==='other'?detail.value:reason.selectedOptions[0].textContent}),reload);host.append(f);
      }else if(balance&&(ctx.can_adjust ?? ctx.can_initialize)){const d=el('details',null,'leave-adjustment');d.append(el('summary','잔여 연차 조정'));const f=el('form',null,'employee-form app-authoring leave-compact-form leave-adjustment-form');const amount=field(f,'조정 개수 (+ 또는 -)','number');amount.min='-100';amount.max='100';const reason=field(f,'조정 사유','text');reason.minLength=2;const id=crypto.randomUUID();formAction(f,'조정 저장',()=>rpc('adjust_employee_leave',{p_employee_uuid:employeeId,p_id:id,p_delta:Number(amount.value),p_reason:reason.value}),reload);d.append(f);host.append(d);
      }else if(balance&&ctx.can_initialize){host.append(el('p','등록된 연차 개수의 변경은 운영총괄에게 요청해주세요.'));}
      const ledger=el('details');ledger.append(el('summary','연차 발생·사용·조정 이력'));ctx.ledger.forEach(l=>ledger.append(el('p',`${l.created_at.slice(0,10)} · ${l.note} · ${l.delta>0?'+':''}${l.delta}개`)));host.append(ledger);
    }catch(e){if(host.isConnected)host.replaceChildren(el('p',errorText(e),'message'),button('다시 불러오기',()=>populate(host,employeeId,leaveOnly)));}
  }
  function renderUrgentLeave(host,ctx,employees,onSaved){
    const section=el('section',null,'employee-profile-section');
    section.append(el('h3','연차 대리 등록'),
      el('p','오늘부터 이틀 뒤까지의 종일 연차를 승인합니다. 잔여 연차 1개가 차감됩니다.'));
    const form=el('form',null,'employee-form app-authoring');
    const employee=rosterSelect(form,'대리 등록 직원',employees.filter(e=>e.employment_status==='active'),ctx.positions,'직원을 선택해주세요','');
    const dates=['오늘','내일','모레'].map((label,offset)=>{
      const day=new Date(Date.parse(ctx.server_today+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
      return [day,`${day} (${label})`];
    });
    const date=select(form,'연차 사용일',[['','사용일을 선택해주세요'],...dates],'');
    employee.required=date.required=true;
    const note=field(form,'대리 등록 사유','text');
    note.minLength=2;
    note.maxLength=300;
    const fields=[employee,date,note];
    let payload;
    formAction(form,'연차 등록 및 승인',async()=>{
      if(!payload){
        if(note.value.trim().length<2)throw Error('INVALID_REQUEST');
        payload={p_id:crypto.randomUUID(),p_employee_uuid:employee.value,p_work_date:date.value,p_note:note.value.trim()};
        fields.forEach(field=>{field.disabled=true;});
      }
      try {
        return await rpc('admin_register_urgent_employee_leave',payload);
      } catch(error) {
        if(/^(P0|22|23|42501|PGRST20)/.test(error?.code||'')){
          payload=undefined;
          fields.forEach(field=>{field.disabled=false;});
        }
        throw error;
      }
    },()=>onSaved(payload.p_employee_uuid));
    section.append(form);
    host.append(section);
  }
  function renderRequests(host,ctx,reload,state={status:'pending'}){
    const section=el('section',null,'employee-profile-section leave-requests');section.append(el('h3','연차 신청·승인'));
    const changes=ctx.change_requests||[];
    const counts=status=>ctx.requests.filter(r=>r.status===status).length;
    const filter=select(section,'신청 상태',[['pending',`승인 대기 (${counts('pending')})`],['approved','승인 완료'],['rejected','반려'],['cancelled','취소'],['all','전체 내역']],state.status);
    const list=el('div');section.append(list);
    function draw(){
      state.status=filter.value;list.replaceChildren();
      const requests=ctx.requests.filter(r=>filter.value==='all'||r.status===filter.value).sort((a,b)=>filter.value==='pending'?a.work_date.localeCompare(b.work_date):b.work_date.localeCompare(a.work_date));
      requests.forEach(r=>{const card=el('article',null,'employee-profile-section');card.append(el('h4',`${r.employee_name} · ${r.work_date}`),el('p',`${labels[r.portion]} · ${r.units}개 · ${labels[r.status]}`));
        if(r.admin_registration_note)card.append(el('p',`대리 등록 사유: ${r.admin_registration_note}`));
        if(r.decision_note&&r.decision_note!==r.admin_registration_note)card.append(el('p',`처리 사유: ${r.decision_note}`));
        if(ctx.can_review&&r.status==='pending'&&!changes.some(c=>c.request_id===r.id&&c.status==='pending')){
          const f=el('form',null,'employee-form app-authoring');const note=field(f,'처리 사유','text');note.minLength=2;
          const decision=select(f,'처리 선택',[['approved','승인'],['rejected','반려']]);
          formAction(f,'처리 저장',()=>rpc('review_employee_leave',{p_request_id:r.id,p_decision:decision.value,p_note:note.value}),reload);card.append(f);
        }
        if(ctx.can_review&&r.status==='approved'&&r.work_date>ctx.server_today&&!changes.some(c=>c.request_id===r.id&&c.status==='pending')){
          const details=el('details');details.append(el('summary','관리자 직접 변경'));
          const f=el('form',null,'employee-form app-authoring'),action=select(f,'관리자 처리',[['amend','날짜 변경'],['cancel','연차 취소']]);
          const date=dateField(f,'새 연차 날짜','',false);date.min=new Date(Date.parse(ctx.server_today+'T12:00:00Z')+3*86400000).toISOString().slice(0,10);
          const note=field(f,'관리자 변경 사유','text');note.minLength=2;
          const sync=()=>{date.parentNode.hidden=action.value==='cancel';};action.addEventListener('change',sync);sync();
          const id=crypto.randomUUID();let payload=null;
          formAction(f,'관리자 변경 적용',()=>{if(!payload){if(action.value==='amend'&&!date.value)throw Error('DATE_REQUIRED');if(!window.confirm('선택한 연차를 직접 변경할까요?'))return false;payload={p_id:id,p_request_id:r.id,p_action:action.value,p_new_work_date:action.value==='amend'?date.value:null,p_note:note.value};f.querySelectorAll('input,select,button').forEach(control=>{control.disabled=true;});}return rpc('admin_change_employee_leave',payload).catch(error=>{if(/^(P0|22|23)/.test(error?.code||'')){payload=null;f.querySelectorAll('input,select,button').forEach(control=>{control.disabled=false;});}throw error;});},reload);
          details.append(f);card.append(details);
        }list.append(card);
      });
      if(!requests.length)list.append(el('p',filter.value==='pending'?'승인 대기 중인 연차 신청이 없습니다.':'해당 상태의 신청 내역이 없습니다.'));
    }
    filter.addEventListener('change',draw);draw();
    renderChangeRequests(section,ctx,reload);
    section.append(el('p','서버에서 조회한 최근 신청 최대 300건입니다. 이전 내역은 직원별로 조회해주세요.'));host.append(section);
  }
  function renderChangeRequests(host,ctx,reload,showHistory=false){
    const section=el('section',null,'leave-change-requests');
    section.append(el(showHistory?'h3':'h4',showHistory?'취소·수정 이력':'취소·수정 요청'));
    const changes=(ctx.change_requests||[]).filter(change=>showHistory ? change.status!=='pending' : change.status==='pending');
    for(const change of changes){
      const action=change.action==='cancel'?'취소':'수정';
      const title=change.employee_name+' · '+(change.manager_direct?'관리자 직접 '+action:action+' 요청');
      const date='기존 '+change.original_work_date+' '+labels[change.original_portion]
        +(change.action==='amend'?' → '+change.new_work_date+' '+labels[change.new_portion]:'');
      const card=el(showHistory?'details':'article',null,'employee-profile-section');
      if(showHistory)card.append(el('summary',title+' · '+date+' · '+labels[change.status]));
      else card.append(el('h4',title),el('p',date+' · '+labels[change.status]),el('p','처리 전까지 기존 연차와 출근부가 유지됩니다.'));
      if(change.reason?.trim())card.append(el('p',(change.manager_direct?'관리자 변경 사유':'직원 요청 사유')+': '+change.reason));
      if(change.decision_note)card.append(el('p','처리 사유: '+change.decision_note));
      if(!showHistory&&ctx.can_review){
        const form=el('form',null,'employee-form app-authoring');
        const note=field(form,'변경 처리 사유','text');note.minLength=2;
        const decision=select(form,'변경 처리 선택',[['approved','승인'],['rejected','반려']]);
        formAction(form,'취소·수정 처리',()=>rpc('review_employee_leave_change',{
          p_change_id:change.id,p_decision:decision.value,p_note:note.value
        }),reload);
        card.append(form);
      }
      section.append(card);
    }
    if(!changes.length)section.append(el('p',showHistory?'처리된 취소·수정 이력이 없습니다.':'처리할 취소·수정 요청이 없습니다.'));
    if(showHistory)section.append(el('p','서버에서 조회한 최근 취소·수정 내역 최대 300건입니다.'));
    host.append(section);
  }
  function renderDaysOff(host,ctx,reload){
    const details=el('details',null,'employee-profile-section leave-exceptions');details.append(el('summary','기타 설정 · 예외 휴무'));
    details.append(el('p','회사에서 별도로 정한 임시 휴무만 등록합니다. 연차를 부여하거나 차감하지 않습니다. 법정공휴일을 설정하는 화면이 아닙니다.'));
    const f=el('form',null,'employee-form app-authoring leave-compact-form leave-day-off-form');f.append(el('h3','예외 휴무 등록'));
    const person=rosterSelect(f,'휴무 대상',currentRoster(ctx),ctx.positions,'회사 전체','');const date=field(f,'휴무일','date');date.min=ctx.server_today;const reason=field(f,'휴무 사유','text');reason.minLength=2;
    formAction(f,'예외 휴무 저장',()=>rpc('save_employee_day_off',{p_employee_uuid:person.value||null,p_work_date:date.value,p_reason:reason.value}),reload);details.append(f);
    ctx.days_off.forEach(o=>{const row=el('section');row.append(el('p',`${o.work_date} · ${ctx.employees.find(e=>e.id===o.employee_uuid)?.name||'회사 전체'} · ${o.reason}`));const f=el('form',null,'employee-form app-authoring');const why=field(f,'휴무 철회 사유','text');why.minLength=2;formAction(f,'휴무 철회',()=>rpc('revoke_employee_day_off',{p_id:o.id,p_reason:why.value}),reload);row.append(f);details.append(row);});host.append(details);
  }
  async function open(){
    const legacyAllowed=window.TaejangApp?.can?.('leave.manage')===true;
    if((window.TaejangMenuAuthority?.allowed('leave.manage',legacyAllowed)??legacyAllowed)===false)return;
    const target=document.getElementById('dashboard-main');if(!target)return;
    const host=el('section',null,'employee-management leave-management');target.replaceChildren(host);
    let view='requests',employeeId='',generation=0;const state={status:'pending',history:false,registered:false};
    const load=async()=>{const version=++generation;host.replaceChildren(el('p','연차를 확인하고 있습니다.'));
      try{
        const ctx=await rpc('get_employee_leave_admin_context');if(!host.isConnected||version!==generation)return;
        if(ctx.roster_version!==1)throw Error('ROSTER_METADATA_REQUIRED');
        if(view==='registration'&&!ctx.can_review)view='requests';
        const current=currentRoster(ctx),currentIds=new Set(current.map(e=>e.id));
        const retired=ctx.employees.filter(e=>e.employment_status==='departed'||e.departed_on&&e.departed_on<=ctx.server_today);
        host.replaceChildren(el('h2','연차 관리'));
        if(state.registered){
          const status=el('p','연차 대리 등록을 저장했습니다.','message');
          status.setAttribute('role','status');
          host.append(status);
          state.registered=false;
        }
        const nav=el('nav',null,'leave-view-nav');nav.setAttribute('aria-label','연차 관리 화면');
        const views=[['requests','신청·승인'],['changes','취소·수정 이력'],['balances','직원별 연차 등록·현황']];
        if(ctx.can_review)views.push(['registration','연차 대리 등록']);
        for(const [key,label] of views){
          const tab=button(label,()=>{
            if(view==='balances'||key==='balances')employeeId='';
            view=key;
            load();
          });
          tab.setAttribute('aria-pressed',String(view===key));
          nav.append(tab);
        }
        host.append(nav);
        const content=el('section',null,'leave-main-content');host.append(content);
        if(view==='registration'){
          renderUrgentLeave(content,ctx,current,registeredEmployee=>{
            view='requests';
            employeeId=registeredEmployee;
            state.history=false;
            state.status='approved';
            state.registered=true;
            return load();
          });
        }else if(view==='balances'){
          content.append(el('h3','직원별 연차 등록·현황'),el('p',ctx.can_initialize?'직원을 선택해 지금까지 발생한 연차와 현재 남은 연차를 최초 등록합니다.':'직원을 선택해 연차 현황을 확인합니다. 현재 권한으로 연차 개수를 입력할 수 없습니다.'));
          const s=rosterSelect(content,'직원 선택',current,ctx.positions,'재직 직원을 선택해주세요',employeeId);
          const box=el('section',null,'employee-profile-section');content.append(box);
          const show=()=>{employeeId=s.value;box.replaceChildren();if(employeeId){const panel=el('div');box.append(panel);populate(panel,employeeId,true);}else box.append(el('p','직원을 선택하면 연차 등록·현황을 확인할 수 있습니다.'));};s.addEventListener('change',show);show();
        }else{
          const historyLabel=view==='changes'?'퇴직자 취소·수정 이력 보기':'퇴직자 과거 신청 보기';
          const history=field(content,historyLabel,'checkbox','',false);history.parentNode.classList.add('app-check-field');history.parentNode.replaceChildren(history,el('span',historyLabel));history.checked=state.history;history.addEventListener('change',()=>{state.history=history.checked;employeeId='';load();});
          const s=rosterSelect(content,'신청 직원',state.history?retired:current,ctx.positions,state.history?'전체 퇴직자 과거 내역':'전체 재직 직원',employeeId);
          const box=el('section');content.append(box);let requestGeneration=0;
          const show=async()=>{
            const requestVersion=++requestGeneration;
            employeeId=s.value;
            box.replaceChildren(el('p','신청 내역을 확인하고 있습니다.'));
            try{
              const scoped=employeeId?await rpc('get_employee_leave_admin_context',{p_employee_uuid:employeeId}):ctx;
              if(!box.isConnected||requestVersion!==requestGeneration)return;
              const visible=request=>state.history?!currentIds.has(request.employee_uuid):currentIds.has(request.employee_uuid);
              const filtered={...scoped,requests:scoped.requests.filter(visible),change_requests:(scoped.change_requests||[]).filter(visible)};
              box.replaceChildren();
              if(view==='changes')renderChangeRequests(box,filtered,load,true);
              else renderRequests(box,filtered,load,state);
            }catch(error){
              if(box.isConnected&&requestVersion===requestGeneration)box.replaceChildren(el('p',errorText(error)),button('다시 불러오기',show));
            }
          };
          s.addEventListener('change',show);
          await show();
        }
        if(host.isConnected&&version===generation&&(view==='requests'||view==='balances'))renderDaysOff(host,ctx,load);
      }catch(e){if(host.isConnected&&version===generation)host.replaceChildren(el('p',errorText(e)),button('다시 불러오기',load));}
    };await load();
  }
  function workSummary(employee){
    const box=el('div','근무시간 확인 중…','employee-work-summary');let generation=0;
    const load=async()=>{const version=++generation;if(!box.isConnected)return;try{
      const ctx=await rpc('get_employee_leave_admin_context',{p_employee_uuid:employee.id});if(!box.isConnected||version!==generation)return;
      const person=ctx.employees.find(e=>e.id===employee.id),terms=[...(person?.terms||[])].sort((a,b)=>a.effective_from.localeCompare(b.effective_from));
      const current=terms.filter(t=>t.effective_from<=ctx.server_today).at(-1),next=terms.find(t=>t.effective_from>ctx.server_today);
      box.replaceChildren(el('p',current?`현재 근무시간 · ${current.starts_at.slice(0,5)} ~ ${current.ends_at.slice(0,5)} (${current.effective_from}부터)`:'현재 근무시간 · 미등록'));
      if(next)box.append(el('p',`변경 예정 · ${next.starts_at.slice(0,5)} ~ ${next.ends_at.slice(0,5)} (${next.effective_from}부터)`));
    }catch(_error){if(box.isConnected&&version===generation)box.textContent='근무시간을 불러오지 못했습니다.';}};
    queueMicrotask(()=>{if(!box.isConnected)return;box.closest('[data-employee-profile]')?.addEventListener('employee-work-terms-saved',load);void load();});return box;
  }
  function employeePanel(employee){
    const details=el('details',null,'employee-profile-section employee-profile-fold employee-section-work');
    const content=el('div',null,'employee-profile-fold-body');
    details.append(el('summary','근무시간 확인·변경'),content);
    details.addEventListener('toggle',()=>{
      if(details.open&&!content.hasChildNodes())void populate(content,employee.id);
    });
    return details;
  }
  window.TaejangEmployeeLeave={open,employeePanel,workSummary};
})();
