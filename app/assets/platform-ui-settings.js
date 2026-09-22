(() => {
  'use strict';

  const state = {
    roleCode: null,
    collapsedSections: new Set(),
    dashboardOrder: [],
    dashboardCustomized: false,
    sidebarSectionOrder: [],
    sidebarMenuOrder: [],
    hiddenMenuKeys: new Set(),
    navSettings: null,
    editingDashboard: false,
    dashboardSnapshot: [],
    editingSidebar: false,
    sidebarSnapshot: null
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
  const uniqueArray = value => [...new Set(cleanArray(value))];
  const DASHBOARD_CUSTOM_SENTINEL = '__custom_dashboard_cards__';
  const DASHBOARD_KEY_ALIASES = Object.freeze({
    '홍보 검토 대기':'promotion.review', 'promotion.review.pending':'promotion.review',
    '홍보자료 작성':'promotion.write',
    '보완 요청받은 글':'promotion.revision',
    '중요 홍보 승인':'promotion.review', 'promotion.operations.review':'promotion.review',
    '홍보 상신 검토':'promotion.review', 'promotion.ceo.review':'promotion.review',
    '계정 승인 확인':'account.approval', 'account.signup-requests':'account.approval',
    '근태·급여관리':'payroll.manage',
    '직원관리 요청':'employee.manage', 'employee.change-requests':'employee.manage',
    '팀 직원 관리':'employee.manage', 'employee.team':'employee.manage',
    '홈페이지 수정 승인':'homepage.content', 'homepage.change-approval':'homepage.content',
    '오늘 출근부':'attendance.view', 'attendance.today':'attendance.view',
    '지원사업 레이더':'support.radar',
    '공지 등록':'notice.create',
    '공지 관리':'notice.manage'
  });
  const normalizeDashboardKey = key => DASHBOARD_KEY_ALIASES[key] || key;
  const dashboardOrder = value => [...new Set(
    uniqueArray(value)
      .filter(key=>key!==DASHBOARD_CUSTOM_SENTINEL)
      .map(normalizeDashboardKey)
  )];
  const dashboardCustomized = value => uniqueArray(value).includes(DASHBOARD_CUSTOM_SENTINEL);

  function mergeSavedOrder(saved, master) {
    const masterKeys=uniqueArray(master);
    const result=uniqueArray(saved).filter(key=>masterKeys.includes(key));
    masterKeys.forEach(key=>{
      if(result.includes(key)) return;
      const masterIndex=masterKeys.indexOf(key);
      const previous=[...masterKeys.slice(0,masterIndex)].reverse().find(item=>result.includes(item));
      const next=masterKeys.slice(masterIndex+1).find(item=>result.includes(item));
      if(previous) result.splice(result.indexOf(previous)+1,0,key);
      else if(next) result.splice(result.indexOf(next),0,key);
      else result.push(key);
    });
    return result;
  }

  function sidebarSectionKeys() { return registry()?.sections?.().map(section=>section.key) || []; }
  function sidebarMenuKeys() { return registry()?.items?.().filter(item=>!item.public && item.section).map(item=>item.key) || []; }
  function sidebarPreference() {
    return {
      sectionOrder:mergeSavedOrder(state.sidebarSectionOrder,sidebarSectionKeys()),
      menuOrder:mergeSavedOrder(state.sidebarMenuOrder,sidebarMenuKeys())
    };
  }

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
    window.TaejangRoleNavigationPriority?.refreshSectionVisibility?.();
  }

  function applySectionCollapse() {
    const nav=el('app-nav');
    if(!nav) return;
    [...nav.querySelectorAll(':scope > [data-nav-section-toggle="1"]')].forEach(toggle=>{
      const key=toggle.dataset.sectionKey;
      const collapsed=state.collapsedSections.has(key);
      toggle.setAttribute('aria-expanded',String(!collapsed));
      toggle.classList.toggle('is-collapsed',collapsed);
      const icon=toggle.querySelector('[data-section-chevron]');
      if(icon) icon.textContent=collapsed?'▸':'▾';
      [...nav.querySelectorAll(`:scope > [data-nav-section="${key}"]`)].forEach(node=>{
        if(collapsed) node.dataset.sectionCollapsed='1';
        else delete node.dataset.sectionCollapsed;
        if(collapsed) {
          node.hidden=true;
          node.setAttribute('aria-hidden','true');
        } else if(node.dataset.roleHidden!=='1' && !node.dataset.capabilityDenied) {
          node.hidden=false;
          node.setAttribute('aria-hidden','false');
        }
      });
    });
    window.TaejangCapabilityUiGates?.refresh?.();
    window.TaejangRoleNavigationPriority?.refreshSectionVisibility?.();
  }

  async function saveCollapsedSections() {
    const role=state.roleCode || currentRole();
    if(!role) return null;
    return app().rpc('save_my_sidebar_sections',{
      p_role_code:role,
      p_collapsed_sections:[...state.collapsedSections].sort()
    });
  }

  async function toggleSection(sectionKey) {
    if(!sectionKey) return;
    if(state.collapsedSections.has(sectionKey)) state.collapsedSections.delete(sectionKey);
    else state.collapsedSections.add(sectionKey);
    applySectionCollapse();
    try {
      await saveCollapsedSections();
    } catch(error) {
      if(state.collapsedSections.has(sectionKey)) state.collapsedSections.delete(sectionKey);
      else state.collapsedSections.add(sectionKey);
      applySectionCollapse();
      window.alert(app()?.friendlyError?.(error)||'사이드바 카테고리 상태를 저장하지 못했습니다.');
    }
  }

  async function savePersonal(partial={}) {
    const role=state.roleCode || currentRole();
    if(!role) return null;
    const payload={
      p_role_code:role,
      p_sidebar_collapsed:null,
      p_dashboard_order:Object.prototype.hasOwnProperty.call(partial,'dashboardOrder') ? partial.dashboardOrder : null,
      p_sidebar_section_order:Object.prototype.hasOwnProperty.call(partial,'sidebarSectionOrder') ? partial.sidebarSectionOrder : null,
      p_sidebar_menu_order:Object.prototype.hasOwnProperty.call(partial,'sidebarMenuOrder') ? partial.sidebarMenuOrder : null
    };
    const result=await app().rpc('save_my_ui_preferences',payload);
    state.dashboardOrder=dashboardOrder(result?.dashboard_order);
    state.dashboardCustomized=dashboardCustomized(result?.dashboard_order);
    state.sidebarSectionOrder=uniqueArray(result?.sidebar_section_order);
    state.sidebarMenuOrder=uniqueArray(result?.sidebar_menu_order);
    applyDashboardOrder();
    window.TaejangRoleNavigationPriority?.reorder?.();
    return result;
  }

  function dashboardCardKey(node) {
    if(!node) return null;
    const existing=node.dataset?.dashboardCardKey;
    const marker = node.dataset?.supportRadarShortcut ? 'support.radar'
      : node.dataset?.attendanceCard ? 'attendance.view'
        : node.dataset?.phaseCAccountApprovalCard ? 'account.approval'
          : null;
    const raw=existing || marker || node.dataset?.priorityDashboardCard || node.querySelector('h3')?.textContent?.trim();
    const key=raw ? normalizeDashboardKey(String(raw)) : null;
    if(key) node.dataset.dashboardCardKey=key;
    return key;
  }

  function isDashboardSurface() {
    const target=el('dashboard-main');
    return target?.querySelector(':scope > .dashboard-intro h2')?.textContent?.trim()==='대시보드';
  }

  function dashboardGrid() {
    if(!isDashboardSurface()) return null;
    return el('dashboard-main')?.querySelector(':scope > .dashboard-grid') || null;
  }

  function reorderGridBy(order) {
    const grid=dashboardGrid();
    if(!grid || grid.dataset.layoutEditing==='1') return;
    const children=[...grid.children];
    const rank=new Map(dashboardOrder(order).map((key,index)=>[key,index]));
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
    return uniqueArray([...grid.children].map(dashboardCardKey));
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

  function moveCardTo(dragged,target,before=true) {
    const grid=dashboardGrid();
    if(!grid || !dragged || !target || dragged===target) return;
    grid.insertBefore(dragged,before ? target : target.nextElementSibling);
  }

  function bindCardHandle(handle,card) {
    if(handle.dataset.bound==='1') return;
    handle.dataset.bound='1';
    handle.draggable=true;
    handle.addEventListener('dragstart',event=>{
      event.dataTransfer?.setData('text/plain',`dashboard:${dashboardCardKey(card)||''}`);
      event.dataTransfer && (event.dataTransfer.effectAllowed='move');
      card.classList.add('dashboard-card-dragging');
    });
    handle.addEventListener('dragend',()=>card.classList.remove('dashboard-card-dragging'));
    handle.addEventListener('keydown',event=>{
      if(event.key==='ArrowUp' || event.key==='ArrowLeft') { event.preventDefault(); moveCard(card,-1); }
      if(event.key==='ArrowDown' || event.key==='ArrowRight') { event.preventDefault(); moveCard(card,1); }
    });
    handle.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse') return;
      event.preventDefault();
      const finish=up=>{
        const target=document.elementFromPoint(up.clientX,up.clientY)?.closest?.('.dashboard-card');
        if(target && target!==card) moveCardTo(card,target,up.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2);
        card.classList.remove('dashboard-card-dragging');
        window.removeEventListener('pointerup',finish,true);
      };
      card.classList.add('dashboard-card-dragging');
      window.addEventListener('pointerup',finish,true);
    });
  }

  function decorateEditableCards() {
    const grid=dashboardGrid();
    if(!grid) return;
    [...grid.children].forEach(card=>{
      dashboardCardKey(card);
      card.classList.add('dashboard-card-editable');
      if(!card.querySelector('[data-dashboard-drag-tools]')) {
        const tools=document.createElement('div');
        tools.className='dashboard-drag-tools';
        tools.dataset.dashboardDragTools='1';
        const handle=text('span','↕ 드래그','dashboard-drag-handle');
        handle.tabIndex=0;
        handle.setAttribute('role','button');
        handle.setAttribute('aria-label','카드 순서 변경. 화살표 키 또는 드래그로 이동');
        const prev=button('←',()=>moveCard(card,-1),true); prev.setAttribute('aria-label','카드 앞으로 이동');
        const next=button('→',()=>moveCard(card,1),true); next.setAttribute('aria-label','카드 뒤로 이동');
        tools.append(handle,prev,next);
        if(currentRole()==='operations_manager') {
          const remove=button('제거',()=>{
            card.remove();
            renderDashboardCardPicker();
          },true);
          remove.setAttribute('aria-label',`${card.querySelector('h3')?.textContent?.trim() || '카드'} 대시보드에서 제거`);
          tools.append(remove);
        }
        card.prepend(tools);
        bindCardHandle(handle,card);
      }
      card.addEventListener('dragover',event=>{
        if(state.editingDashboard && event.dataTransfer?.types.includes('text/plain')) event.preventDefault();
      });
      card.addEventListener('drop',event=>{
        event.preventDefault();
        const key=event.dataTransfer?.getData('text/plain')?.replace(/^dashboard:/,'');
        const grid=dashboardGrid();
        const dragged=[...grid.children].find(item=>dashboardCardKey(item)===key);
        if(dragged && dragged!==card) moveCardTo(dragged,card,event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2);
      });
    });
  }

  function clearEditableCards() {
    const grid=dashboardGrid();
    if(!grid) return;
    grid.dataset.layoutEditing='0';
    [...grid.children].forEach(card=>{
      card.classList.remove('dashboard-card-editable','dashboard-card-dragging');
      card.querySelector('[data-dashboard-drag-tools]')?.remove();
    });
    el('dashboard-main')?.querySelector('[data-dashboard-card-picker]')?.remove();
  }

  function dashboardCardPicker() {
    if(currentRole()!=='operations_manager') return null;
    const intro=el('dashboard-main')?.querySelector(':scope > .dashboard-intro');
    if(!intro) return null;
    let picker=intro.querySelector('[data-dashboard-card-picker]');
    if(!picker) {
      picker=document.createElement('div');
      picker.className='dashboard-card-picker';
      picker.dataset.dashboardCardPicker='1';
      picker.hidden=true;
      intro.append(picker);
    }
    return picker;
  }

  function renderDashboardCardPicker() {
    const picker=dashboardCardPicker();
    if(!picker || picker.hidden) return;
    const items=window.TaejangDashboardPriorityCards?.availableCardItems?.() || [];
    const existing=new Set(cardOrder());
    const candidates=items.filter(item=>!existing.has(item.key));
    const heading=text('strong','카드 추가');
    const help=text('p','현재 계정에서 실제로 사용할 수 있는 관리 기능만 표시합니다. 추가한 카드는 저장 후에도 유지됩니다.','help');
    const list=document.createElement('div');
    list.className='dashboard-card-picker-list';
    if(!candidates.length) {
      list.append(text('span','추가할 수 있는 카드가 더 없습니다.','help'));
    } else {
      candidates.forEach(item=>{
        const add=button(`+ ${item.label}`,()=>{
          window.TaejangDashboardPriorityCards?.addCardByKey?.(item.key);
          decorateEditableCards();
          renderDashboardCardPicker();
        },true);
        add.dataset.dashboardAddCard=item.key;
        list.append(add);
      });
    }
    picker.replaceChildren(heading,help,list);
  }

  function toggleDashboardCardPicker() {
    const picker=dashboardCardPicker();
    if(!picker) return;
    picker.hidden=!picker.hidden;
    if(!picker.hidden) renderDashboardCardPicker();
  }

  function dashboardEditorActions() {
    if(!isDashboardSurface()) return null;
    const intro=el('dashboard-main')?.querySelector(':scope > .dashboard-intro');
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
      const savedOrder=currentRole()==='operations_manager'
        ? [DASHBOARD_CUSTOM_SENTINEL,...order]
        : order;
      await savePersonal({dashboardOrder:savedOrder});
      state.editingDashboard=false;
      clearEditableCards();
      window.TaejangDashboardPriorityCards?.sync?.();
      injectDashboardEditor();
    } catch(error) {
      window.alert(app()?.friendlyError?.(error) || '대시보드 순서를 저장하지 못했습니다.');
    }
  }

  function cancelDashboardLayout() {
    state.editingDashboard=false;
    clearEditableCards();
    document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh'));
  }

  async function resetDashboardLayout() {
    try {
      await savePersonal({dashboardOrder:[]});
      state.editingDashboard=false;
      clearEditableCards();
      // Re-render the dashboard immediately so removed/conditional default cards
      // are rebuilt now rather than only appearing after a manual page refresh.
      document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh'));
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
      if(currentRole()==='operations_manager') wrap.append(button('+ 카드 추가',toggleDashboardCardPicker,true));
      wrap.append(
        button('저장',saveDashboardLayout),
        button('취소',cancelDashboardLayout,true),
        button('기본값',resetDashboardLayout,true)
      );
      decorateEditableCards();
    } else {
      wrap.append(button('대시보드 편집',startDashboardLayout,true));
    }
  }

  function sidebarNav() { return el('app-nav'); }
  function sidebarMenuNode(key) { return sidebarNav()?.querySelector(`[data-menu-key="${key}"]`) || null; }
  function sidebarSectionNode(key) { return sidebarNav()?.querySelector(`[data-nav-section-toggle="1"][data-section-key="${key}"]`) || null; }

  function moveInOrder(order,key,targetKey,before=true) {
    const next=order.filter(item=>item!==key);
    const index=next.indexOf(targetKey);
    if(index<0) return order;
    next.splice(before ? index : index+1,0,key);
    return next;
  }

  function moveSidebarSection(key,targetKey,before=true) {
    const order=sidebarPreference().sectionOrder;
    state.sidebarSectionOrder=moveInOrder(order,key,targetKey,before);
    window.TaejangRoleNavigationPriority?.reorder?.();
  }

  function moveSidebarMenu(key,targetKey,before=true) {
    const reg=registry();
    const section=reg?.byKey?.(key)?.section;
    if(!section || section!==reg?.byKey?.(targetKey)?.section) return;
    const all=sidebarPreference().menuOrder;
    const inSection=all.filter(item=>reg?.byKey?.(item)?.section===section);
    const moved=moveInOrder(inSection,key,targetKey,before);
    let index=0;
    state.sidebarMenuOrder=all.map(item=>reg?.byKey?.(item)?.section===section ? moved[index++] : item);
    window.TaejangRoleNavigationPriority?.reorder?.();
  }

  function sidebarEditorActions() {
    const sidebar=el('app-sidebar');
    if(!sidebar) return null;
    let wrap=sidebar.querySelector('[data-sidebar-layout-actions]');
    if(!wrap) {
      wrap=document.createElement('div');
      wrap.className='sidebar-layout-actions';
      wrap.dataset.sidebarLayoutActions='1';
      sidebar.append(wrap);
    }
    return wrap;
  }

  function bindSidebarHandle(handle,type,key) {
    if(handle.dataset.bound==='1') return;
    handle.dataset.bound='1';
    handle.draggable=true;
    const move=type==='section' ? moveSidebarSection : moveSidebarMenu;
    const targetFor=point=>{
      const candidate=document.elementFromPoint(point.clientX,point.clientY);
      return type==='section'
        ? candidate?.closest?.('[data-nav-section-toggle="1"]')?.dataset?.sectionKey
        : menuKey(candidate?.closest?.('[data-menu-key]'));
    };
    handle.addEventListener('click',event=>{ event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener('dragstart',event=>{
      event.dataTransfer?.setData('text/plain',`sidebar-${type}:${key}`);
      event.dataTransfer && (event.dataTransfer.effectAllowed='move');
      handle.closest(type==='section' ? '[data-nav-section-toggle]' : '[data-menu-key]')?.classList.add('sidebar-item-dragging');
    });
    handle.addEventListener('dragend',()=>handle.closest(type==='section' ? '[data-nav-section-toggle]' : '[data-menu-key]')?.classList.remove('sidebar-item-dragging'));
    handle.addEventListener('keydown',event=>{
      const previous=event.key==='ArrowUp' || event.key==='ArrowLeft';
      const next=event.key==='ArrowDown' || event.key==='ArrowRight';
      if(!previous && !next) return;
      event.preventDefault();
      const order=type==='section' ? sidebarPreference().sectionOrder : sidebarPreference().menuOrder.filter(item=>registry()?.byKey?.(item)?.section===registry()?.byKey?.(key)?.section);
      const index=order.indexOf(key);
      const target=order[index+(previous?-1:1)];
      if(target) move(key,target,previous ? true : false);
    });
    handle.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse') return;
      event.preventDefault(); event.stopPropagation();
      const owner=handle.closest(type==='section' ? '[data-nav-section-toggle]' : '[data-menu-key]');
      owner?.classList.add('sidebar-item-dragging');
      const finish=up=>{
        const target=targetFor(up);
        if(target && target!==key) move(key,target,true);
        owner?.classList.remove('sidebar-item-dragging');
        window.removeEventListener('pointerup',finish,true);
      };
      window.addEventListener('pointerup',finish,true);
    });
  }

  function decorateEditableSidebar() {
    const nav=sidebarNav();
    if(!nav) return;
    nav.dataset.layoutEditing='1';
    [...nav.querySelectorAll(':scope > [data-nav-section-toggle="1"]')].forEach(node=>{
      if(node.querySelector('[data-sidebar-drag-handle]')) return;
      const handle=text('span','⋮⋮','sidebar-drag-handle');
      handle.dataset.sidebarDragHandle='section';
      handle.tabIndex=0;
      handle.setAttribute('role','button');
      handle.setAttribute('aria-label',`${node.dataset.sectionKey} 카테고리 순서 변경`);
      node.append(handle);
      bindSidebarHandle(handle,'section',node.dataset.sectionKey);
    });
    [...nav.querySelectorAll(':scope > [data-menu-key][data-nav-section]')].forEach(node=>{
      const key=menuKey(node);
      if(!key || node.querySelector('[data-sidebar-drag-handle]')) return;
      const handle=text('span','⋮⋮','sidebar-drag-handle');
      handle.dataset.sidebarDragHandle='menu';
      handle.tabIndex=0;
      handle.setAttribute('role','button');
      handle.setAttribute('aria-label',`${key} 메뉴 순서 변경`);
      node.append(handle);
      bindSidebarHandle(handle,'menu',key);
    });
  }

  function clearEditableSidebar() {
    const nav=sidebarNav();
    if(!nav) return;
    delete nav.dataset.layoutEditing;
    nav.querySelectorAll('[data-sidebar-drag-handle]').forEach(node=>node.remove());
    nav.querySelectorAll('.sidebar-item-dragging').forEach(node=>node.classList.remove('sidebar-item-dragging'));
  }

  function bindSidebarDropTargets() {
    const nav=sidebarNav();
    if(!nav || nav.dataset.sidebarDropBound==='1') return;
    nav.dataset.sidebarDropBound='1';
    nav.addEventListener('click',event=>{
      if(!state.editingSidebar || event.target.closest('[data-sidebar-drag-handle]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
    },true);
    nav.addEventListener('dragover',event=>{
      if(state.editingSidebar && event.dataTransfer?.types.includes('text/plain')) event.preventDefault();
    });
    nav.addEventListener('drop',event=>{
      if(!state.editingSidebar) return;
      const [kind,key]=String(event.dataTransfer?.getData('text/plain')||'').replace(/^sidebar-/,'').split(':');
      const target=kind==='section'
        ? event.target.closest('[data-nav-section-toggle="1"]')?.dataset?.sectionKey
        : menuKey(event.target.closest('[data-menu-key]'));
      if(!key || !target || key===target) return;
      event.preventDefault();
      const box=event.target.closest(kind==='section' ? '[data-nav-section-toggle="1"]' : '[data-menu-key]')?.getBoundingClientRect();
      const before=!box || event.clientY < box.top + box.height / 2;
      if(kind==='section') moveSidebarSection(key,target,before);
      if(kind==='menu') moveSidebarMenu(key,target,before);
    });
  }

  async function saveSidebarLayout() {
    try {
      await savePersonal({sidebarSectionOrder:state.sidebarSectionOrder,sidebarMenuOrder:state.sidebarMenuOrder});
      state.editingSidebar=false;
      clearEditableSidebar();
      injectSidebarEditor();
    } catch(error) { window.alert(app()?.friendlyError?.(error)||'메뉴 순서를 저장하지 못했습니다.'); }
  }

  function cancelSidebarLayout() {
    state.sidebarSectionOrder=state.sidebarSnapshot?.sectionOrder || [];
    state.sidebarMenuOrder=state.sidebarSnapshot?.menuOrder || [];
    state.editingSidebar=false;
    clearEditableSidebar();
    window.TaejangRoleNavigationPriority?.reorder?.();
    injectSidebarEditor();
  }

  async function resetSidebarLayout() {
    try {
      await savePersonal({sidebarSectionOrder:[],sidebarMenuOrder:[]});
      state.editingSidebar=false;
      clearEditableSidebar();
      injectSidebarEditor();
    } catch(error) { window.alert(app()?.friendlyError?.(error)||'기본 메뉴 순서를 복원하지 못했습니다.'); }
  }

  function startSidebarLayout() {
    state.sidebarSnapshot={sectionOrder:state.sidebarSectionOrder.slice(),menuOrder:state.sidebarMenuOrder.slice()};
    state.editingSidebar=true;
    decorateEditableSidebar();
    injectSidebarEditor();
  }

  function injectSidebarEditor() {
    const nav=sidebarNav();
    const wrap=sidebarEditorActions();
    if(!nav || !wrap) return;
    bindSidebarDropTargets();
    wrap.replaceChildren();
    if(state.editingSidebar) {
      wrap.append(button('저장',saveSidebarLayout),button('취소',cancelSidebarLayout,true),button('기본값',resetSidebarLayout,true));
      decorateEditableSidebar();
    } else {
      wrap.append(button('메뉴 편집',startSidebarLayout,true));
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
      personal.append(
        text('h3','내 화면 옵션'),
        text('p','사이드바의 “메뉴 편집”에서 메뉴 순서를 바꿀 수 있고, 운영총괄은 “대시보드 편집”에서 카드 추가·제거·순서 변경을 할 수 있습니다. 메뉴 표시 설정은 아래 직책·역할별 관리에만 사용합니다.','help')
      );
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
      state.collapsedSections=new Set(cleanArray(result?.collapsed_sections));
      state.dashboardOrder=dashboardOrder(result?.dashboard_order);
      state.dashboardCustomized=dashboardCustomized(result?.dashboard_order);
      state.sidebarSectionOrder=uniqueArray(result?.sidebar_section_order);
      state.sidebarMenuOrder=uniqueArray(result?.sidebar_menu_order);
    } catch {
      state.collapsedSections=new Set();
      state.dashboardOrder=[];
      state.dashboardCustomized=false;
      state.sidebarSectionOrder=[];
      state.sidebarMenuOrder=[];
    }
    applySectionCollapse();
    applyDashboardOrder();
    injectDashboardEditor();
    window.TaejangRoleNavigationPriority?.reorder?.();
    injectSidebarEditor();
  }

  function observeNavigation() {
    const nav=el('app-nav');
    if(!nav || nav.dataset.uiPreferenceObserver==='1') return;
    nav.dataset.uiPreferenceObserver='1';
    new MutationObserver(()=>queueMicrotask(()=>{
      applyRoleVisibility();
      applySectionCollapse();
      if(!state.editingSidebar) injectSidebarEditor();
    })).observe(nav,{childList:true,subtree:false});
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
    applyRoleVisibility();
    applySectionCollapse();
    injectSidebarEditor();
  }

  document.addEventListener('taejang-open-platform-settings',renderSettings);
  document.addEventListener('taejang-app-ready',()=>queueMicrotask(refresh));
  document.addEventListener('taejang-capabilities-ready',()=>queueMicrotask(refresh));
  document.addEventListener('taejang-dashboard-refresh',()=>setTimeout(()=>{applyDashboardOrder();injectDashboardEditor();},80));

  window.TaejangPlatformUiSettings={
    refresh,
    renderSettings,
    getDashboardOrder:()=>state.dashboardOrder.slice(),
    isDashboardCustomized:()=>state.dashboardCustomized,
    normalizeDashboardKey,
    getSidebarPreference:()=>sidebarPreference(),
    isDashboardEditing:()=>state.editingDashboard,
    applyRoleVisibility,
    applySectionCollapse,
    toggleSection
  };
})();
