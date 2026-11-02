(() => {
  'use strict';
  const copy = {
    ERP_AUTH_REQUIRED: '태장 로그인이 만료됐습니다. 다시 로그인해 주세요.',
    ERP_ACCOUNT_INACTIVE: '활성 태장 계정에서만 연결할 수 있습니다.',
    WORKLOG_AUTH_REQUIRED: '업무수첩 계정을 연결해 주세요. 연결은 이 브라우저 탭에서 로그인 유효시간 동안 유지됩니다.',
    IDENTITY_VERIFICATION_REQUIRED: '두 계정의 이메일 인증을 모두 확인할 수 없어 연결을 중단했습니다. 계정 변경은 별도 승인 후 진행합니다.',
    IDENTITY_MISMATCH: '두 계정의 인증된 이메일이 다릅니다. 자동으로 연결하지 않았습니다.',
    PERSONAL_WORKSPACE_UNAVAILABLE: '본인 소유의 개인 업무공간을 확인할 수 없습니다.',
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
    const key = `taejang.worklog.readonly.${actor}`;
    let month = dateKey(new Date()).slice(0,7), pending = 0;
    let token = '';
    try { token = sessionStorage.getItem(key) || ''; } catch { /* Memory-only remains usable. */ }
    root.className = 'personal-worklog';
    root.setAttribute('aria-label', '내 업무수첩');
    const header = node('header');
    header.append(node('h3', '내 업무수첩'), node('p', '개인 일정과 미완료 업무 · 읽기 전용', 'help'));
    const status = node('p', '연결 확인 중', 'message'); status.setAttribute('role', 'status');
    const controls = node('div', null, 'worklog-controls');
    const content = node('div');
    root.replaceChildren(header, status, controls, content);
    const clear = () => { pending++; token = ''; try { sessionStorage.removeItem(key); } catch {} content.replaceChildren(); };
    const forgotten = () => { clear(); showConnect(); status.textContent = '업무수첩 연결을 해제했습니다.'; };
    async function api(mode) {
      const erp = app.getSession?.()?.access_token;
      const params = new URLSearchParams(mode ? {mode} : {month});
      const response = await fetch(`/api/personal-worklog?${params}`, { headers: { Authorization: `Bearer ${erp}`, ...(token ? {'X-Worklog-Authorization': `Bearer ${token}`} : {}) }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.code), { code: result.code });
      return result;
    }
    function showConnect() {
      controls.replaceChildren();
      const details = node('details'); details.append(node('summary', '업무수첩 계정 연결'));
      const form = node('form', null, 'worklog-connect');
      const emailLabel = node('label', '업무수첩 이메일'); const email = node('input'); email.type='email'; email.required=true; email.autocomplete='username'; emailLabel.append(email);
      const passwordLabel = node('label', '업무수첩 비밀번호'); const password=node('input'); password.type='password'; password.required=true; password.autocomplete='current-password'; passwordLabel.append(password);
      const submit=node('button','연결하기','button');submit.type='submit';
      form.append(node('p','태장 계정과 인증된 이메일이 같은 업무수첩 계정만 연결합니다. 비밀번호는 업무수첩 인증 서버에 직접 전송됩니다.','help'),emailLabel,passwordLabel,submit);
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled=true; status.textContent='본인 계정을 확인하고 있습니다.';
        try {
          const settings=await api('connection');
          if (!alive()) return;
          const response=await fetch(`${settings.url}/auth/v1/token?grant_type=password`, {method:'POST', headers:{apikey:settings.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email:email.value.trim(),password:password.value}),signal:AbortSignal.timeout(12000)});
          password.value='';
          const session=await response.json();
          if (!alive()) return;
          if (!response.ok || !session.access_token) throw new Error('SIGNIN_FAILED');
          // No refresh token or password is persisted; phone sessions are untouched.
          token=session.access_token;
          await load();
        } catch(error) { if (alive()) { clear();status.textContent=copy[error.code] || '로그인에 실패했습니다. 이메일·비밀번호 또는 네트워크를 확인해 주세요.'; } }
        finally { password.value='';submit.disabled=false; }
      });
      details.append(form);controls.append(details);
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
      const table=node('table');table.setAttribute('aria-label',`${month} 개인 일정`);
      const head=node('thead'),tr=node('tr');for(const day of ['일','월','화','수','목','금','토']){const th=node('th',day);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
      const body=node('tbody'); const [y,m]=month.split('-').map(Number);const first=new Date(Date.UTC(y,m-1,1));const offset=first.getUTCDay();const days=new Date(Date.UTC(y,m,0)).getUTCDate();
      for(let week=0;week<Math.ceil((offset+days)/7);week++){
        const row=node('tr');
        for(let day=0;day<7;day++){
          const d=week*7+day-offset+1,cell=node('td');
          if(d>0&&d<=days){const date=`${month}-${String(d).padStart(2,'0')}`;const dayStart=Date.parse(`${date}T00:00:00+09:00`),dayEnd=dayStart+86400000;
            cell.append(node('span',String(d),'worklog-day'));if(date===data.today)cell.setAttribute('aria-current','date');
            const entries=data.schedules.filter(s=>Date.parse(s.starts_at)<dayEnd&&Math.max(Date.parse(s.ends_at)||0,Date.parse(s.starts_at)+1)>dayStart);
            for(const s of entries){const p=node('p',`${s.all_day?'종일':time(s.starts_at)} ${s.title}`,'worklog-event');p.title=p.textContent;cell.append(p);}
          }row.append(cell);
        }body.append(row);
      }table.append(body);section.append(navigation,table);return section;
    }
    async function load() {
      const request=++pending; content.replaceChildren();status.textContent='개인 일정을 불러오고 있습니다.';
      try {
        const data=await api();
        if(!alive()||request!==pending)return;
        try{sessionStorage.setItem(key,token);}catch{}
        status.textContent=`연결됨 · ${time(data.fetchedAt)} 조회${data.limited?' · 일부 항목만 표시(최대 500건)':''}`;
        controls.replaceChildren(action('새로고침',()=>void load()),action('연결 해제',forgotten));
        const lists=node('div',null,'worklog-summary');
        lists.append(items('오늘 일정',data.todaySchedules,s=>s.all_day?'종일':time(s.starts_at),'오늘 일정이 없습니다.'),items('미완료·재확인 업무',data.tasks,t=>({needs_review:'재확인',waiting:'대기',in_progress:'진행 중'}[t.status]||'')+(t.due_at?` · ${dateKey(t.due_at)}`:''),'미완료 업무가 없습니다.'));
        content.replaceChildren(lists,calendar(data));
      } catch(error){
        if(!alive()||request!==pending)return;
        content.replaceChildren();status.textContent=copy[error.code]||'연결에 실패했습니다. 태장 업무는 계속 사용할 수 있습니다.';
        if(['WORKLOG_AUTH_REQUIRED','IDENTITY_MISMATCH','IDENTITY_VERIFICATION_REQUIRED','PERSONAL_WORKSPACE_UNAVAILABLE'].includes(error.code)){clear();showConnect();}
        else controls.replaceChildren(action('다시 시도',()=>void load()),action('연결 해제',forgotten));
      }
    }
    // Purge visible personal contents immediately on logout, including a slow API.
    document.getElementById('logout-button')?.addEventListener('click',()=>{generation++;clear();root.replaceChildren();},{once:true});
    void load();
  }
  window.TaejangPersonalWorklog = { mount };
})();
