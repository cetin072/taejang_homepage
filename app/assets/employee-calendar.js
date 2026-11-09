/* Employee calendar reuses the existing calendar layout and the shared personal schedule ledger. */
(() => {
 'use strict';
 const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 const time=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
 const plusDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const button=(label,fn)=>{const n=el('button',label,'button button-quiet');n.type='button';n.addEventListener('click',fn);return n;};
 const source=row=>row.source==='personal'?'내 일정':'회사 일정';
 const overlaps=(row,date)=>Date.parse(row.starts_at)<Date.parse(date+'T00:00:00+09:00')+86400000&&Math.max(Date.parse(row.ends_at)||0,Date.parse(row.starts_at)+1)>Date.parse(date+'T00:00:00+09:00');
 const errorText=e=>{
  const text=String(e?.message||e);const errors={CALENDAR_CONFLICT:'다른 화면에서 바뀐 일정입니다. 입력을 보존했습니다. 다시 조회해 비교해 주세요.',CALENDAR_FORBIDDEN:'일정을 사용할 권한을 다시 확인해 주세요.',CALENDAR_INVALID_INPUT:'제목·날짜와 종료 시각을 확인해 주세요.',CALENDAR_REQUEST_REUSE:'이미 저장된 요청과 내용이 다릅니다. 입력을 보존했으니 다시 조회해 확인해 주세요.',CALENDAR_WORKLOG_RECORD:'업무수첩에 연결된 업무에서 수정해 주세요.'};
  return Object.entries(errors).find(([code])=>text.includes(code))?.[1]||(/PGRST202|does not exist/.test(text)?'캘린더 준비 중입니다. 기존 업무는 계속 사용할 수 있습니다.':'처리하지 못했습니다. 입력을 보존했으니 다시 시도해 주세요.');
 };
 let generation=0,currentRoot,currentActor,cleanup,dirty=false,busy=false;
 const pending=()=>Boolean(currentRoot?.isConnected)&&(dirty||busy);
 function clear(){generation++;cleanup?.abort();if(currentRoot){currentRoot.replaceChildren();currentRoot.hidden=true;}dirty=false;busy=false;currentActor=null;}
 function mount(root){
  if(!root)return;clear();currentRoot=root;const app=window.TaejangApp,actor=app?.getSession?.()?.user?.id;
  const preview=()=>app?.getContext?.()?.role_simulation?.active===true;
  if(!actor||preview())return;currentActor=actor;
  const epoch=generation;cleanup=new AbortController();const signal=cleanup.signal;
  const alive=()=>epoch===generation&&root.isConnected&&actor===app.getSession?.()?.user?.id&&!preview();
  let month=day(new Date()).slice(0,7),request=0,data;
  root.hidden=false;root.className='personal-worklog employee-calendar';root.setAttribute('aria-label','내 캘린더');
  const heading=el('header');heading.append(el('h3','내 캘린더'),el('p','내 일정 · 회사 일정','help'));
  const status=el('p','','message');status.setAttribute('role','status');const controls=el('div','','worklog-controls');
  const content=el('div'),toolbar=el('div','','worklog-toolbar');toolbar.append(status,controls);root.replaceChildren(heading,toolbar,content);
  const detail=el('dialog','','worklog-day-dialog');const detailTitle=el('h4');detailTitle.id='calendar-day-title-'+epoch;detail.setAttribute('aria-labelledby',detailTitle.id);
  const rows=el('div'),close=button('닫기',()=>{if(!busy&&(!dirty||confirm('저장하지 않은 일정 입력을 닫을까요?'))){dirty=false;detail.close();}});
  const detailHeader=el('header','','worklog-detail-header');detailHeader.append(detailTitle,close);detail.append(detailHeader,rows);root.append(detail);
  detail.addEventListener('cancel',e=>{if(busy||(dirty&&!confirm('저장하지 않은 일정 입력을 닫을까요?')))e.preventDefault();else dirty=false;});
  function show(title){detailTitle.textContent=title;rows.replaceChildren();if(!detail.open)detail.showModal();}
  async function rpc(name,params){const result=await app.rpc(name,params);if(!alive())throw Error('CALENDAR_FORBIDDEN');return result;}
  function form(date,row=null){
   if(busy)return;show(row?'내 일정 수정':'내 일정 등록');dirty=false;
   const f=el('form','','employee-calendar-form');
   const field=(name,label,type,value='',parent=f)=>{const wrap=el('label'),input=el('input');wrap.append(el('span',label));input.name=name;input.type=type;input.value=value;wrap.append(input);parent.append(wrap);return input;};
   const title=field('calendar_title','제목','text',row?.title||'');title.required=true;title.maxLength=200;
   const dateInput=field('calendar_date','날짜','date',row?day(row.starts_at):date);dateInput.required=true;dateInput.min='2000-01-01';dateInput.max='2099-12-31';
   const starts=field('calendar_time','시작 시간 (선택)','time',row&&!row.all_day?time(row.starts_at):'');
   const extra=el('details');extra.append(el('summary','종료 시간·장소·메모'));
   const endDate=field('calendar_end_date','종료 날짜 (선택)','date',row?.ends_at?(row.all_day?new Date(Date.parse(day(row.ends_at)+'T00:00:00Z')-86400000).toISOString().slice(0,10):day(row.ends_at)):'',extra);
   const endTime=field('calendar_end_time','종료 시간 (선택)','time',row?.ends_at&&!row.all_day?time(row.ends_at):'',extra);
   const location=field('calendar_location','장소 (선택)','text',row?.location||'',extra);location.maxLength=200;
   const memo=el('label');memo.append(el('span','메모 (선택)'));const description=el('textarea');description.name='calendar_description';description.value=row?.description||'';description.maxLength=2000;memo.append(description);extra.append(memo);f.append(extra);
   const sync=()=>{endTime.disabled=!starts.value;};starts.addEventListener('input',sync);sync();
   const message=el('p','','message error');message.setAttribute('role','status');const save=el('button','일정 저장','button');save.type='submit';f.append(message,save);
   const id=row?.id||crypto.randomUUID(),requestId=crypto.randomUUID();
   f.addEventListener('input',()=>dirty=true);
   f.addEventListener('submit',async e=>{
    e.preventDefault();if(busy||!f.reportValidity()||!alive())return;
    if(starts.value&&endDate.value&&!endTime.value){message.textContent='종료 시간도 입력해 주세요.';return;}
    const allDay=!starts.value;
    const from=dateInput.value+'T'+(starts.value||'00:00')+':00+09:00';
    const until=allDay?plusDay(endDate.value||dateInput.value)+'T00:00:00+09:00':endTime.value?(endDate.value||dateInput.value)+'T'+endTime.value+':00+09:00':null;
    if(until&&Date.parse(until)<=Date.parse(from)){message.textContent='종료는 시작보다 뒤여야 합니다.';return;}
    busy=true;save.disabled=true;message.textContent='저장 중';
    try{
     await rpc('save_my_calendar_event',{p_id:id,p_request_id:requestId,p_expected_updated_at:row?.updated_at||null,p_title:title.value,p_starts_at:from,p_ends_at:until,p_all_day:allDay,p_location:location.value,p_description:description.value});
     dirty=false;detail.close();month=dateInput.value.slice(0,7);await load('일정을 저장했습니다.');
    }catch(error){if(alive())message.textContent=errorText(error);}
    finally{if(epoch===generation)busy=false;if(alive())save.disabled=false;}
   });rows.append(f);title.focus();
  }
  async function remove(row){
   if(busy||!confirm('이 개인 일정을 삭제할까요?'))return;
   busy=true;const requestId=crypto.randomUUID();
   try{await rpc('cancel_my_calendar_event',{p_id:row.id,p_request_id:requestId,p_expected_updated_at:row.updated_at});detail.close();await load('일정을 삭제했습니다.');}
   catch(e){if(alive())rows.append(el('p',errorText(e),'message error'));}
   finally{if(epoch===generation)busy=false;}
  }
  function openDay(date,entries){
   if(!alive()||busy)return;show(date+' 일정 '+entries.length+'개');
   if(!entries.length)rows.append(el('p','등록된 일정이 없습니다.','help'));
   for(const row of entries){
    const item=el('section','','worklog-day-event');item.append(el('small',source(row)+' · '+(row.all_day?'종일':time(row.starts_at))+(row.status==='cancelled'?' · 취소됨':'')),el('p',row.title));
    if(row.location)item.append(el('p',row.location,'help'));if(row.description)item.append(el('p',row.description,'calendar-description'));
    if(row.source==='personal'&&row.editable){item.append(button('수정',()=>form(date,row)),button('삭제',()=>void remove(row)));}
    else if(row.source==='personal')item.append(el('p','연결된 업무수첩 업무에서 수정할 수 있습니다.','help'));
    if(row.notice_id&&row.status!=='cancelled')item.append(button('공지 자세히 보기',async()=>{
     try{const n=await rpc('get_my_notice_detail',{p_notice_id:row.notice_id});if(!alive())return;show(n.title);rows.append(el('p',n.body_easy,'calendar-description'),button('일정으로 돌아가기',()=>openDay(date,entries)));}
     catch(e){if(alive())item.append(el('p','공지를 지금 열 수 없습니다. 새로 조회해 주세요.','message error'));}
    }));rows.append(item);
   }
   rows.append(button('이 날짜에 일정 등록',()=>form(date)));
  }
  function render(){
   const events=data.events.slice(0,1000);controls.replaceChildren(button('새로고침',()=>void load()),button('일정 등록',()=>form(month===day(new Date()).slice(0,7)?day(new Date()):month+'-01')));
   const section=el('section','','worklog-calendar'),navigation=el('div','','worklog-controls');
   const change=delta=>{const next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+delta,1)).toISOString().slice(0,7);if(next<'2000-01'||next>'2099-12')return;month=next;void load();};
   navigation.append(button('이전 달',()=>change(-1)),el('h4',month.replace('-','년 ')+'월'),button('다음 달',()=>change(1)),button('이번 달',()=>{month=day(new Date()).slice(0,7);void load();}));
   const table=el('table');table.setAttribute('aria-label',month+' 내 캘린더');const thead=el('thead'),tr=el('tr');for(const name of ['일','월','화','수','목','금','토']){const th=el('th',name);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);
   const body=el('tbody'),y=Number(month.slice(0,4)),m=Number(month.slice(5,7)),offset=new Date(Date.UTC(y,m-1,1)).getUTCDay(),days=new Date(Date.UTC(y,m,0)).getUTCDate();
   for(let week=0;week<Math.ceil((offset+days)/7);week++){
    const line=el('tr');for(let weekday=0;weekday<7;weekday++){
     const cell=el('td'),d=week*7+weekday-offset+1;
     if(d>0&&d<=days){const date=month+'-'+String(d).padStart(2,'0'),entries=events.filter(row=>overlaps(row,date));const b=button('',()=>openDay(date,entries));b.className='worklog-date-button';b.setAttribute('aria-label',date+' 일정 '+entries.length+'개 보기');b.setAttribute('aria-haspopup','dialog');b.append(el('span',String(d),'worklog-day'));if(date===data.today)b.setAttribute('aria-current','date');
      for(const row of entries.slice(0,2)){const event=el('span',(row.source==='personal'?'내 ':'회사 ')+(row.status==='cancelled'?'[취소] ':'')+row.title,'worklog-event calendar-source-'+(row.source==='personal'?'personal':'company'));event.title=source(row)+' · '+row.title;b.append(event);}if(entries.length>2)b.append(el('span','+'+(entries.length-2)+'개','worklog-more'));cell.append(b);
     }line.append(cell);
    }body.append(line);
   }table.append(body);section.append(navigation,table);
   const sidebar=el('aside','','worklog-sidebar'),today=events.filter(row=>overlaps(row,data.today));const todaySection=el('section','','worklog-list');todaySection.append(el('h4','오늘 일정 '+today.length+'건'));
   if(!today.length)todaySection.append(el('p',data.limited?'일부 일정만 표시 중입니다.':'오늘 일정이 없습니다.','help'));
   else {const ul=el('ul');for(const row of today){const li=el('li');li.append(button(row.title,()=>openDay(data.today,today)),el('small',source(row)+' · '+(row.all_day?'종일':time(row.starts_at))));ul.append(li);}todaySection.append(ul);}sidebar.append(todaySection);
   if(data.tasks?.length){const tasks=el('details','','worklog-tasks'),summary=el('summary');summary.append(el('span','업무수첩 미완료·재확인 업무'),el('strong',data.tasks.length+'건','worklog-count'));tasks.append(summary);const ul=el('ul');for(const task of data.tasks)ul.append(el('li',task.title));tasks.append(ul);sidebar.append(tasks);}
   const layout=el('div','','worklog-layout');layout.append(section,sidebar);content.replaceChildren(layout);
  }
  async function load(saved=''){
   if(!alive())return;if(dirty||detail.open)return;
   const expected=++request;status.textContent=saved||'일정을 불러오는 중';root.setAttribute('aria-busy','true');
   try{const result=await rpc('get_my_calendar_month',{p_month:month+'-01'});if(expected!==request||!alive())return;data=result;render();status.textContent=(saved?saved+' ':'')+(data.limited?'일부 일정만 표시 중입니다.':'내 일정은 본인만 볼 수 있습니다.');}
   catch(e){if(alive()&&expected===request){status.textContent=(saved?saved+' ':'')+errorText(e);controls.replaceChildren(button('다시 조회',()=>void load()));}}
   finally{if(alive()&&expected===request)root.removeAttribute('aria-busy');}
  }
  document.getElementById('logout-button')?.addEventListener('click',clear,{once:true,signal});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void load();},{signal});
  void load();
 }
 const mountWorker=()=>{if(window.TaejangApp?.getRoute?.()==='general_worker'&&!window.TaejangMenuAuthority?.hasDelegatedMenus?.())mount(document.getElementById('worker-calendar'));};
 document.addEventListener('taejang-app-ready',()=>{clear();mountWorker();});
 document.addEventListener('taejang-menu-authority-changed',mountWorker);
 for(const event of ['taejang-capabilities-ready','taejang-menu-authority-changed'])document.addEventListener(event,()=>{if(currentRoot&&(window.TaejangApp?.getContext?.()?.role_simulation?.active||window.TaejangApp?.getSession?.()?.user?.id!==currentActor))clear();});
 window.addEventListener('beforeunload',e=>{if(pending()){e.preventDefault();e.returnValue='';}});
 window.TaejangEmployeeCalendar={mount,hasUnsavedChanges:pending};
})();
