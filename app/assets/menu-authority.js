(() => {
  'use strict';
  let snapshot = null, pending = null, appOwner = null;
  const decisions = () => new Map((snapshot?.decisions || []).map(row => [row.menu_key, row]));
  const decision = key => decisions().get(key)?.allowed;

  function publish(next) {
    const before = JSON.stringify(snapshot);
    snapshot = next;
    if (before !== JSON.stringify(next)) {
      document.dispatchEvent(new CustomEvent('taejang-menu-authority-changed'));
      // Refresh the existing capability contract after grant/revoke as well.
      // This never modifies the account's actual/effective role or routing identity.
      if (next) void window.TaejangCapabilityAccess?.refresh().catch(() => {});
    }
  }

  async function refresh() {
    const app = window.TaejangApp;
    if (!app?.rpc) return null;
    if (pending && appOwner === app) return pending;
    if (appOwner && appOwner !== app) publish(null);
    appOwner = app;
    const job = (async () => {
      try {
        const result = await app.rpc('get_my_menu_authority');
        if (app !== window.TaejangApp) return null;
        if (result?.version !== 1 || !Array.isArray(result.decisions)) throw new Error('INVALID_MENU_AUTHORITY');
        publish(result);
        return result;
      } catch (error) {
        if (app !== window.TaejangApp) return null;
        // An old server has no personal authority contract. Do not turn a failed
        // refresh of an established contract into legacy role-based access.
        if (!snapshot && (error?.status === 404 || error?.code === 'PGRST202')) return null;
        publish({ version: 1, unavailable: true, can_manage: false, decisions: [] });
        throw error;
      }
    })();
    pending = job;
    try { return await job; } finally { if (pending === job) pending = null; }
  }

  function allowed(key, legacyAllowed) {
    if (snapshot?.unavailable) return false;
    if (snapshot?.can_manage) return legacyAllowed;
    return decision(key) ?? legacyAllowed;
  }

  async function beforeOpen(key, legacyAllowed) {
    await refresh();
    return allowed(key, legacyAllowed);
  }

  async function administrationPanel() {
    const app = window.TaejangApp;
    const context = await app.rpc('get_menu_authority_administration');
    const section = document.createElement('section'); section.className = 'platform-settings-card';
    const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
    section.append(text('h3', '개인별 메뉴 권한'), text('p', '허용한 메뉴 안에서는 운영총괄과 같은 업무 권한을 갖습니다. 다른 메뉴, 운영 역할 변경, 권한 재위임은 포함하지 않습니다. 기존 메뉴 표시 설정은 권한으로 전환되지 않습니다.'));
    const accounts = document.createElement('select'); accounts.setAttribute('aria-label', '권한을 변경할 계정');
    accounts.append(new Option('계정을 선택하세요', ''));
    (context.accounts || []).forEach(account => accounts.append(new Option(`${account.display_name} · ${account.id.slice(0, 8)}`, account.id)));
    const rows = document.createElement('div'); const status = text('p', ''); status.setAttribute('role', 'status');
    section.append(accounts, rows, status);
    accounts.addEventListener('change', render);
    function render() {
      rows.replaceChildren(); status.textContent = '';
      if (!accounts.value) return;
      for (const menu of context.menus || []) {
        const state = (context.decisions || []).find(row => row.profile_id === accounts.value && row.menu_key === menu.menu_key);
        const card = document.createElement('fieldset');
        card.append(text('legend', menu.label), text('p', menu.scope_summary));
        if (menu.sensitive_fields.length) card.append(text('p', `공개되는 정보: ${menu.sensitive_fields.join(', ')}`));
        card.append(text('p', state ? (state.allowed ? '현재 허용' : '현재 회수 · 기존 역할 권한보다 우선') : '개인별 결정 없음 · 기존 역할 권한 유지'));
        if (!menu.adapter_ready) card.append(text('p', '서버 동작 연결 검증 전에는 새 권한을 허용할 수 없습니다.'));
        const reason = document.createElement('input'); reason.placeholder = '변경 사유 (3자 이상)'; reason.maxLength = 300; reason.setAttribute('aria-label', `${menu.label} 권한 변경 사유`);
        card.append(reason);
        for (const [label, value] of [['허용', true], ['회수', false]]) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
          button.disabled = value && !menu.adapter_ready;
          button.addEventListener('click', async () => {
            const target = accounts.value;
            if (reason.value.trim().length < 3) { status.textContent = '변경 사유를 3자 이상 입력하세요.'; return; }
            if (!window.confirm(`${accounts.selectedOptions[0].textContent}\n${menu.label}: ${label}\n${menu.scope_summary}\n공개 정보: ${menu.sensitive_fields.join(', ') || '위 범위 참조'}`)) return;
            accounts.disabled = true; rows.querySelectorAll('button').forEach(item => { item.disabled = true; });
            try {
              await app.rpc('set_profile_menu_authority', { p_profile_id: target, p_menu_key: menu.menu_key,
                p_allowed: value, p_expected_revision: state?.revision || 0, p_reason: reason.value.trim() });
              const updated = await app.rpc('get_menu_authority_administration');
              context.decisions = updated.decisions; render(); status.textContent = `${label}했습니다.`;
            } catch (error) {
              status.textContent = error?.message || '저장하지 못했습니다. 설정을 다시 열어 최신 상태를 확인하세요.';
              // Keep buttons disabled after a conflict/uncertain write. Never replay a grant.
            } finally { accounts.disabled = false; }
          });
          card.append(button);
        }
        rows.append(card);
      }
    }
    return section;
  }

  window.TaejangMenuAuthority = { refresh, allowed, beforeOpen, decision, administrationPanel,
    isManager: () => snapshot?.can_manage === true,
    delegated: key => !snapshot?.unavailable && decision(key) === true,
    hasDelegatedMenus: () => !snapshot?.unavailable && (snapshot?.decisions || []).some(row => row.allowed),
    getSnapshot: () => snapshot };
  document.addEventListener('taejang-app-ready', () => {
    void refresh().catch(() => {});
  });
  window.addEventListener('focus', () => { void refresh().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh().catch(() => {});
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void refresh().catch(() => {});
  }, 30000);
})();
