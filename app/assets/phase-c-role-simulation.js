(() => {
  'use strict';

  const STORAGE_KEY = 'taejang-role-simulation-v1';
  const QA_FUNCTION = 'qa-account-preview';
  const QA_HANDOFF_KEY = 'taejang-qa-account-handoff-v1';
  const QA_ACCOUNT_CACHE_KEY = 'taejang-persona-account-cache-v1';
  const QA_ACCOUNT_CACHE_TTL_MS = 10 * 60 * 1000;
  const PRESET_ROLES = ['promotion_staff', 'promotion_lead'];
  const LABELS = {
    promotion_staff: '홍보직원',
    promotion_lead: '운영팀장'
  };
  let switching = false;
  let qaAccounts = null;
  let qaLoading = false;
  let preloadPromise = null;

  const app = () => window.TaejangApp;
  const context = () => app()?.getContext?.();
  const simulation = () => context()?.role_simulation || null;

  function installStyles() {
    if (document.querySelector('style[data-role-simulation]')) return;
    const style = document.createElement('style');
    style.dataset.roleSimulation = '1';
    style.textContent = `
      .role-simulation-switcher {
        display: inline-flex;
        align-items: center;
        padding: 4px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: #fff;
      }
      .role-simulation-switcher .button {
        min-height: 38px !important;
        padding: 8px 12px !important;
        font-size: .86rem;
        font-weight: 850;
      }
      .role-simulation-switcher .button[aria-expanded="true"] {
        background: #173f2c;
        color: #fff;
        border-color: #173f2c;
      }
      .role-simulation-banner {
        margin: 0;
        padding: 9px 14px;
        background: #fff3cd;
        border-bottom: 1px solid #e5cc79;
        color: #4b3b00;
        font-weight: 750;
        text-align: center;
      }
      .role-simulation-banner strong { color: #7a2f00; }
      .role-simulation-banner .button {
        margin-left: 10px;
        min-height: 34px;
        padding: 5px 9px;
        font-size: .8rem;
      }
      .qa-account-dialog {
        width: min(620px, calc(100vw - 28px));
        border: 0;
        border-radius: 18px;
        padding: 0;
        box-shadow: 0 24px 70px rgba(0,0,0,.24);
      }
      .qa-account-dialog::backdrop { background: rgba(15, 23, 42, .46); }
      .qa-account-dialog__body { padding: 22px; display: grid; gap: 14px; }
      .qa-account-dialog__body h2 { margin: 0; font-size: 1.2rem; }
      .qa-account-dialog__body p { margin: 0; color: #52605a; line-height: 1.55; }
      .qa-account-dialog__body select {
        width: 100%;
        min-height: 48px;
        border: 1px solid var(--app-border);
        border-radius: 10px;
        padding: 8px 10px;
        background: #fff;
      }
      .qa-account-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
      .qa-account-dialog__status { min-height: 1.4em; font-weight: 700; color: #7a2f00 !important; }
      @media (max-width: 900px) {
        .role-simulation-switcher {
          position: fixed;
          left: 12px;
          right: 12px;
          bottom: max(16px, env(safe-area-inset-bottom));
          z-index: 90;
          box-shadow: 0 10px 30px rgba(0,0,0,.2);
        }
        .role-simulation-switcher .button {
          width: 100%;
          min-height: 56px !important;
          font-size: 1rem !important;
        }
        body:has(.role-simulation-switcher) { padding-bottom: 92px; }
      }
    `;
    document.head.append(style);
  }

  function renderBanner(currentSimulation) {
    document.querySelector('[data-role-simulation-banner]')?.remove();
    if (!currentSimulation?.active) return;
    const shell = document.getElementById('desktop-app-shell');
    const workspace = shell?.querySelector('.app-workspace');
    if (!workspace) return;
    const banner = document.createElement('div');
    banner.className = 'role-simulation-banner';
    banner.dataset.roleSimulationBanner = '1';
    const label = LABELS[currentSimulation.role_code] || currentSimulation.role_code;
    banner.append(
      Object.assign(document.createElement('strong'), { textContent: `${label} 역할 미리보기 중` }),
      ' · 실제 직원 계정이 아닌 테스트용 역할 화면입니다.'
    );
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'button button-quiet';
    back.textContent = '내 계정으로 돌아가기';
    back.dataset.personaReturn = '1';
    back.addEventListener('click', () => switchMode(null));
    banner.append(back);
    const topbar = workspace.querySelector('.app-topbar');
    if (topbar?.nextSibling) workspace.insertBefore(banner, topbar.nextSibling);
    else workspace.append(banner);
  }

  async function switchMode(roleCode) {
    if (switching) return;
    switching = true;
    document.querySelectorAll('[data-persona-launcher], [data-persona-return]').forEach(button => { button.disabled = true; });
    try {
      await app().rpc('set_role_simulation_mode', { p_role_code: roleCode });
      if (roleCode) sessionStorage.setItem(STORAGE_KEY, roleCode);
      else sessionStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    } catch (error) {
      switching = false;
      document.querySelectorAll('[data-persona-launcher], [data-persona-return]').forEach(button => { button.disabled = false; });
      window.alert(app()?.friendlyError?.(error) || '직원 화면을 전환하지 못했습니다.');
    }
  }

  function decodeJwtSubject(token) {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
      return JSON.parse(atob(normalized))?.sub || null;
    } catch {
      return null;
    }
  }

  async function qaIdentity() {
    const session = app()?.getSession?.();
    if (!session?.access_token) throw new Error('QA_SESSION_MISSING');
    const accessContext = await window.TaejangCapabilityAccess?.refresh?.() || app()?.getAccessContext?.();
    const contextProfileId = context()?.id || null;
    const accessProfileId = accessContext?.id || null;
    const jwtSubject = decodeJwtSubject(session.access_token);
    if (!contextProfileId || contextProfileId !== accessProfileId || contextProfileId !== jwtSubject) {
      throw new Error('QA_IDENTITY_MISMATCH');
    }
    return { session, contextProfileId, accessProfileId, jwtSubject };
  }

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  async function qaRequest(payload) {
    const [config, identity] = await Promise.all([loadConfig(), qaIdentity()]);
    const response = await fetch(`${config.url}/functions/v1/${QA_FUNCTION}`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${identity.session.access_token}`,
        'X-QA-Context-Profile-ID': identity.contextProfileId,
        'X-QA-Access-Profile-ID': identity.accessProfileId,
        'X-QA-JWT-Subject': identity.jwtSubject,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `QA_PREVIEW_${response.status}`);
    return data;
  }

  function accountLabel(account) {
    const roleNames = (account.roles || []).map(role => role.name || role.code).filter(Boolean);
    const meta = [account.department_name, account.position_name, roleNames.join('·')].filter(Boolean).join(' / ');
    return meta ? `${account.display_name} — ${meta}` : account.display_name;
  }

  function readAccountCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(QA_ACCOUNT_CACHE_KEY) || 'null');
      if (!cached?.saved_at || !Array.isArray(cached.accounts)) return null;
      if (Date.now() - Number(cached.saved_at) > QA_ACCOUNT_CACHE_TTL_MS) {
        sessionStorage.removeItem(QA_ACCOUNT_CACHE_KEY);
        return null;
      }
      return cached.accounts;
    } catch {
      sessionStorage.removeItem(QA_ACCOUNT_CACHE_KEY);
      return null;
    }
  }

  function writeAccountCache(accounts) {
    sessionStorage.setItem(QA_ACCOUNT_CACHE_KEY, JSON.stringify({ saved_at: Date.now(), accounts }));
  }

  async function fetchQaAccounts({ allowCached = true } = {}) {
    if (allowCached) {
      const cached = readAccountCache();
      if (cached) {
        qaAccounts = cached;
        return cached;
      }
    }
    const result = await qaRequest({ action: 'list' });
    qaAccounts = Array.isArray(result.accounts) ? result.accounts : [];
    writeAccountCache(qaAccounts);
    return qaAccounts;
  }

  function preloadQaAccounts() {
    if (simulation()?.active || preloadPromise || readAccountCache()) return;
    preloadPromise = fetchQaAccounts({ allowCached: false })
      .catch(error => console.warn('Employee preview account preload unavailable.', error))
      .finally(() => { preloadPromise = null; });
  }

  function ensurePersonaDialog() {
    let dialog = document.querySelector('[data-qa-account-dialog]');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'qa-account-dialog';
    dialog.dataset.qaAccountDialog = '1';

    const body = document.createElement('div');
    body.className = 'qa-account-dialog__body';
    const heading = document.createElement('h2');
    heading.textContent = '직원 화면 체험';
    const copy = document.createElement('p');
    copy.textContent = '실제 로그인 가능한 직원은 그 직원이 실제로 보는 화면으로 열고, 실제 계정이 없는 역할만 테스트용 역할 미리보기로 보여줍니다.';
    const select = document.createElement('select');
    select.dataset.qaAccountSelect = '1';
    select.dataset.personaSelect = '1';
    select.setAttribute('aria-label', '체험할 직원 또는 역할');
    const status = document.createElement('p');
    status.className = 'qa-account-dialog__status';
    status.dataset.qaAccountStatus = '1';
    const actions = document.createElement('div');
    actions.className = 'qa-account-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button button-quiet';
    cancel.textContent = '닫기';
    cancel.addEventListener('click', () => dialog.close());
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button';
    open.textContent = '이 화면으로 보기';
    open.dataset.qaAccountOpen = '1';
    open.dataset.personaOpen = '1';
    open.addEventListener('click', applyPersonaSelection);
    actions.append(cancel, open);
    body.append(heading, copy, select, status, actions);
    dialog.append(body);
    document.body.append(dialog);
    return dialog;
  }

  function option(value, text, kind, extra = {}) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    node.dataset.personaKind = kind;
    Object.entries(extra).forEach(([key, val]) => { node.dataset[key] = String(val || ''); });
    return node;
  }

  function fillPersonaOptions(dialog, accounts) {
    const select = dialog.querySelector('[data-persona-select]');
    const currentId = context()?.id || '';
    select.replaceChildren(option('self', '내 계정', 'self'));

    const previewable = (accounts || []).filter(account => account.previewable && account.id !== currentId);
    if (previewable.length) {
      const employeeGroup = document.createElement('optgroup');
      employeeGroup.label = '체험 가능한 직원';
      previewable.forEach(account => employeeGroup.append(option(
        account.id,
        accountLabel(account),
        'account',
        { displayName: account.display_name || '선택 직원' }
      )));
      select.append(employeeGroup);
    }

    const actualRoleCodes = new Set(previewable.flatMap(account => (account.roles || []).map(role => role.code).filter(Boolean)));
    const fallbackRoles = PRESET_ROLES.filter(roleCode => !actualRoleCodes.has(roleCode));
    if (fallbackRoles.length) {
      const presetGroup = document.createElement('optgroup');
      presetGroup.label = '역할 미리보기';
      fallbackRoles.forEach(roleCode => presetGroup.append(option(
        roleCode,
        `${LABELS[roleCode]} — 역할 미리보기`,
        'preset',
        { roleCode }
      )));
      select.append(presetGroup);
    }

    const activeRole = simulation()?.active ? simulation().role_code : null;
    const activePreset = [...select.options].find(item => item.dataset.personaKind === 'preset' && item.value === activeRole);
    if (activePreset) select.value = activePreset.value;
    else select.value = 'self';

    return { previewableCount: previewable.length, fallbackCount: fallbackRoles.length };
  }

  async function openPersonaDialog() {
    if (qaLoading) return;
    qaLoading = true;
    const dialog = ensurePersonaDialog();
    const status = dialog.querySelector('[data-qa-account-status]');
    const open = dialog.querySelector('[data-persona-open]');
    status.textContent = '체험 가능한 직원을 확인하고 있습니다.';
    open.disabled = true;
    if (!dialog.open) dialog.showModal();

    try {
      let accounts = qaAccounts || readAccountCache();
      if (!accounts && !simulation()?.active) accounts = await fetchQaAccounts({ allowCached: false });
      accounts = accounts || [];
      const counts = fillPersonaOptions(dialog, accounts);
      if (counts.previewableCount) {
        status.textContent = `체험 가능한 직원 ${counts.previewableCount}명${counts.fallbackCount ? ` · 역할 미리보기 ${counts.fallbackCount}개` : ''}`;
      } else if (simulation()?.active) {
        status.textContent = '직원 목록을 새로 확인하려면 내 계정으로 돌아간 뒤 다시 열어 주세요.';
      } else {
        status.textContent = counts.fallbackCount ? `역할 미리보기 ${counts.fallbackCount}개를 사용할 수 있습니다.` : '현재 체험 가능한 직원이 없습니다.';
      }
      open.disabled = false;
    } catch (error) {
      console.error(error);
      const counts = fillPersonaOptions(dialog, []);
      status.textContent = counts.fallbackCount
        ? '직원 목록은 불러오지 못했지만 역할 미리보기는 사용할 수 있습니다.'
        : '직원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      open.disabled = false;
    } finally {
      qaLoading = false;
    }
  }

  async function startEmployeePreview(selected, dialog) {
    const status = dialog.querySelector('[data-qa-account-status]');
    const targetProfileId = selected.value;
    const targetName = selected.dataset.displayName || selected.textContent?.split(' — ')[0]?.trim() || '선택 직원';
    if (!targetProfileId) return;

    sessionStorage.setItem(QA_HANDOFF_KEY, JSON.stringify({
      target_profile_id: targetProfileId,
      target_name: targetName,
      created_at: new Date().toISOString()
    }));

    // Open synchronously from the user gesture so mobile popup blockers do not
    // interfere. The operator session remains isolated from the target session.
    const previewTab = window.open('about:blank', '_blank');
    if (!previewTab) {
      sessionStorage.removeItem(QA_HANDOFF_KEY);
      status.textContent = '새 탭이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도하세요.';
      return;
    }

    try {
      if (simulation()?.active) {
        status.textContent = '직원 화면을 준비하고 있습니다.';
        await app().rpc('set_role_simulation_mode', { p_role_code: null });
        sessionStorage.removeItem(STORAGE_KEY);
        await window.TaejangCapabilityAccess?.refresh?.();
      }
      previewTab.location.replace('/app/qa-account-preview.html#waiting=1');
      status.textContent = `${targetName} 직원 화면 체험 탭을 열었습니다.`;
      dialog.close();
      window.setTimeout(() => sessionStorage.removeItem(QA_HANDOFF_KEY), 5000);
      if (simulation()?.active) window.setTimeout(() => window.location.reload(), 120);
    } catch (error) {
      console.error(error);
      sessionStorage.removeItem(QA_HANDOFF_KEY);
      try { previewTab.close(); } catch { /* no-op */ }
      status.textContent = '직원 화면을 열지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
  }

  async function applyPersonaSelection() {
    if (switching) return;
    const dialog = ensurePersonaDialog();
    const select = dialog.querySelector('[data-persona-select]');
    const selected = select.selectedOptions[0];
    const kind = selected?.dataset.personaKind;
    if (!selected || !kind) return;

    if (kind === 'self') {
      if (simulation()?.active) await switchMode(null);
      else dialog.close();
      return;
    }
    if (kind === 'preset') {
      await switchMode(selected.dataset.roleCode || selected.value);
      return;
    }
    if (kind === 'account') await startEmployeePreview(selected, dialog);
  }

  function makePersonaLauncher(currentSimulation) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    const activeRole = currentSimulation?.active ? currentSimulation.role_code : null;
    button.textContent = activeRole
      ? `👤 ${LABELS[activeRole] || activeRole}으로 보는 중 ▾`
      : '👤 내 계정 ▾';
    button.dataset.personaLauncher = '1';
    button.dataset.qaAccountPreviewButton = '1';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', async () => {
      button.setAttribute('aria-expanded', 'true');
      try { await openPersonaDialog(); }
      finally { button.setAttribute('aria-expanded', 'false'); }
    });
    return button;
  }

  function installSwitcher() {
    installStyles();
    const current = context();
    const currentSimulation = current?.role_simulation;
    const actions = document.querySelector('.app-user-actions');
    if (!actions || !currentSimulation?.can_switch) return;

    // A preset belongs only to this browser tab. If its local marker is gone,
    // fail back to the real operator account rather than silently keeping it.
    const localMode = sessionStorage.getItem(STORAGE_KEY);
    if (currentSimulation.active && localMode !== currentSimulation.role_code) {
      switchMode(null);
      return;
    }
    if (!currentSimulation.active && localMode) sessionStorage.removeItem(STORAGE_KEY);

    actions.querySelector('[data-role-simulation-switcher]')?.remove();
    const switcher = document.createElement('div');
    switcher.className = 'role-simulation-switcher';
    switcher.dataset.roleSimulationSwitcher = '1';
    switcher.setAttribute('aria-label', '직원 화면 체험');
    switcher.append(makePersonaLauncher(currentSimulation));
    actions.prepend(switcher);
    renderBanner(currentSimulation);

    const userLabel = document.getElementById('desktop-user-label');
    if (userLabel && currentSimulation.active) {
      userLabel.textContent = `${current.display_name || '사용자'} · ${LABELS[currentSimulation.role_code] || currentSimulation.role_code} 역할 미리보기`;
    }

    if (!currentSimulation.active) preloadQaAccounts();

    const desktopLogout = document.getElementById('desktop-logout-button');
    if (desktopLogout && !desktopLogout.dataset.roleSimulationLogoutBound) {
      desktopLogout.dataset.roleSimulationLogoutBound = '1';
      desktopLogout.addEventListener('click', async event => {
        const latest = context()?.role_simulation;
        if (!latest?.active || switching) {
          sessionStorage.removeItem(STORAGE_KEY);
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        switching = true;
        try { await app().rpc('set_role_simulation_mode', { p_role_code: null }); } catch { /* expires automatically */ }
        sessionStorage.removeItem(STORAGE_KEY);
        switching = false;
        document.getElementById('logout-button')?.click();
      }, true);
    }
  }

  document.addEventListener('taejang-app-ready', () => requestAnimationFrame(installSwitcher));
  document.addEventListener('taejang-dashboard-refresh', () => requestAnimationFrame(installSwitcher));
})();
