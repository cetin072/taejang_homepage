(() => {
  'use strict';

  const STORAGE_KEY = 'taejang-role-simulation-v1';
  const QA_FUNCTION = 'qa-account-preview';
  const QA_HANDOFF_KEY = 'taejang-qa-account-handoff-v1';
  const LABELS = {
    promotion_staff: '홍보직원',
    promotion_lead: '운영팀장'
  };
  let switching = false;
  let qaAccounts = null;
  let qaLoading = false;

  const app = () => window.TaejangApp;
  const context = () => app()?.getContext?.();

  function installStyles() {
    if (document.querySelector('style[data-role-simulation]')) return;
    const style = document.createElement('style');
    style.dataset.roleSimulation = '1';
    style.textContent = `
      .role-simulation-switcher {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: #fff;
      }
      .role-simulation-switcher .button {
        min-height: 34px !important;
        padding: 7px 9px !important;
        font-size: .82rem;
      }
      .role-simulation-switcher .button[aria-pressed="true"] {
        background: #173f2c;
        color: #fff;
        border-color: #173f2c;
      }
      .role-simulation-banner {
        margin: 0;
        padding: 8px 14px;
        background: #fff3cd;
        border-bottom: 1px solid #e5cc79;
        color: #4b3b00;
        font-weight: 800;
        text-align: center;
      }
      .role-simulation-banner strong { color: #7a2f00; }
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
        min-height: 46px;
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
          left: 10px;
          right: 10px;
          bottom: 10px;
          z-index: 50;
          justify-content: center;
          flex-wrap: wrap;
          box-shadow: 0 8px 28px rgba(0,0,0,.16);
        }
        .role-simulation-switcher .button { flex: 1 1 42%; }
        body:has(.role-simulation-switcher) { padding-bottom: 116px; }
      }
    `;
    document.head.append(style);
  }

  function renderBanner(simulation) {
    document.querySelector('[data-role-simulation-banner]')?.remove();
    if (!simulation?.active) return;
    const shell = document.getElementById('desktop-app-shell');
    const workspace = shell?.querySelector('.app-workspace');
    if (!workspace) return;
    const banner = document.createElement('p');
    banner.className = 'role-simulation-banner';
    banner.dataset.roleSimulationBanner = '1';
    const label = LABELS[simulation.role_code] || simulation.role_code;
    banner.append('권한 체험 중: ', Object.assign(document.createElement('strong'), { textContent: label }), ' · 이 기능은 역할만 바꾸며 실제 사용자 계정의 배정 데이터까지 바꾸지는 않습니다. 해당 역할의 서버 권한만 행사됩니다. 사용자 신원도 바뀌지 않습니다.');
    const topbar = workspace.querySelector('.app-topbar');
    if (topbar?.nextSibling) workspace.insertBefore(banner, topbar.nextSibling);
    else workspace.append(banner);
  }

  async function switchMode(roleCode) {
    if (switching) return;
    switching = true;
    document.querySelectorAll('[data-role-simulation-button]').forEach(button => { button.disabled = true; });
    try {
      await app().rpc('set_role_simulation_mode', { p_role_code: roleCode });
      if (roleCode) sessionStorage.setItem(STORAGE_KEY, roleCode);
      else sessionStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    } catch (error) {
      switching = false;
      document.querySelectorAll('[data-role-simulation-button]').forEach(button => { button.disabled = false; });
      window.alert(app()?.friendlyError?.(error) || '권한 화면을 전환하지 못했습니다.');
    }
  }

  function makeButton(label, roleCode, pressed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = label;
    button.dataset.roleSimulationButton = roleCode || 'actual';
    button.setAttribute('aria-pressed', String(pressed));
    button.addEventListener('click', () => switchMode(roleCode));
    return button;
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

  function qaErrorCode(error) {
    const raw = String(error?.message || 'UNKNOWN');
    const safe = raw.replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 80);
    return safe || 'UNKNOWN';
  }

  function accountLabel(account) {
    const roleNames = (account.roles || []).map(role => role.name || role.code).filter(Boolean);
    const meta = [account.department_name, account.position_name, roleNames.join('·')].filter(Boolean).join(' / ');
    return meta ? `${account.display_name} — ${meta}` : account.display_name;
  }

  function ensureQaDialog() {
    let dialog = document.querySelector('[data-qa-account-dialog]');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'qa-account-dialog';
    dialog.dataset.qaAccountDialog = '1';

    const body = document.createElement('div');
    body.className = 'qa-account-dialog__body';
    const heading = document.createElement('h2');
    heading.textContent = '실제 계정 검수';
    const copy = document.createElement('p');
    copy.textContent = '선택한 직원의 실제 Auth 세션과 실제 RLS로 새 탭을 엽니다. 운영총괄 원래 탭은 그대로 유지됩니다. Staging/Deploy Preview 검수용 기능입니다.';
    const select = document.createElement('select');
    select.dataset.qaAccountSelect = '1';
    select.setAttribute('aria-label', '검수할 실제 사용자 계정');
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
    open.textContent = '선택 계정 새 탭으로 열기';
    open.dataset.qaAccountOpen = '1';
    open.addEventListener('click', startQaPreview);
    actions.append(cancel, open);
    body.append(heading, copy, select, status, actions);
    dialog.append(body);
    document.body.append(dialog);
    return dialog;
  }

  function fillQaAccounts(dialog, accounts) {
    const select = dialog.querySelector('[data-qa-account-select]');
    select.replaceChildren();
    for (const account of accounts) {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.previewable ? accountLabel(account) : `${accountLabel(account)} · ${account.preview_reason || '검수 불가'}`;
      option.disabled = !account.previewable;
      option.dataset.displayName = account.display_name || '';
      select.append(option);
    }
    const first = [...select.options].find(option => !option.disabled);
    if (first) select.value = first.value;
  }

  async function openQaDialog() {
    if (qaLoading) return;
    qaLoading = true;
    const dialog = ensureQaDialog();
    const status = dialog.querySelector('[data-qa-account-status]');
    const open = dialog.querySelector('[data-qa-account-open]');
    status.textContent = '계정 목록을 불러오고 있습니다.';
    open.disabled = true;
    if (!dialog.open) dialog.showModal();
    try {
      if (!qaAccounts) {
        const result = await qaRequest({ action: 'list' });
        qaAccounts = Array.isArray(result.accounts) ? result.accounts : [];
      }
      fillQaAccounts(dialog, qaAccounts);
      const available = qaAccounts.filter(account => account.previewable).length;
      status.textContent = available ? `검수 가능한 실제 로그인 계정 ${available}개` : '검수 가능한 로그인 계정이 없습니다.';
      open.disabled = available === 0;
    } catch (error) {
      status.textContent = `실제 계정 목록을 불러오지 못했습니다. (${qaErrorCode(error)})`;
      open.disabled = true;
      console.error(error);
    } finally {
      qaLoading = false;
    }
  }

  function startQaPreview() {
    const dialog = ensureQaDialog();
    const select = dialog.querySelector('[data-qa-account-select]');
    const status = dialog.querySelector('[data-qa-account-status]');
    const targetProfileId = select.value;
    const selected = select.selectedOptions[0];
    const targetName = selected?.dataset.displayName || selected?.textContent?.split(' — ')[0]?.trim() || '선택 사용자';
    if (!targetProfileId) return;

    sessionStorage.setItem(QA_HANDOFF_KEY, JSON.stringify({
      target_profile_id: targetProfileId,
      target_name: targetName,
      created_at: new Date().toISOString()
    }));

    const previewTab = window.open('/app/qa-account-preview.html#waiting=1', '_blank');
    if (!previewTab) {
      sessionStorage.removeItem(QA_HANDOFF_KEY);
      status.textContent = '새 탭이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도하세요.';
      return;
    }

    status.textContent = `${targetName} 실제 계정 검수 탭을 열었습니다.`;
    dialog.close();
    window.setTimeout(() => sessionStorage.removeItem(QA_HANDOFF_KEY), 5000);
  }

  function makeQaButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = '실제 계정 검수';
    button.dataset.qaAccountPreviewButton = '1';
    button.addEventListener('click', openQaDialog);
    return button;
  }

  function installSwitcher() {
    installStyles();
    const current = context();
    const simulation = current?.role_simulation;
    const actions = document.querySelector('.app-user-actions');
    if (!actions || !simulation?.can_switch) return;

    // A simulation must belong to this browser tab. Closing the tab or logging
    // in again without the local marker restores the real account automatically.
    const localMode = sessionStorage.getItem(STORAGE_KEY);
    if (simulation.active && localMode !== simulation.role_code) {
      switchMode(null);
      return;
    }
    if (!simulation.active && localMode) sessionStorage.removeItem(STORAGE_KEY);

    let switcher = actions.querySelector('[data-role-simulation-switcher]');
    if (switcher) switcher.remove();
    switcher = document.createElement('div');
    switcher.className = 'role-simulation-switcher';
    switcher.dataset.roleSimulationSwitcher = '1';
    switcher.setAttribute('aria-label', '권한 및 실제 계정 검수 전환');

    const activeRole = simulation.active ? simulation.role_code : null;
    switcher.append(
      makeButton('홍보직원 보기', 'promotion_staff', activeRole === 'promotion_staff'),
      makeButton('운영팀장 보기', 'promotion_lead', activeRole === 'promotion_lead'),
      makeQaButton(),
      makeButton('운영총괄 복귀', null, !activeRole)
    );
    actions.prepend(switcher);
    renderBanner(simulation);

    const userLabel = document.getElementById('desktop-user-label');
    if (userLabel && simulation.active) {
      userLabel.textContent = `${current.display_name || '사용자'} · ${LABELS[simulation.role_code] || simulation.role_code} 역할 체험`;
    }

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
