(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const arr = value => Array.isArray(value) ? value : [];
  const PAGE_LABELS = {
    home: '메인', about: '태장 소개', business: '하는 일', workplace: '우리의 일터',
    archive: '소식·기록', activities: '활동', partnership: '협력·문의', greeting: '대표 인사말',
    why_minhwa: '왜 민화인가', location: '오시는 길', community_esg: '지역사회공헌·ESG', resources: '자료 안내'
  };

  let cachedConfig = null;
  let navSyncQueued = false;

  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined && value !== null) node.textContent = value;
    if (className) node.className = className;
    return node;
  };

  const button = (label, handler, quiet = false) => {
    const node = el('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  function friendly(error, fallback = '처리하지 못했습니다.') {
    return app()?.friendlyError?.(error) || error?.message || fallback;
  }

  function closeSidebar() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function setPageTitle(value) {
    const title = document.getElementById('desktop-page-title');
    if (title) title.textContent = value;
  }

  function showLoading(copy) {
    const target = main();
    if (!target) return null;
    target.replaceChildren(el('p', copy, 'message'));
    return target;
  }

  function promptReason(copy, defaultValue = '') {
    const value = window.prompt(copy, defaultValue);
    return value === null ? null : value.trim();
  }

  function injectStyles() {
    if (document.querySelector('style[data-issue-146-end-to-end]')) return;
    const style = document.createElement('style');
    style.dataset.issue146EndToEnd = '1';
    style.textContent = `
      .issue146-shell{display:grid;gap:20px}.issue146-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .issue146-card{display:grid;gap:10px;padding:16px;border:1px solid var(--app-border);border-radius:14px;background:#fff}
      .issue146-card h3,.issue146-card p{margin:0}.issue146-muted{color:var(--app-muted);font-size:.92rem}
      .issue146-section{display:grid;gap:14px}.issue146-form{display:grid;gap:12px;padding:18px;border:1px solid var(--app-border);border-radius:14px;background:#fff}
      .issue146-form label{display:grid;gap:6px;font-weight:800}.issue146-form input,.issue146-form select,.issue146-form textarea{width:100%;min-height:44px;padding:9px 10px;border:1px solid var(--app-border);border-radius:9px;background:#fff;font:inherit}
      .issue146-form textarea{min-height:150px;resize:vertical}.issue146-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .issue146-preview{width:100%;height:560px;border:1px solid var(--app-border);border-radius:12px;background:#fff}.issue146-preview.mobile{width:390px;max-width:100%;margin-inline:auto;height:680px}
      .issue146-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}.issue146-compare>div{padding:14px;border:1px solid var(--app-border);border-radius:12px;background:#fafcfb;white-space:pre-wrap}
      .issue146-checkboxes{display:flex;flex-wrap:wrap;gap:8px}.issue146-checkboxes label{display:flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid var(--app-border);border-radius:8px;font-weight:700}.issue146-checkboxes input{width:auto;min-height:0}
      .issue146-badge{display:inline-flex;width:fit-content;padding:4px 8px;border-radius:999px;background:#eef4ef;color:#315a3f;font-size:.8rem;font-weight:800}
      @media(max-width:760px){.issue146-grid,.issue146-row,.issue146-compare{grid-template-columns:1fr}.issue146-preview{height:460px}}
    `;
    document.head.append(style);
  }

  // -------------------------------------------------------------------------
  // Global Employee registration: add a true "unassigned" option without
  // replacing the existing employee-management module.
  // -------------------------------------------------------------------------
  function labelControl(form, labelText) {
    return [...form.querySelectorAll('label')].find(label => label.querySelector(':scope > span')?.textContent.trim() === labelText)?.querySelector('input,select,textarea') || null;
  }

  function enhanceEmployeeForms(root = document) {
    root.querySelectorAll?.('.employee-form').forEach(form => {
      const submit = form.querySelector('button[type="submit"]');
      if (!submit || submit.textContent.trim() !== '직원 등록') return;
      if (!['operations_manager', 'promotion_lead'].includes(route())) return;
      const department = labelControl(form, '부서');
      if (!department || department.querySelector('option[value="__unassigned__"]')) return;
      const option = document.createElement('option');
      option.value = '__unassigned__';
      option.textContent = '미배정 · 부서 추후 지정';
      department.prepend(option);
      const help = el('small', '입사 시 부서가 확정되지 않았다면 “미배정”으로 등록할 수 있습니다.', 'field-help');
      department.closest('label')?.append(help);
    });
  }

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains('employee-form')) return;
    const submit = form.querySelector('button[type="submit"]');
    if (!submit || submit.textContent.trim() !== '직원 등록') return;
    const department = labelControl(form, '부서');
    if (!department || department.value !== '__unassigned__') return;
    if (!['operations_manager', 'promotion_lead'].includes(route())) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    submit.disabled = true;
    try {
      const name = labelControl(form, '이름');
      const hired = labelControl(form, '입사일');
      const position = labelControl(form, '직책');
      const attendance = labelControl(form, '근태 대상');
      await app().rpc('create_employee', {
        p_full_name: name?.value?.trim() || '',
        p_hired_on: hired?.value || null,
        p_department_id: null,
        p_position_id: position?.value || null,
        p_attendance_required: !!attendance?.checked
      });
      await window.TaejangEmployeeManagement?.openEmployeeManagement?.('existing');
    } catch (error) {
      window.alert(friendly(error, '미배정 직원을 등록하지 못했습니다.'));
      submit.disabled = false;
    }
  }, true);

  // -------------------------------------------------------------------------
  // Promotion unpublished archive and operations restore.
  // -------------------------------------------------------------------------
  async function openPromotionArchive() {
    closeSidebar();
    const currentRoute = route();
    if (!['promotion_lead', 'operations_manager'].includes(currentRoute)) return;
    setPageTitle(currentRoute === 'operations_manager' ? '홍보글 보관·복구' : '홍보글 보관');
    const target = showLoading('홍보글 보관 목록을 불러오고 있습니다.');
    if (!target) return;

    try {
      const [candidates, archived] = await Promise.all([
        app().rpc('get_unpublished_promotion_archive_candidates'),
        currentRoute === 'operations_manager' ? app().rpc('get_promotion_archive_admin') : Promise.resolve([])
      ]);
      const shell = el('section', null, 'issue146-shell');
      const intro = el('header', null, 'dashboard-intro');
      intro.append(
        el('p', '홍보 콘텐츠 안전관리', 'eyebrow'),
        el('h2', currentRoute === 'operations_manager' ? '보관하고 다시 복구할 수 있습니다' : '공개 전 글은 보관할 수 있습니다'),
        el('p', currentRoute === 'operations_manager'
          ? '사용자에게는 삭제처럼 보이지만 원문·수정이력·감사기록은 남고 필요하면 복구할 수 있습니다.'
          : '아직 한 번도 공개되지 않은 글만 보관할 수 있습니다. 공개된 글은 “홍보글 관리”에서 숨김 또는 삭제 요청을 사용합니다.')
      );
      shell.append(intro);

      const pendingSection = el('section', null, 'issue146-section');
      pendingSection.append(el('h2', `공개 전 글 · ${arr(candidates).length}건`));
      const pendingGrid = el('div', null, 'issue146-grid');
      if (!arr(candidates).length) pendingGrid.append(el('p', '현재 보관할 공개 전 글이 없습니다.', 'message'));
      arr(candidates).forEach(item => {
        const card = el('article', null, 'issue146-card');
        card.append(el('span', item.lifecycle || '미발행', 'issue146-badge'), el('h3', item.title || '제목 없음'));
        card.append(el('p', `${item.owner_name || '작성자 미확인'} · ${item.content_type || '홍보글'}`, 'issue146-muted'));
        const actions = el('div', null, 'quick-links');
        actions.append(button('보관', async () => {
          const reason = promptReason('보관 사유를 입력해 주세요.');
          if (!reason) return;
          if (!window.confirm('공개 전 글을 보관하시겠습니까? 원문과 이력은 남습니다.')) return;
          try {
            await app().rpc('archive_unpublished_promotion_content', { p_content_id: item.content_id, p_reason: reason });
            await openPromotionArchive();
          } catch (error) { window.alert(friendly(error, '홍보글을 보관하지 못했습니다.')); }
        }));
        card.append(actions);
        pendingGrid.append(card);
      });
      pendingSection.append(pendingGrid);
      shell.append(pendingSection);

      if (currentRoute === 'operations_manager') {
        const archiveSection = el('section', null, 'issue146-section');
        archiveSection.append(el('h2', `보관된 홍보글 · ${arr(archived).length}건`));
        const archiveGrid = el('div', null, 'issue146-grid');
        if (!arr(archived).length) archiveGrid.append(el('p', '보관된 홍보글이 없습니다.', 'message'));
        arr(archived).forEach(item => {
          const card = el('article', null, 'issue146-card');
          card.append(el('span', item.archive_kind === 'published' ? '공개 이력 있음' : '미발행', 'issue146-badge'), el('h3', item.title || '제목 없음'));
          card.append(el('p', `복구 시 이전 상태: ${item.previous_lifecycle || '확인 필요'}`, 'issue146-muted'));
          card.append(button('복구', async () => {
            const reason = promptReason('복구 사유를 입력해 주세요.');
            if (!reason) return;
            try {
              await app().rpc('restore_promotion_content', { p_content_id: item.content_id, p_reason: reason });
              await openPromotionArchive();
            } catch (error) { window.alert(friendly(error, '홍보글을 복구하지 못했습니다.')); }
          }));
          archiveGrid.append(card);
        });
        archiveSection.append(archiveGrid);
        shell.append(archiveSection);
      }
      target.replaceChildren(shell);
    } catch (error) {
      target.replaceChildren(el('p', friendly(error, '홍보글 보관 목록을 불러오지 못했습니다.'), 'message error'));
    }
  }

  // -------------------------------------------------------------------------
  // Operations-manager recoveries and account <-> Employee administration.
  // -------------------------------------------------------------------------
  async function openOperationsSafety() {
    closeSidebar();
    if (route() !== 'operations_manager') return;
    setPageTitle('복구·계정 관리');
    const target = showLoading('복구 및 계정 정보를 불러오고 있습니다.');
    if (!target) return;

    try {
      const [archivedEmployees, accountData] = await Promise.all([
        app().rpc('get_archived_employee_management'),
        app().rpc('get_operations_account_management')
      ]);
      const shell = el('section', null, 'issue146-shell');
      const intro = el('header', null, 'dashboard-intro');
      intro.append(
        el('p', '운영총괄', 'eyebrow'),
        el('h2', '복구·계정 관리'),
        el('p', '직원 삭제 복구, 계정 연결·해제, 상태·소속·직책·일반 운영 역할을 관리합니다. 기술 최고관리자 역할은 별도 안전영역으로 유지합니다.')
      );
      shell.append(intro);

      const recovery = el('section', null, 'issue146-section');
      recovery.append(el('h2', `삭제 보관된 직원 · ${arr(archivedEmployees).length}명`));
      const recoveryGrid = el('div', null, 'issue146-grid');
      if (!arr(archivedEmployees).length) recoveryGrid.append(el('p', '현재 복구할 직원이 없습니다.', 'message'));
      arr(archivedEmployees).forEach(employee => {
        const card = el('article', null, 'issue146-card');
        card.append(el('span', employee.employee_id, 'issue146-badge'), el('h3', employee.full_name));
        card.append(el('p', `${employee.department_name || '미배정'} · ${employee.position_name || ''}`, 'issue146-muted'));
        if (employee.archive_reason) card.append(el('p', `삭제 사유: ${employee.archive_reason}`));
        card.append(button('직원 복구', async () => {
          const reason = promptReason('복구 사유를 입력해 주세요.');
          if (!reason) return;
          if (!window.confirm(`${employee.full_name} 직원을 복구하시겠습니까?`)) return;
          try {
            await app().rpc('restore_employee', { p_employee_uuid: employee.id, p_reason: reason });
            await openOperationsSafety();
          } catch (error) { window.alert(friendly(error, '직원을 복구하지 못했습니다.')); }
        }));
        recoveryGrid.append(card);
      });
      recovery.append(recoveryGrid);
      shell.append(recovery);

      const profiles = arr(accountData?.profiles);
      const employees = arr(accountData?.employees);
      const departments = arr(accountData?.departments);
      const positions = arr(accountData?.positions);
      const roleOptions = arr(accountData?.roles).filter(roleItem => !roleItem.technical);
      const unlinkedProfiles = profiles.filter(profile => !profile.linked_employee_uuid && ['pending', 'active', 'suspended'].includes(profile.account_status));

      const linksSection = el('section', null, 'issue146-section');
      linksSection.append(el('h2', '직원 ↔ 로그인 계정 연결'));
      const linkGrid = el('div', null, 'issue146-grid');
      employees.filter(employee => !employee.archived).forEach(employee => {
        const card = el('article', null, 'issue146-card');
        card.append(el('span', employee.employee_id, 'issue146-badge'), el('h3', employee.full_name));
        card.append(el('p', `${employee.department_name || '미배정'} · ${employee.position_name || ''}`, 'issue146-muted'));
        if (employee.linked_profile_id) {
          const linked = profiles.find(profile => profile.id === employee.linked_profile_id);
          card.append(el('p', `연결 계정: ${linked?.display_name || linked?.work_email || employee.linked_profile_id}`));
          card.append(button('계정 연결 해제', async () => {
            const reason = promptReason('연결 해제 사유를 입력해 주세요.');
            if (!reason) return;
            try {
              await app().rpc('unlink_employee_account', { p_employee_uuid: employee.id, p_reason: reason });
              await openOperationsSafety();
            } catch (error) { window.alert(friendly(error, '계정 연결을 해제하지 못했습니다.')); }
          }, true));
        } else {
          const select = document.createElement('select');
          const empty = document.createElement('option'); empty.value = ''; empty.textContent = '연결할 계정 선택'; select.append(empty);
          unlinkedProfiles.forEach(profile => {
            const option = document.createElement('option'); option.value = profile.id;
            option.textContent = `${profile.display_name || '이름 없음'}${profile.work_email ? ` · ${profile.work_email}` : ''} · ${profile.account_status}`;
            select.append(option);
          });
          card.append(select, button('이 계정과 연결', async () => {
            if (!select.value) { window.alert('연결할 계정을 선택해 주세요.'); return; }
            const reason = promptReason('계정 연결 사유를 입력해 주세요.', '직원 계정 연결');
            if (!reason) return;
            try {
              await app().rpc('link_employee_account', { p_employee_uuid: employee.id, p_profile_id: select.value, p_reason: reason });
              await openOperationsSafety();
            } catch (error) { window.alert(friendly(error, '계정을 연결하지 못했습니다.')); }
          }));
        }
        linkGrid.append(card);
      });
      linksSection.append(linkGrid);
      shell.append(linksSection);

      const accounts = el('section', null, 'issue146-section');
      accounts.append(el('h2', '계정 상태·소속·직책·운영 역할'));
      const accountGrid = el('div', null, 'issue146-grid');
      profiles.forEach(profile => {
        const card = el('article', null, 'issue146-card');
        card.append(el('span', profile.account_status, 'issue146-badge'), el('h3', profile.display_name || '이름 없음'));
        if (profile.work_email) card.append(el('p', profile.work_email, 'issue146-muted'));

        const status = document.createElement('select');
        ['active', 'suspended', 'departed', 'deleted'].forEach(value => {
          const option = document.createElement('option'); option.value = value; option.textContent = ({ active: '활성', suspended: '정지', departed: '퇴사', deleted: '삭제' })[value]; option.selected = profile.account_status === value; status.append(option);
        });
        if (profile.account_status === 'pending') {
          status.disabled = true;
          const option = document.createElement('option'); option.value = 'pending'; option.textContent = '가입 승인 대기'; option.selected = true; status.prepend(option);
        }

        const department = document.createElement('select');
        const unassigned = document.createElement('option'); unassigned.value = ''; unassigned.textContent = '미배정'; department.append(unassigned);
        departments.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = item.id === profile.department_id; department.append(option); });
        const position = document.createElement('select');
        positions.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = item.id === profile.position_id; position.append(option); });

        const roles = el('div', null, 'issue146-checkboxes');
        roleOptions.forEach(roleItem => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = roleItem.code; checkbox.checked = arr(profile.roles).includes(roleItem.code);
          label.append(checkbox, document.createTextNode(roleItem.name || roleItem.code)); roles.append(label);
        });
        const technicalRoles = arr(profile.roles).filter(code => code === 'super_admin');
        if (technicalRoles.length) card.append(el('p', '기술 최고관리자 역할은 이 화면에서 변경하지 않습니다.', 'issue146-muted'));

        const actions = el('div', null, 'quick-links');
        if (profile.account_status !== 'pending') actions.append(button('계정 상태 저장', async () => {
          const reason = promptReason('계정 상태 변경 사유를 입력해 주세요.'); if (!reason) return;
          try { await app().rpc('change_account_status', { p_target_profile_id: profile.id, p_new_status: status.value, p_reason_summary: reason }); await openOperationsSafety(); }
          catch (error) { window.alert(friendly(error, '계정 상태를 변경하지 못했습니다.')); }
        }, true));
        actions.append(button('소속·직책 저장', async () => {
          const reason = promptReason('소속·직책 변경 사유를 입력해 주세요.'); if (!reason) return;
          try { await app().rpc('assign_profile_organization', { p_target_profile_id: profile.id, p_department_id: department.value || null, p_position_id: position.value || null, p_reason_summary: reason }); await openOperationsSafety(); }
          catch (error) { window.alert(friendly(error, '소속·직책을 변경하지 못했습니다.')); }
        }, true));
        actions.append(button('운영 역할 저장', async () => {
          const reason = promptReason('역할 변경 사유를 입력해 주세요.'); if (!reason) return;
          const selected = [...roles.querySelectorAll('input:checked')].map(node => node.value);
          try { await app().rpc('set_profile_roles', { p_target_profile_id: profile.id, p_role_codes: selected, p_reason_summary: reason }); await openOperationsSafety(); }
          catch (error) { window.alert(friendly(error, '역할을 변경하지 못했습니다.')); }
        }));
        card.append(el('p', '계정 상태', 'issue146-muted'), status, el('p', '부서 · 직책', 'issue146-muted'), department, position, el('p', '일반 운영 역할', 'issue146-muted'), roles, actions);
        accountGrid.append(card);
      });
      accounts.append(accountGrid);
      shell.append(accounts);
      target.replaceChildren(shell);
    } catch (error) {
      target.replaceChildren(el('p', friendly(error, '복구·계정 정보를 불러오지 못했습니다.'), 'message error'));
    }
  }

  // -------------------------------------------------------------------------
  // Canonical safe homepage slot workflow.
  // -------------------------------------------------------------------------
  function session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); }
    catch { return {}; }
  }

  async function config() {
    if (cachedConfig) return cachedConfig;
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('사진 저장 설정을 불러오지 못했습니다.');
    cachedConfig = await response.json();
    return cachedConfig;
  }

  function jwtSubject(token) {
    try {
      const part = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
      const padded = part.padEnd(Math.ceil(part.length / 4) * 4, '=');
      return JSON.parse(atob(padded)).sub || null;
    } catch { return null; }
  }

  async function uploadHomepageImage(file) {
    if (!file) throw new Error('사진을 선택해 주세요.');
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!allowed.has(file.type)) throw new Error('JPG, PNG, WEBP, GIF 사진만 올릴 수 있습니다.');
    if (file.size > 8 * 1024 * 1024) throw new Error('사진은 8MB 이하로 올려주세요.');
    const auth = session();
    const userId = jwtSubject(auth.access_token || '');
    if (!auth.access_token || !userId) throw new Error('로그인 정보를 다시 확인해 주세요.');
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type];
    const path = `${userId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const cfg = await config();
    const response = await fetch(`${cfg.url}/storage/v1/object/promotion-media/${encodedPath}`, {
      method: 'POST',
      headers: { apikey: cfg.publishableKey, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': file.type, 'x-upsert': 'false' },
      body: file
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || payload?.error || '사진을 업로드하지 못했습니다.');
    }
    return `${cfg.url}/storage/v1/object/public/promotion-media/${encodedPath}`;
  }

  function previewSetText(target, value) {
    target.replaceChildren();
    String(value || '').split(/\r?\n/).forEach((part, index) => {
      if (index) target.append(document.createElement('br'));
      target.append(document.createTextNode(part));
    });
  }

  async function openHomepageSlots(selectedSlotKey = null) {
    closeSidebar();
    const currentRoute = route();
    if (!['promotion_lead', 'operations_manager'].includes(currentRoute)) return;
    setPageTitle('홈페이지 내용 관리');
    const target = showLoading('홈페이지 안전 편집 항목을 불러오고 있습니다.');
    if (!target) return;

    try {
      const [slots, requests] = await Promise.all([
        app().rpc('get_homepage_content_slots'),
        app().rpc('get_homepage_change_requests')
      ]);
      const slotList = arr(slots);
      const shell = el('section', null, 'issue146-shell');
      const intro = el('header', null, 'dashboard-intro');
      intro.append(
        el('p', '공개 홈페이지 안전 편집', 'eyebrow'),
        el('h2', '현재 공개본과 비교한 뒤 수정합니다'),
        el('p', currentRoute === 'operations_manager'
          ? '운영팀장 요청을 승인하면 즉시 공개 슬롯에 반영됩니다. 운영총괄은 필요할 때 같은 안전 슬롯을 직접 수정할 수도 있습니다.'
          : '기존 페이지의 개발자가 지정한 글·사진만 수정할 수 있습니다. 메뉴·레이아웃·HTML·CSS·스크립트는 수정할 수 없습니다.')
      );
      shell.append(intro);

      const form = el('section', null, 'issue146-form');
      form.append(el('h2', '수정 초안'));
      const pageSelect = document.createElement('select');
      const pageKeys = [...new Set(slotList.map(slot => slot.page_key))];
      pageKeys.forEach(key => { const option = document.createElement('option'); option.value = key; option.textContent = `${PAGE_LABELS[key] || key}${key === 'resources' ? ' · noindex' : ''}`; pageSelect.append(option); });
      const slotSelect = document.createElement('select');
      const currentBox = el('div', '현재 공개 내용을 읽는 중입니다.', 'issue146-card');
      const proposedBox = el('div', '수정 초안을 입력하면 여기에 표시됩니다.', 'issue146-card');
      const compare = el('div', null, 'issue146-compare');
      const currentWrap = el('div'); currentWrap.append(el('strong', '변경 전'), currentBox);
      const proposedWrap = el('div'); proposedWrap.append(el('strong', '변경 후'), proposedBox);
      compare.append(currentWrap, proposedWrap);
      const textArea = document.createElement('textarea'); textArea.rows = 7;
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp,image/gif';
      const imageAlt = document.createElement('input'); imageAlt.type = 'text'; imageAlt.maxLength = 300; imageAlt.placeholder = '사진을 설명하는 대체텍스트';
      const imageStatus = el('p', '', 'issue146-muted');
      const reason = document.createElement('textarea'); reason.rows = 3; reason.maxLength = 1000; reason.placeholder = '수정 이유';
      const preview = document.createElement('iframe'); preview.className = 'issue146-preview'; preview.title = '홈페이지 수정 미리보기';
      const previewActions = el('div', null, 'quick-links');
      let uploadedImageUrl = null;
      let currentValue = '';
      let currentImageAlt = '';
      let activeSlot = null;
      let previewOriginal = null;
      let draftMode = true;

      const slotsForPage = () => slotList.filter(slot => slot.page_key === pageSelect.value);
      const refreshSlotSelect = () => {
        slotSelect.replaceChildren();
        slotsForPage().forEach(slot => {
          const option = document.createElement('option'); option.value = slot.slot_key; option.textContent = slot.label; slotSelect.append(option);
        });
        if (selectedSlotKey && slotsForPage().some(slot => slot.slot_key === selectedSlotKey)) slotSelect.value = selectedSlotKey;
        refreshActiveSlot();
      };
      const applyDraftToFrame = () => {
        if (!activeSlot || !preview.contentDocument) return;
        let node;
        try { node = preview.contentDocument.querySelector(activeSlot.selector); } catch { return; }
        if (!node) return;
        if (!draftMode) {
          if (activeSlot.slot_kind === 'text') previewSetText(node, currentValue);
          else if (node instanceof preview.contentWindow.HTMLImageElement && previewOriginal) { node.src = previewOriginal.src; node.alt = previewOriginal.alt; }
          return;
        }
        if (activeSlot.slot_kind === 'text') previewSetText(node, textArea.value || currentValue);
        else if (node instanceof preview.contentWindow.HTMLImageElement && uploadedImageUrl) { node.src = uploadedImageUrl; node.alt = imageAlt.value || currentImageAlt; }
      };
      const readCurrentFromFrame = () => {
        if (!activeSlot || !preview.contentDocument) return;
        let node;
        try { node = preview.contentDocument.querySelector(activeSlot.selector); } catch { node = null; }
        if (!node) {
          currentValue = '';
          currentBox.textContent = '대상 요소를 찾지 못했습니다. 이 항목은 개발 검수가 필요합니다.';
          return;
        }
        if (activeSlot.slot_kind === 'text') {
          currentValue = (node.innerText || node.textContent || '').trim();
          textArea.value = currentValue;
          currentBox.textContent = currentValue || '(빈 문구)';
          proposedBox.textContent = textArea.value || '(빈 문구)';
        } else {
          currentValue = node.getAttribute('src') || '';
          currentImageAlt = node.getAttribute('alt') || '';
          previewOriginal = { src: currentValue, alt: currentImageAlt };
          currentBox.textContent = `${currentValue}\n대체텍스트: ${currentImageAlt || '(없음)'}`;
          proposedBox.textContent = uploadedImageUrl ? `${uploadedImageUrl}\n대체텍스트: ${imageAlt.value}` : '새 사진을 선택해 주세요.';
        }
      };
      const refreshActiveSlot = () => {
        activeSlot = slotList.find(slot => slot.slot_key === slotSelect.value) || slotsForPage()[0] || null;
        if (!activeSlot) return;
        textArea.hidden = activeSlot.slot_kind !== 'text';
        file.hidden = activeSlot.slot_kind !== 'image';
        imageAlt.hidden = activeSlot.slot_kind !== 'image';
        imageStatus.hidden = activeSlot.slot_kind !== 'image';
        uploadedImageUrl = null;
        imageStatus.textContent = '';
        preview.src = `../${activeSlot.public_path}`;
      };

      pageSelect.addEventListener('change', () => { selectedSlotKey = null; refreshSlotSelect(); });
      slotSelect.addEventListener('change', refreshActiveSlot);
      textArea.addEventListener('input', () => { proposedBox.textContent = textArea.value || '(빈 문구)'; draftMode = true; applyDraftToFrame(); });
      imageAlt.addEventListener('input', () => { if (uploadedImageUrl) { proposedBox.textContent = `${uploadedImageUrl}\n대체텍스트: ${imageAlt.value}`; draftMode = true; applyDraftToFrame(); } });
      file.addEventListener('change', async () => {
        const selected = file.files?.[0]; if (!selected) return;
        imageStatus.textContent = '사진 업로드 중'; file.disabled = true;
        try {
          uploadedImageUrl = await uploadHomepageImage(selected);
          imageAlt.value = selected.name.replace(/\.[^.]+$/, '');
          imageStatus.textContent = '사진 업로드 완료';
          proposedBox.textContent = `${uploadedImageUrl}\n대체텍스트: ${imageAlt.value}`;
          draftMode = true; applyDraftToFrame();
        } catch (error) { uploadedImageUrl = null; imageStatus.textContent = friendly(error, '사진 업로드 실패'); }
        finally { file.disabled = false; }
      });
      preview.addEventListener('load', () => setTimeout(() => { readCurrentFromFrame(); applyDraftToFrame(); }, 350));
      previewActions.append(
        button('PC Preview', () => preview.classList.remove('mobile'), true),
        button('Mobile Preview', () => preview.classList.add('mobile'), true),
        button('현재 공개본 보기', () => { draftMode = false; applyDraftToFrame(); }, true),
        button('수정 초안 보기', () => { draftMode = true; applyDraftToFrame(); }, true)
      );

      const row = el('div', null, 'issue146-row');
      const pageLabel = document.createElement('label'); pageLabel.append(el('span', '페이지'), pageSelect);
      const slotLabel = document.createElement('label'); slotLabel.append(el('span', '수정 항목'), slotSelect);
      row.append(pageLabel, slotLabel);
      form.append(row, previewActions, preview, compare, textArea, file, imageAlt, imageStatus, reason);
      const formActions = el('div', null, 'quick-links');
      formActions.append(button(currentRoute === 'operations_manager' ? '승인 요청으로 저장' : '운영총괄에게 상신', async () => {
        if (!activeSlot) return;
        if (!reason.value.trim()) { window.alert('수정 이유를 적어주세요.'); return; }
        if (activeSlot.slot_kind === 'text' && !textArea.value.trim()) { window.alert('새 문구를 입력해 주세요.'); return; }
        if (activeSlot.slot_kind === 'image' && (!uploadedImageUrl || !imageAlt.value.trim())) { window.alert('새 사진과 사진 설명을 준비해 주세요.'); return; }
        try {
          await app().rpc('create_homepage_slot_change_request', {
            p_slot_key: activeSlot.slot_key,
            p_current_summary: currentValue || null,
            p_proposed_text: activeSlot.slot_kind === 'text' ? textArea.value.trim() : null,
            p_proposed_image_url: activeSlot.slot_kind === 'image' ? uploadedImageUrl : null,
            p_image_alt: activeSlot.slot_kind === 'image' ? imageAlt.value.trim() : null,
            p_reason: reason.value.trim()
          });
          await openHomepageSlots(activeSlot.slot_key);
        } catch (error) { window.alert(friendly(error, '홈페이지 수정 요청을 저장하지 못했습니다.')); }
      }));
      if (currentRoute === 'operations_manager') formActions.append(button('운영총괄 직접 반영', async () => {
        if (!activeSlot) return;
        const directReason = reason.value.trim() || promptReason('직접 반영 사유를 입력해 주세요.');
        if (!directReason) return;
        if (!window.confirm('승인 요청 없이 이 안전 슬롯에 직접 반영하시겠습니까?')) return;
        try {
          await app().rpc('save_homepage_slot_override', {
            p_slot_key: activeSlot.slot_key,
            p_text_value: activeSlot.slot_kind === 'text' ? textArea.value.trim() : null,
            p_image_url: activeSlot.slot_kind === 'image' ? uploadedImageUrl : null,
            p_image_alt: activeSlot.slot_kind === 'image' ? imageAlt.value.trim() : null,
            p_reason: directReason
          });
          await openHomepageSlots(activeSlot.slot_key);
        } catch (error) { window.alert(friendly(error, '홈페이지에 직접 반영하지 못했습니다.')); }
      }));
      form.append(formActions);
      shell.append(form);

      const requestsSection = el('section', null, 'issue146-section');
      requestsSection.append(el('h2', `수정 요청 · ${arr(requests).length}건`));
      const requestGrid = el('div', null, 'issue146-grid');
      if (!arr(requests).length) requestGrid.append(el('p', '현재 수정 요청이 없습니다.', 'message'));
      arr(requests).forEach(request => {
        const card = el('article', null, 'issue146-card');
        card.append(el('span', request.status, 'issue146-badge'), el('h3', request.slot_label || `${request.page_key} · ${request.section_key}`));
        if (request.current_summary) card.append(el('p', `변경 전: ${request.current_summary}`));
        if (request.proposed_text) card.append(el('p', `변경 후: ${request.proposed_text}`));
        if (request.reason) card.append(el('p', `사유: ${request.reason}`, 'issue146-muted'));
        if (request.applied_at) card.append(el('p', `공개 반영: ${new Date(request.applied_at).toLocaleString('ko-KR')}`, 'issue146-muted'));
        const actions = el('div', null, 'quick-links');
        if (request.public_path) {
          const link = document.createElement('a'); link.href = `../${request.public_path}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'button button-quiet'; link.textContent = '현재 공개 페이지'; actions.append(link);
        }
        if (currentRoute === 'operations_manager' && request.status === 'pending') {
          actions.append(button('승인하고 공개 반영', async () => {
            if (!window.confirm('승인과 동시에 공개 홈페이지 슬롯에 반영됩니다. 진행하시겠습니까?')) return;
            try { await app().rpc('review_homepage_change_request', { p_request_id: request.id, p_action: 'approve', p_comment: null }); await openHomepageSlots(request.slot_key); }
            catch (error) { window.alert(friendly(error, '승인하지 못했습니다.')); }
          }));
          actions.append(button('보완 요청', async () => {
            const comment = promptReason('보완할 내용을 적어주세요.'); if (!comment) return;
            try { await app().rpc('review_homepage_change_request', { p_request_id: request.id, p_action: 'changes_requested', p_comment: comment }); await openHomepageSlots(request.slot_key); }
            catch (error) { window.alert(friendly(error, '보완 요청을 저장하지 못했습니다.')); }
          }, true));
          actions.append(button('반려', async () => {
            const comment = promptReason('반려 이유를 적어주세요.'); if (!comment) return;
            try { await app().rpc('review_homepage_change_request', { p_request_id: request.id, p_action: 'reject', p_comment: comment }); await openHomepageSlots(request.slot_key); }
            catch (error) { window.alert(friendly(error, '반려하지 못했습니다.')); }
          }, true));
        }
        card.append(actions); requestGrid.append(card);
      });
      requestsSection.append(requestGrid); shell.append(requestsSection);
      target.replaceChildren(shell);

      if (selectedSlotKey) {
        const selected = slotList.find(slot => slot.slot_key === selectedSlotKey);
        if (selected) pageSelect.value = selected.page_key;
      }
      refreshSlotSelect();
    } catch (error) {
      target.replaceChildren(el('p', friendly(error, '홈페이지 편집 정보를 불러오지 못했습니다.'), 'message error'));
    }
  }

  // -------------------------------------------------------------------------
  // Navigation integration. Replacing existing nodes removes old event handlers
  // without modifying the large legacy modules.
  // -------------------------------------------------------------------------
  function navButton(label, handler, key) {
    const node = button(label, () => { closeSidebar(); handler(); }, true);
    node.className = '';
    node.dataset.issue146Nav = key;
    return node;
  }

  function replaceHomepageNav(nav) {
    const old = [...nav.querySelectorAll('button')].find(node => node.textContent.trim() === '홈페이지 내용 관리');
    if (!old || old.dataset.issue146Nav === 'homepage') return;
    old.replaceWith(navButton('홈페이지 내용 관리', openHomepageSlots, 'homepage'));
  }

  function syncNavigation() {
    const nav = document.getElementById('app-nav');
    const currentRoute = route();
    if (!nav || !currentRoute) return;
    enhanceEmployeeForms(document);

    if (['promotion_lead', 'operations_manager'].includes(currentRoute)) {
      replaceHomepageNav(nav);
      if (!nav.querySelector('[data-issue146-nav="promotion-archive"]')) {
        const homepage = nav.querySelector('[data-issue146-nav="homepage"]');
        const node = navButton(currentRoute === 'operations_manager' ? '홍보글 보관·복구' : '홍보글 보관', openPromotionArchive, 'promotion-archive');
        if (homepage) nav.insertBefore(node, homepage); else nav.append(node);
      }
    }

    if (currentRoute === 'operations_manager') {
      if (![...nav.querySelectorAll('button')].some(node => node.textContent.trim() === '홍보 작성')) {
        const node = navButton('홍보 작성', () => document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode: 'write' } })), 'promotion-write');
        const review = [...nav.querySelectorAll('button')].find(item => item.textContent.trim() === '홍보 검토');
        if (review?.nextSibling) nav.insertBefore(node, review.nextSibling); else nav.append(node);
      }
      if (!nav.querySelector('[data-issue146-nav="ops-safety"]')) {
        const node = navButton('복구·계정 관리', openOperationsSafety, 'ops-safety');
        const approval = [...nav.querySelectorAll('button')].find(item => item.textContent.trim() === '가입 승인');
        if (approval?.nextSibling) nav.insertBefore(node, approval.nextSibling); else nav.append(node);
      }
    }
  }

  function scheduleNavSync() {
    if (navSyncQueued) return;
    navSyncQueued = true;
    queueMicrotask(() => { navSyncQueued = false; syncNavigation(); });
  }

  injectStyles();
  document.addEventListener('taejang-app-ready', scheduleNavSync);
  document.addEventListener('taejang-dashboard-refresh', scheduleNavSync);
  const observer = new MutationObserver(() => scheduleNavSync());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleNavSync();

  window.TaejangIssue146 = {
    openHomepageSlots,
    openPromotionArchive,
    openOperationsSafety
  };
})();
