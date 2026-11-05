(() => {
 'use strict';
 let root=null,timer=null,flight=null,epoch=0,owner=null;
 const app=()=>window.TaejangApp;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
 const allowed=()=>['operations_manager','promotion_lead'].includes(app()?.getRoute?.())&&Boolean(app()?.getSession?.()?.user?.id);
 const can=key=>window.TaejangMenuAuthority?.allowed(key,app()?.can?.(key==='attendance.view'?'attendance.admin_view':key)===true)??app()?.can?.(key==='attendance.view'?'attendance.admin_view':key)===true;
 function clear(){epoch++;clearTimeout(timer);timer=null;root?.remove();root=null;owner=null;}
 const time=value=>new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(new Date(value));
 function card(title,rows,label,open,unit='명'){const box=el('article',null,'dashboard-card');box.append(el('h3',`${title} ${rows.length}${unit}`));const list=el('ul');rows.forEach(row=>list.append(el('li',label(row))));box.append(list);const b=el('button','확인하기','button button-quiet');b.type='button';b.onclick=open;box.append(b);return box;}
 async function refresh(){
  if(!root?.isConnected||!allowed()||(!can('attendance.view')&&!can('leave.manage'))){clear();return;}
  if(flight?.version===epoch)return flight.promise;
  const current=root,version=epoch,actor=app().getSession().user.id,role=app().getRoute();const alive=()=>version===epoch&&current===root&&current.isConnected&&allowed()&&app().getSession().user.id===actor&&app().getRoute()===role;
  const job=Promise.resolve().then(async()=>{try{
   const data=await app().rpc('get_management_attention_cards');if(!alive())return;current.replaceChildren();
   if(data.attendance_allowed&&can('attendance.view')&&data.missing_clock_ins?.length)current.append(card('출근 확인 필요',data.missing_clock_ins,r=>`${r.name} · 예정 ${time(r.starts_at)}`,()=>document.dispatchEvent(new CustomEvent('taejang-open-app-panel',{detail:{id:'attendance-admin-panel'}}))));
   if(data.leave_allowed&&can('leave.manage')&&data.pending_leaves?.length)current.append(card('연차 확인 대기',data.pending_leaves,r=>`${r.name} · ${r.work_date}${r.new_work_date?' → '+r.new_work_date:''} · ${{application:'신청',amend:'수정 요청',cancel:'취소 요청'}[r.kind]||'신청'}`,()=>window.TaejangEmployeeLeave?.open(),'건'));
   current.hidden=!current.childElementCount;
   const due=Date.parse(data.next_due_at)-Date.parse(data.server_now);const delay=Number.isFinite(due)&&due>0?Math.min(60000,Math.max(1000,due+50)):60000;
   clearTimeout(timer);timer=setTimeout(()=>{if(document.visibilityState!=='hidden')void refresh();},delay);
  }catch(error){if(!alive())return;current.replaceChildren();current.hidden=false;const note=el('p',error?.code==='42501'?'현재 권한으로 확인할 수 없습니다.':'출근·연차 확인 정보를 불러오지 못했습니다. 새로고침해주세요.','message');note.setAttribute('role','status');current.append(note);if(error?.code==='42501')clear();}
  finally{if(flight?.version===version)flight=null;}});flight={version,promise:job};return job;
 }
 function mount(target){
  if(!allowed()||(!can('attendance.view')&&!can('leave.manage'))){clear();return;}
  const actor=app().getSession().user.id+':'+app().getRoute();
  if(root?.isConnected&&owner===actor)return;
  clear();owner=actor;root=el('section',null,'management-attention-cards');root.dataset.managementAttention='1';root.setAttribute('aria-label','출근·연차 확인');root.hidden=true;
  const anchor=target.querySelector('.dashboard-grid');if(!anchor)return;const intro=target.querySelector('.dashboard-intro');if(intro)intro.after(root);else anchor.before(root);void refresh();
 }
 document.addEventListener('taejang-app-ready',clear);
 document.addEventListener('taejang-menu-authority-changed',()=>{clear();document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh'));});
 document.addEventListener('taejang-dashboard-refresh',()=>{if(root?.isConnected)void refresh();});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&root?.isConnected)void refresh();});
 window.addEventListener('focus',()=>{if(root?.isConnected)void refresh();});
 window.TaejangManagementAttention={mount,refresh,clear};
})();
