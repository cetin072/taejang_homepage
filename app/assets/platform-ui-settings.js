(() => {
  'use strict';

  const state = {
    roleCode: null,
    sidebarCollapsed: false,
    dashboardOrder: [],
    hiddenMenuKeys: new Set(),
    navSettings: null,
    editingDashboard: false,
    dashboardSnapshot: []
  };

  const app = () => window.TaejangApp;
  const el = id => document.getElementById(id);
  const registry = () => window.TaejangPlatformNavigationRegistry;
  const text = (tag,value,className) => {
    const node=document.createElement(tag);
    if(className) node.className=className;
    node.textContent=value ?? '';
    return node;
  };
  const button = (label,handler,quiet=false) => {
    const node=text('button',label,quiet?'button button-quiet':'button');
    node.type='button';
    node.addEventListener('click',handler);
    return node;
  };
  const cleanArray = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];

  function currentRole() {
    return app()?.getRoute?.() || null;
  }

  function menuKey(node) {
    if (!node) return null;
    const reg=registry();
    const key=node.dataset?.menuKey || reg?.keyForNode?.(node);
    if(key) node.dataset.menuKey=key;
    return key || null;
  }

  function applyRoleVisibility() {
    const nav=el('app-nav');
    if(!nav) return;
    [...nav.querySelectorAll('button,a')].forEach(node => {
      const key=menuKey(node);
      if(!key) return;
      const item=registry()?.byKey?.(key);
      const wasRoleHidden=node.dataset?.roleHidden==='1';
      const roleHidden=!item?.locked && state.hiddenMenuKeys.has(key);
      if(roleHidden) node.dataset.roleHidden='1';
      else delete node.dataset.roleHidden;
      if(roleHidden) {
        node.hidden=true;
        node.setAttribute('aria-hidden','true');
      } else if(wasRoleHidden && !node.dataset?.capabilityDenied) {
        node.hidden=false;
        node.setAttribute('aria-hidden','false');
      }
    });
    window.TaejangCapabilityUiGates?.refresh?.();
    window.TaejangRoleNavigationPriority?.schedule?.();
  }

  function applySidebarPreference() {
    const shell=el('desktop-app-shell');
    if(!shell) return;
    shell.classList.toggle('sidebar-collapsed',Boolean(state.sidebarCollapsed));
    const toggle=el('sidebar-preference-toggle');
    if(toggle) {
      toggle.setAttribute('aria-expanded',String(!state.sidebarCollapsed));
      toggle.setAttribute('aria-label',state.sidebarCollapsed?'사이드바 펼치기':'사이드바 접기');
      const label=toggle.querySelector('[data-sidebar-toggle-label]');
      if(label) label.textContent=state.sidebarCollapsed?'펼치기':'접기';
      const icon=toggle.querySelector('[data-sidebar-toggle-icon]');
      if(icon) icon.textContent=state.sidebarCollapsed?'▶':'◀';
    }
  }

  async function savePersonal(partial={}) {
    const role=state.roleCode || currentRole();
    if(!role) return null;
    const payload={
      p_role_code:role,
      p_sidebar_collapsed:Object.prototype.hasOwnProperty.call(partial,'sidebarCollapsed') ? Boolean(partial.sidebarCollapsed) : null,
      p_dashboard_order:Object.prototype.hasOwnProperty.call(partial,'dashboardOrder') ? partial.dashboardOrder : null
    };
    const result=await app().rpc('save_my_ui_preferences',payload);
    state.sidebarCollapsed=Boolean(result?.sidebar_collapsed);
    state.dashboardOrder=cleanArray(result?.dashboard_order);
    applySidebarPreference();
    applyDashboardOrder();
    return result;
  }

  async function toggleSidebar() {
    try {
      await savePersonal({sidebarCollapsed:!state.sidebarCollapsed});
    } catch(error) {
      window.alert(app()?.friendlyError?.(error) || '사이드바 설정을 저장하지 못했습니다.');
    }
  }

  function ensureSidebarToggle() {
    const sidebar=el('app-sidebar');
    if(!sidebar || sidebar.querySelector('#sidebar-preference-toggle')) return;
    const node=document.createElement('button');
    node.id='sidebar-preference-toggle';
    node.type='button';
    node.className='sidebar-preference-toggle';
    node.innerHTML='<span data-sidebar-toggle-icon aria-hidden="true">◀</span><span data-sidebar-toggle-label>접기</span>';
    node.addEventListener('click',toggleSidebar);
    sidebar.append(node);
    applySidebarPreference();
  }

  function dashboardCardKey(node) {
    if(!node) return null;
    const existing=node.dataset?.dashboardCardKey;
    if(existing) return existing;
    const key=node.dataset?.priorityDashboardCard || node.querySelector('h3')?.textContent?.trim() || node.dataset?.supportRadarShortcut;
    if(key) node.dataset.dashboardCardKey=String(key);
    return key ? String(key) : null;
  }

  function dashboardGrid() {
    return el('dashboard-main')?.querySelector('.dashboard-grid') || null;
  }

  function reorderGridBy(order) {
    const grid=dashboardGrid();
    if(!grid || grid.dataset.layoutEditing==='1') return;
    const children=[...grid.children];
    const rank=new Map(cleanArray(order).map((key,index)=>[key,index]));
    const desired=[...children].sort((a,b)=>{
      const ak=dashboardCardKey(a); const bk=dashboardCardKey(b);
      const ai=rank.has(ak)?rank.get(ak):9000;
      const bi=rank.has(bk)?rank.get(bk):9000;
      return ai-bi || children.indexOf(a)-children.indexOf(b);
    });
    if(desired.some((node,index)=>children[index]!==node)) {
      const fragment=document.createDocumentFragment();
      desired.forEach(node=>fragment.append(node));
      grid.append(fragment);
    }
  }

  function applyDashboardOrder() {
    reorderGridBy(state.dashboardOrder);
  }

  function cardOrder() {
    const grid=dashboardGrid();
    if(!grid) return [];
    return [...grid.children].map(dashboardCardKey).filter(Boolean);
  }

  function moveCard(node,direction) {
    const grid=dashboardGrid();
    if(!grid || !node) return;
    if(direction<0) {
      const prev=node.previousElementSibling;
      if(prev) grid.insertBefore(node,prev);
    } else {
      const next=node.nextElementSibling;
      if(next) grid.insertBefore(next,node);
    }
  }

  function decorateEditableCards() {
    const grid=dashboardGrid();
    if(!grid) return;
    [...grid.children].forEach(card=>{
      dashboardCardKey(card);
      card.draggable=true;
      card.classList.add('dashboard-card-editable');
      if(!card.querySelector('[data-dashboard-drag-tools]')) {
        const tools=document.createElement('div');
        tools.className='dashboard-drag-tools';
        tools.dataset.dashboardDragTools='1';
        const handle=text('span','↕ 드래그','dashboard-drag-handle');
        const prev=button('←',()=>moveCard(card,-1),true); prev.setAttribute('aria-label','카드 앞으로 이동');
        const next=button('→',()=>moveCard(card,1),true); next.setAttribute('aria-label','카드 뒤로 이동');
        tools.append(handle,prev,next);
        card.prepend(tools);
      }
      card.addEventListener('dragstart',event=>{
        event.dataTransfer?.setData('text/plain',dashboardCardKey(card)||'');
        card.classList.add('dashboard-card-dragging');
      });
      card.addEventListener('dragend',()=>card.classList.remove('dashboard-card-dragging'));
      card.addEventListener('dragover',event=>event.preventDefault());
      card.addEventListener('drop',event=>{
        event.preventDefault();
        const key=event.dataTransfer?.getData('text/plain');
        const grid=dashboardGrid();
        const dragged=[...grid.children].find(item=>dashboardCardKey(item)===key);
        if(dragged && dragged!==card) grid.insertBefore(dragged,card);
      });
    });
  }

  function clearEditableCards() {
    const grid=dashboardGrid();
    if(!grid) return;
    grid.dataset.layoutEditing='0';
    [...grid.children].forEach(card=>{
      card.draggable=false;
      card.classList.remove('dashboard-card-editable','dashboard-card-dragging');
      card.querySelector('[data-dashboard-drag-tools]')?.remove();
    });
  }

  function dashboardEditorActions() {
    const intro=el('dashboard-main')?.querySelector('.dashboard-intro');
    if(!intro) return null;
    let wrap=intro.querySelector('[data-dashboard-layout-actions]');
    if(!wrap) {
      wrap=document.createElement('div');
      wrap.className='dashboard-layout-actions';
      wrap.dataset.dashboardLayoutActions='1';
      intro.append(wrap);
    }
    return wrap;
  }

  async function saveDashboardLayout() {
    try {
      const order=cardOrder();
      await savePersonal({dashboardOrder:order});
      state.editingDashboard=false;
      clearEditableCards();
      injectDashboardEditor();
    } catch(error) {
      window.alert(app()?.friendlyError?.(error) || '대시보드 순서를 저장하지 못했습니다.');
    }
  }

  function cancelDashboardLayout() {
    const grid=dashboardGrid();
    if(grid) {
      const rank=new Map(state.dashboardSnapshot.map((key,index)=>[key,index]));
      const children=[...grid.children];
      children.sort((a,b)=>{
        const ai=rank.has(dashboardCardKey(a))?rank.get(dashboardCardKey(a)):9000;
        const bi=rank.has(dashboardCardKey(b))?rank.get(dashboardCardKey(b)):9000;
        return ai-bi;
      }).forEach(node=>grid.append(node));
    }
    state.editingDashboard=false;
    clearEditableCards();
    injectDashboardEditor();
  }

  async function resetDashboardLayout() {
    if(!window.confirm('내 대시보드 카드 순서를 기본값으로 되돌릴까요?')) return;
    try {
      await savePersonal({dashboardOrder:[]});
      state.editingDashboard=false;
      clearEditableCards();
      window.TaejangDashboardPriorityCards?.sync?.();
      injectDashboardEditor();
    } catch(error) {
      window.alert(app()?.friendlyError?.(error) || '대시보드 기본값을 복원하지 못했습니다.');
    }
  }

  function startDashboardLayout() {
    const grid=dashboardGrid();
    if(!grid) return;
    state.dashboardSnapshot=cardOrder();
    state.editingDashboard=true;
    grid.dataset.layoutEditing='1';
    decorateEditableCards();
    injectDashboardEditor();
  }

  function injectDashboardEditor() {
    const grid=dashboardGrid();
    const wrap=dashboardEditorActions();
    if(!grid || !wrap) return;
    applyDashboardOrder();
    wrap.replaceChildren();
    if(state.editingDashboard) {
      wrap.append(
        button('배치 저장',saveDashboardLayout),
        button('취소',cancelDashboardLayout,true),
        button('기본 배치로',resetDashboardLayout,true)
      );
      decorateEditableCards();
    } else {
      wrap.append(button('대시보드 수정',startDashboardLayout,true));
    }
  }

  function roleVisibilityMap(context,roleCode) {
    const map=new Map();
    const rows=Array.isArray(context?.visibility)?context.visibility:[];
    rows.filter(row=>row.role_code===roleCode).forEach(row=>map.set(row.menu_key,row.visible!==false));
    return map;
  }

  function settingsCheckbox(item,visible) {
    const label=document.createElement('label');
    label.className='platform-settings-check';
    const input=document.createElement('input');
    input.type='checkbox';
    input.value=item.key;
    input.checked=item.locked ? true : visible;
    input.disabled=Boolean(item.locked);
    const copy=document.createElement('span');
    copy.append(text('strong',item.label),text('small',item.section || '기본'));
    label.append(input,copy);
    return label;
  }

  async function renderSettings() {
    if(!app()?.can?.('platform.navigation.manage')) return;
    const main=el('dashboard-main');
    if(!main) return;
    const title=el('desktop-page-title'); if(title) title.textContent='설정';
    main.replaceChildren(text('p','설정을 불러오고 있습니다.','message'));
    try {
      const context=await app().rpc('get_platform_navigation_settings');
      state.navSettings=context;
      const shell=document.createElement('div'); shell.className='platform-settings-shell';
      const header=document.createElement('header'); header.className='dashboard-intro';
      header.append(text('p','운영총괄 설정','eyebrow'),text('h2','플랫폼 설정'),text('p','직책별로 보일 메뉴를 정하고 내 화면 배치를 조정합니다. 메뉴 표시 설정은 기능 권한을 추가하지 않습니다.'));
      shell.append(header);

      const personal=document.createElement('section'); personal.className='platform-settings-card';
      personal.append(text('h3','내 화면 옵션'));
      const sidebarLabel=document.createElement('label'); sidebarLabel.className='platform-settings-toggle';
      const sidebarCheck=document.createElement('input'); sidebarCheck.type='checkbox'; sidebarCheck.checked=!state.sidebarCollapsed;
      sidebarLabel.append(sidebarCheck,text('span','사이드바 기본 펼치기'));
      sidebarCheck.addEventListener('change',async()=>{
        try{await savePersonal({sidebarCollapsed:!sidebarCheck.checked});}
        catch(error){sidebarCheck.checked=!state.sidebarCollapsed;window.alert(app()?.friendlyError?.(error)||'설정을 저장하지 못했습니다.');}
      });
      personal.append(sidebarLabel,text('p','기본은 펼침입니다. 접기로 저장하면 다음 로그인에서도 접힌 상태를 유지합니다.','help'));
      shell.append(personal);

      const roleCard=document.createElement('section'); roleCard.className='platform-settings-card';
      roleCard.append(text('h3','직책·역할별 사이드바 메뉴'));
      const select=document.createElement('select'); select.className='platform-settings-role-select';
      (context.roles||[]).forEach(role=>{
        const option=document.createElement('option');option.value=role.code;option.textContent=role.name;select.append(option);
      });
      roleCard.append(select,text('p','체크 해제하면 해당 직책에서 메뉴만 숨깁니다. 실제 접근 권한은 기존 capability/RLS가 그대로 적용됩니다.','help'));
      const checklist=document.createElement('div');checklist.className='platform-settings-checklist';
      roleCard.append(checklist);
      const actions=document.createElement('div');actions.className='quick-links';
      const save=button('메뉴 설정 저장',async()=>{
        const visibility={};
        checklist.querySelectorAll('input[type="checkbox"]').forEach(input=>{visibility[input.value]=input.checked;});
        try{
          await app().rpc('save_role_navigation_visibility',{p_role_code:select.value,p_visibility:visibility});
          context.visibility=(context.visibility||[]).filter(row=>row.role_code!==select.value);
          Object.entries(visibility).forEach(([menu_key,visible])=>context.visibility.push({role_code:select.value,menu_key,visible}));
          if(select.value===currentRole()) await loadRoleVisibility();
          window.alert('메뉴 표시 설정을 저장했습니다.');
        }catch(error){window.alert(app()?.friendlyError?.(error)||'메뉴 설정을 저장하지 못했습니다.');}
      });
      const reset=button('기본값으로 초기화',async()=>{
        if(!window.confirm('이 직책의 메뉴 표시 설정을 기본값으로 되돌릴까요?')) return;
        try{
          await app().rpc('reset_role_navigation_visibility',{p_role_code:select.value});
          context.visibility=(context.visibility||[]).filter(row=>row.role_code!==select.value);
          renderChecklist();
          if(select.value===currentRole()) await loadRoleVisibility();
        }catch(error){window.alert(app()?.friendlyError?.(error)||'메뉴 설정을 초기화하지 못했습니다.');}
      },true);
      actions.append(save,reset);roleCard.append(actions);
      shell.append(roleCard);

      function renderChecklist(){
        checklist.replaceChildren();
        const overrides=roleVisibilityMap(context,select.value);
        const sections=new Map();
        registry().items().filter(item=>!item.public).forEach(item=>{
          const section=item.section||'기본';
          if(!sections.has(section)) sections.set(section,[]);
          sections.get(section).push(item);
        });
        sections.forEach((items,name)=>{
          const group=document.createElement('fieldset');group.className='platform-settings-group';
          const legend=document.createElement('legend');legend.textContent=name;group.append(legend);
          items.forEach(item=>group.append(settingsCheckbox(item,overrides.has(item.key)?overrides.get(item.key):true)));
          checklist.append(group);
        });
      }
      select.addEventListener('change',renderChecklist);
      renderChecklist();

      main.replaceChildren(shell);main.focus();
    } catch(error) {
      main.replaceChildren(text('p',app()?.friendlyError?.(error)||'설정을 불러오지 못했습니다.','message error'));
    }
  }

  async function loadRoleVisibility() {
    const role=currentRole();
    if(!role) return;
    try {
      const result=await app().rpc('get_my_navigation_visibility',{p_role_code:role});
      state.hiddenMenuKeys=new Set(cleanArray(result?.hidden_menu_keys));
    } catch {
      state.hiddenMenuKeys=new Set();
    }
    applyRoleVisibility();
  }

  async function loadPersonalPreferences() {
    const role=currentRole();
    if(!role) return;
    state.roleCode=role;
    try {
      const result=await app().rpc('get_my_ui_preferences',{p_role_code:role});
      state.sidebarCollapsed=Boolean(result?.sidebar_collapsed);
      state.dashboardOrder=cleanArray(result?.dashboard_order);
    } catch {
      state.sidebarCollapsed=false;
      state.dashboardOrder=[];
    }
    ensureSidebarToggle();
    applySidebarPreference();
    applyDashboardOrder();
    injectDashboardEditor();
  }

  function observeNavigation() {
    const nav=el('app-nav');
    if(!nav || nav.dataset.uiPreferenceObserver==='1') return;
    nav.dataset.uiPreferenceObserver='1';
    new MutationObserver(()=>queueMicrotask(applyRoleVisibility)).observe(nav,{childList:true,subtree:true,characterData:true});
  }

  function observeDashboard() {
    const main=el('dashboard-main');
    if(!main || main.dataset.uiLayoutObserver==='1') return;
    main.dataset.uiLayoutObserver='1';
    new MutationObserver(()=>queueMicrotask(()=>{
      if(!state.editingDashboard) applyDashboardOrder();
      injectDashboardEditor();
    })).observe(main,{childList:true,subtree:false});
  }

  async function refresh() {
    if(currentRole()==='general_worker') return;
    observeNavigation();
    observeDashboard();
    await Promise.all([loadPersonalPreferences(),loadRoleVisibility()]);
  }

  document.addEventListener('taejang-open-platform-settings',renderSettings);
  document.addEventListener('taejang-app-ready',()=>queueMicrotask(refresh));
  document.addEventListener('taejang-capabilities-ready',()=>queueMicrotask(refresh));
  document.addEventListener('taejang-dashboard-refresh',()=>setTimeout(()=>{applyDashboardOrder();injectDashboardEditor();},80));

  window.TaejangPlatformUiSettings={
    refresh,
    renderSettings,
    getDashboardOrder:()=>state.dashboardOrder.slice(),
    isDashboardEditing:()=>state.editingDashboard,
    applyRoleVisibility
  };
})();