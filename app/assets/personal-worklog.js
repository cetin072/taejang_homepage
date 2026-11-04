(() => {
  'use strict';
  const copy = {
    ERP_AUTH_REQUIRED: '태장 로그인이 만료됐습니다. 다시 로그인해 주세요.',
    ERP_ACCOUNT_INACTIVE: '활성 태장 계정에서만 확인할 수 있습니다.',
    WORKLOG_MIGRATION_PENDING: '업무수첩 통합 준비 중입니다. 기존 업무수첩 앱은 계속 사용할 수 있습니다.',
    PERSONAL_WORKSPACE_UNAVAILABLE: '본인 개인 업무공간이 아직 이전되지 않았습니다.',
    ERP_CONNECTION_NOT_READY: '개발환경의 태장 연결 설정을 확인해 주세요.'
  };
  const node = (tag, value, className) => { const n = document.createElement(tag); if (value) n.textContent = value; if (className) n.className = className; return n; };
  const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const time = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const action = (label, fn) => { const b = node('button', label, 'button button-quiet'); b.type = 'button'; b.addEventListener('click', fn); return b; };
  let generation = 0;
  function mount(root) {
    const app = window.TaejangApp;
    const actor = app?.getSession?.()?.user?.id;
    if (!actor) { root.hidden = true; return; }
    const epoch = ++generation;
    const alive = () => epoch === generation && root.isConnected && app.getSession?.()?.user?.id === actor;
    let month = dateKey(new Date()).slice(0,7), pending = 0;
    root.className = 'personal-worklog';
    root.setAttribute('aria-label', '내 업무수첩');
    const header = node('header');
    header.append(node('h3', '내 업무수첩'), node('p', '개인 일정과 미완료 업무 · 읽기 전용', 'help'));
    const status = node('p', '연결 확인 중', 'message'); status.setAttribute('role', 'status');
    const controls = node('div', null, 'worklog-controls');
    const content = node('div');
    root.replaceChildren(header, status, controls, content);
    const clear = () => { pending++; content.replaceChildren(); };
    async function api() {
      const erp = app.getSession?.()?.access_token;
      const params = new URLSearchParams({month});
      const response = await fetch(`/api/personal-worklog?${params}`, { headers: { Authorization: `Bearer ${erp}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.code), { code: result.code });
      return result;
    }
    function items(title, rows, label, empty) {
      const section=node('section',null,'worklog-list'); section.append(node('h4',title));
      if (!rows.length) section.append(node('p',empty,'help'));
      else {const ul=node('ul');for(const row of rows){const li=node('li');li.append(node('span',row.title),node('small',label(row)));ul.append(li);}section.append(ul);}
      return section;
    }
    function calendar(data) {
      const section=node('section',null,'worklog-calendar');
      const navigation=node('div',null,'worklog-controls');
      const change=delta=>{const [y,m]=month.split('-').map(Number);const next=new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);if(/^20\d{2}-/.test(next)){month=next;void load();}};
      navigation.append(action('이전 달',()=>change(-1)),node('h4',month.replace('-','년 ')+'월'),action('다음 달',()=>change(1)),action('이번 달',()=>{month=dateKey(new Date()).slice(0,7);void load();}));
      const details=node('dialog',null,'worklog-day-dialog');
      const detailsTitle=node('h4');detailsTitle.id=`worklog-day-title-${epoch}`;
      details.setAttribute('aria-labelledby',detailsTitle.id);
      const close=action('닫기',()=>details.close());
      const detailHeader=node('header',null,'worklog-detail-header');detailHeader.append(detailsTitle,close);
      const detailRows=node('div');details.append(detailHeader,detailRows);
      const openDay=(date,entries)=>{
        if(!alive())return;
        detailsTitle.textContent=`${date} 일정 ${entries.length}개`;
        detailRows.replaceChildren();
        if(!entries.length)detailRows.append(node('p','등록된 일정이 없습니다.','help'));
        else{
          const list=node('ol',null,'worklog-day-events');
          for(const s of entries){const li=node('li');li.append(node('small',s.all_day?'종일':time(s.starts_at)),node('p',s.title));list.append(li);}
          detailRows.append(list);
        }
        details.showModal();
      };
      const table=node('table');table.setAttribute('aria-label',`${month} 개인 일정`);
      const head=node('thead'),tr=node('tr');for(const day of ['일','월','화','수','목','금','토']){const th=node('th',day);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
      const body=node('tbody'); const [y,m]=month.split('-').map(Number);const first=new Date(Date.UTC(y,m-1,1));const offset=first.getUTCDay();const days=new Date(Date.UTC(y,m,0)).getUTCDate();
      for(let week=0;week<Math.ceil((offset+days)/7);week++){
        const row=node('tr');
        for(let day=0;day<7;day++){
          const d=week*7+day-offset+1,cell=node('td');
          if(d>0&&d<=days){const date=`${month}-${String(d).padStart(2,'0')}`;const dayStart=Date.parse(`${date}T00:00:00+09:00`),dayEnd=dayStart+86400000;
            const entries=data.schedules.filter(s=>Date.parse(s.starts_at)<dayEnd&&Math.max(Date.parse(s.ends_at)||0,Date.parse(s.starts_at)+1)>dayStart);
            entries.sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
            const button=node('button',null,'worklog-date-button');button.type='button';
            button.setAttribute('aria-label',`${date} 일정 ${entries.length}개 보기`);
            button.setAttribute('aria-haspopup','dialog');
            button.append(node('span',String(d),'worklog-day'));
            if(date===data.today)button.setAttribute('aria-current','date');
            for(const s of entries.slice(0,2)){const event=node('span',s.title,'worklog-event');event.title=`${s.all_day?'종일':time(s.starts_at)} ${s.title}`;button.append(event);}
            if(entries.length>2)button.append(node('span',`+${entries.length-2}개`,'worklog-more'));
            button.addEventListener('click',()=>openDay(date,entries));cell.append(button);
          }row.append(cell);
        }body.append(row);
      }table.append(body);section.append(navigation,table,details);return section;
    }
    async function load() {
      const request=++pending; content.replaceChildren();status.textContent='개인 일정을 불러오고 있습니다.';
      try {
        const data=await api();
        if(!alive()||request!==pending)return;
        status.textContent=`연결됨 · ${time(data.fetchedAt)} 조회${data.limited?' · 일부 항목만 표시(최대 500건)':''}`;
        controls.replaceChildren(action('새로고침',()=>void load()));
        const lists=node('div',null,'worklog-summary');
        lists.append(items('오늘 일정',data.todaySchedules,s=>s.all_day?'종일':time(s.starts_at),'오늘 일정이 없습니다.'),items('미완료·재확인 업무',data.tasks,t=>({needs_review:'재확인',waiting:'대기',in_progress:'진행 중'}[t.status]||'')+(t.due_at?` · ${dateKey(t.due_at)}`:''),'미완료 업무가 없습니다.'));
        content.replaceChildren(lists,calendar(data));
      } catch(error){
        if(!alive()||request!==pending)return;
        // Accounts without a migrated personal workspace keep their normal ERP dashboard.
        if(error.code==='PERSONAL_WORKSPACE_UNAVAILABLE'){root.replaceChildren();root.hidden=true;return;}
        content.replaceChildren();status.textContent=copy[error.code]||'연결에 실패했습니다. 태장 업무는 계속 사용할 수 있습니다.';
        controls.replaceChildren(action('다시 시도',()=>void load()));
      }
    }
    // Purge visible personal contents immediately on logout, including a slow API.
    document.getElementById('logout-button')?.addEventListener('click',()=>{generation++;clear();root.replaceChildren();},{once:true});
    void load();
  }
  window.TaejangPersonalWorklog = { mount };
})();
