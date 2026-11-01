(() => {
  'use strict';
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const rpc = (name, args = {}) => window.TaejangApp.rpc(name, args);
  const labels = { pending:'승인 대기', approved:'승인', rejected:'반려', cancelled:'취소', full:'종일', first_half:'앞 반차', second_half:'뒤 반차' };
  const messages = { FORBIDDEN:'현재 권한으로 처리할 수 없습니다.', SELF_APPROVAL_FORBIDDEN:'본인의 연차는 직접 승인할 수 없습니다.', DAY_CONFIRMED_REOPEN_REQUIRED:'확정된 근태입니다. 먼저 확정 재개방이 필요합니다.', LEAVE_SCHEDULE_CONFLICT:'신청된 연차와 겹칩니다. 신청 처리 후 다시 설정해주세요.', APPEND_NEW_EFFECTIVE_DATE_REQUIRED:'기존 적용일보다 뒤의 새 적용일을 입력해주세요.', ATTENDANCE_CONFLICT:'기존 근태와 충돌합니다. 원본을 확인해주세요.', BASELINE_MUST_BE_TODAY:'최초 잔여는 오늘 기준으로 확인해 입력해주세요.', INSUFFICIENT_LEAVE:'신청 예약분을 제외한 잔여가 부족합니다.' };
  function errorText(error) { const s = String(error?.message || error || ''); return Object.entries(messages).find(([k]) => s.includes(k))?.[1] || '저장하지 못했습니다. 입력값과 연결 상태를 확인하고 다시 시도해주세요.'; }
  function button(text, run) { const b = el('button',text,'button button-quiet'); b.type='button'; b.addEventListener('click',run); return b; }
  function field(form, label, type, value='', required=true) { const l=el('label',label); const n=el('input'); n.type=type; n.value=value ?? ''; n.required=required; n.setAttribute('aria-label',label); if(type==='number'){n.step='0.5';n.min='0';} l.append(n);form.append(l);return n; }
  function select(form,label,items,value) { const l=el('label',label),n=el('select');n.setAttribute('aria-label',label); items.forEach(([v,t])=>n.add(new Option(t,v,false,v===value)));l.append(n);form.append(l);return n; }
  function formAction(form,label,run,reload) { const b=el('button',label,'button');b.type='submit';const status=el('p','','message');status.setAttribute('role','status');form.append(b,status);let busy=false;
    form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;b.disabled=true;status.textContent='저장 중…';try{await run();if(form.isConnected){status.textContent='저장했습니다.';await reload();}}catch(e){if(form.isConnected)status.textContent=errorText(e);}finally{busy=false;b.disabled=false;}});
  }
  async function populate(host,employeeId) {
    const loading=el('p','근무조건과 연차를 확인하고 있습니다.');host.replaceChildren(loading);
    try {
      const ctx=await rpc('get_employee_leave_admin_context',{p_employee_uuid:employeeId});
      if(!host.isConnected)return;
      host.replaceChildren();const employee=ctx.employees.find(e=>e.id===employeeId);if(!employee){host.append(el('p','직원을 찾을 수 없습니다.'));return;}
      const reload=()=>populate(host,employeeId);
      const balance=employee.balance;
      host.append(el('h3','근무조건·연차'));
      host.append(el('p',balance?`발생 ${balance.accrued}개 · 남은 ${balance.remaining}개 · 신청 대기 ${balance.reserved}개 · 신청 가능 ${balance.available}개`:'연차 관리자 등록 대기'));
      if(ctx.can_initialize){
        const details=el('details');details.append(el('summary','근무조건 추가'));const f=el('form',null,'employee-form app-authoring');
        const date=field(f,'적용 시작일','date',ctx.server_today);date.min=ctx.server_today;
        const start=field(f,'출근 시각','time');const end=field(f,'퇴근 시각','time');
        const bs=field(f,'휴게 시작 (없으면 비움)','time','',false),be=field(f,'휴게 종료 (없으면 비움)','time','',false);
        const loc=select(f,'근무장소',ctx.locations.map(l=>[l.id,l.name]));loc.required=true;
        const weekdays=el('fieldset');weekdays.append(el('legend','근무요일'));const checks=[];
        ['월','화','수','목','금','토','일'].forEach((name,i)=>{const l=el('label',name),c=el('input');c.type='checkbox';c.value=String(i+1);l.prepend(c);weekdays.append(l);checks.push(c);});f.append(weekdays);
        const reason=field(f,'변경 사유','text');reason.minLength=2;
        formAction(f,'근무조건 저장',()=>rpc('save_employee_work_terms',{p_employee_uuid:employeeId,p_values:{effective_from:date.value,starts_at:start.value,ends_at:end.value,break_starts_at:bs.value,break_ends_at:be.value,location_id:loc.value,weekdays:checks.filter(c=>c.checked).map(c=>Number(c.value)),reason:reason.value}}),reload);details.append(f);host.append(details);
        if(!balance){
          const f=el('form',null,'employee-form app-authoring');f.append(el('h4','오늘 기준 최초 연차 입력'));
          const accrued=field(f,'지금까지 발생한 연차','number');const remaining=field(f,'현재 남은 연차','number');
          const monthly=field(f,'매월 1일 1개 발생 대상 확인','checkbox','',false);monthly.required=false;
          const reason=field(f,'기준일·입력 근거','text');reason.minLength=2;
          f.append(el('p',`기준일 ${ctx.server_today}. 기존 사용분이 반영된 남은 개수를 입력합니다. 최초 입력은 덮어쓰지 않습니다.`));
          formAction(f,'최초 연차 등록',()=>rpc('initialize_employee_leave',{p_employee_uuid:employeeId,p_baseline_on:ctx.server_today,p_accrued:Number(accrued.value),p_remaining:Number(remaining.value),p_monthly_enabled:monthly.checked,p_reason:reason.value}),reload);host.append(f);
        }else{
          const d=el('details');d.append(el('summary','잔여 연차 조정'));const f=el('form',null,'employee-form app-authoring');const amount=field(f,'조정 개수 (+ 또는 -)','number');amount.min='-100';amount.max='100';const reason=field(f,'조정 사유','text');reason.minLength=2;let id=crypto.randomUUID();
          formAction(f,'조정 저장',()=>rpc('adjust_employee_leave',{p_employee_uuid:employeeId,p_id:id,p_delta:Number(amount.value),p_reason:reason.value}),reload);d.append(f);host.append(d);
        }
      }
      const history=el('details');history.append(el('summary','근무조건 이력'));
      employee.terms.forEach(t=>history.append(el('p',`${t.effective_from}부터 · 요일 ${t.weekdays.join(',')} · ${t.starts_at}~${t.ends_at} · 휴게 ${t.break_starts_at||'없음'}${t.break_ends_at?'~'+t.break_ends_at:''}`)));host.append(history);
      const ledger=el('details');ledger.append(el('summary','연차 발생·사용·조정 이력'));
      ctx.ledger.forEach(l=>ledger.append(el('p',`${l.created_at.slice(0,10)} · ${l.note} · ${l.delta>0?'+':''}${l.delta}개`)));host.append(ledger);
      renderRequests(host,ctx,reload);
    }catch(e){if(host.isConnected)host.replaceChildren(el('p',errorText(e),'message'),button('다시 불러오기',()=>populate(host,employeeId)));}
  }
  function renderRequests(host,ctx,reload){
    const section=el('section');section.append(el('h3','연차 신청'));
    ctx.requests.forEach(r=>{const card=el('article',null,'employee-profile-section');card.append(el('p',`${r.employee_name} · ${r.work_date} · ${labels[r.portion]} · ${r.units}개 · ${labels[r.status]}`));
      if(ctx.can_review&&r.status==='pending'){
        const f=el('form',null,'employee-form app-authoring');const note=field(f,'처리 사유','text');note.minLength=2;
        const decision=select(f,'처리 선택',[['approved','승인'],['rejected','반려']]);
        formAction(f,'처리 저장',()=>rpc('review_employee_leave',{p_request_id:r.id,p_decision:decision.value,p_note:note.value}),reload);card.append(f);
      }section.append(card);
    });if(!ctx.requests.length)section.append(el('p','신청 내역이 없습니다.'));host.append(section);
  }
  async function open(){
    if(window.TaejangMenuAuthority?.allowed('leave.manage',false)===false)return;
    const target=document.getElementById('dashboard-main');if(!target)return;
    const host=el('section',null,'employee-management');target.replaceChildren(host);host.append(el('p','연차·휴무를 확인하고 있습니다.'));
    const load=async()=>{try{const ctx=await rpc('get_employee_leave_admin_context');if(!host.isConnected)return;host.replaceChildren(el('h2','연차·휴무 관리'));
      const picker=el('div');const s=select(picker,'직원 선택',[['','직원을 선택해주세요'],...ctx.employees.map(e=>[e.id,`${e.employee_id} ${e.name}`])]);s.addEventListener('change',()=>{if(s.value){const box=el('section');host.append(box);populate(box,s.value);s.disabled=true;host.prepend(button('전체 목록으로',()=>open()));}});host.append(picker);
      renderRequests(host,ctx,load);
      const f=el('form',null,'employee-form app-authoring');f.append(el('h3','휴무 등록'));
      const person=select(f,'휴무 대상',[['','회사 전체'],...ctx.employees.map(e=>[e.id,e.name])]);const date=field(f,'휴무일','date');date.min=ctx.server_today;const reason=field(f,'휴무 사유','text');reason.minLength=2;
      formAction(f,'휴무 등록',()=>rpc('save_employee_day_off',{p_employee_uuid:person.value||null,p_work_date:date.value,p_reason:reason.value}),load);host.append(f);
      ctx.days_off.forEach(o=>host.append(el('p',`${o.work_date} · ${ctx.employees.find(e=>e.id===o.employee_uuid)?.name||'회사 전체'} · ${o.reason}`)));
    }catch(e){if(host.isConnected)host.replaceChildren(el('p',errorText(e)),button('다시 불러오기',load));}};await load();
  }
  function employeePanel(employee){const host=el('section',null,'employee-profile-section');host.append(button('근무조건·연차 확인',()=>populate(host,employee.id)));return host;}
  window.TaejangEmployeeLeave={open,employeePanel};
})();
