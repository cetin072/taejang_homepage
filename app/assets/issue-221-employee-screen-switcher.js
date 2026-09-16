(() => {
  'use strict';

  const core = window.TaejangIssue221EmployeeScreenCore;
  if (!core) return;

  const ROLE_MODE_KEY = 'taejang-role-simulation-v1';
  const PERSONA_CACHE_KEY = 'taejang-employee-screen-personas-v1';
  const PERSONA_MARKER_KEY = 'taejang-employee-persona-preview-v1';
  const LEGACY_QA_CACHE_KEY = 'taejang-persona-account-cache-v1';
  const QA_HANDOFF_KEY = 'taejang-qa-account-handoff-v1';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  let opening = false;
  let switching = false;

  const app = () => window.TaejangApp;
  const context = () => app()?.getContext?.();
  const simulation = () => context()?.role_simulation || null;
  const isExactQaHost = () => core.isExactQaPreviewHost(window.location.hostname);

  // The legacy switcher preloads qa-account-preview. Production must not depend on
  // that QA-only endpoint, so satisfy its cache lookup with an empty local entry.
  // The Issue #221 dialog below uses the production-safe RPC instead.
  if (!isExactQaHost()) {
    try {
      sessionStorage.setItem(LEGACY_QA_CACHE_KEY, JSON.stringify({ saved_at: Date.now(), accounts: [] }));
    } catch { /* storage unavailable: server QA boundary still fails closed */ }
  }

  function readJson(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); }
    catch { sessionStorage.removeItem(key); return null; }
  }

  function writePersonaCache(personas) {
    sessionStorage.setItem(PERSONA_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), personas }));
  }

  function readPersonaCache() {
    const cached = readJson(PERSONA_CACHE_KEY);
    if (!cached?.savedAt || !Array.isArray(cached.personas)) return null;
    if (Date.now() - Number(cached.savedAt) > CACHE_TTL_MS) {
      sessionStorage.removeItem(PERSONA_CACHE_KEY);
      return null;
    }
    return cached.personas;
  }

  async function fetchPersonas() {
    const payload = await app().rpc('get_operations_employee_screen_personas');
    const personas = core.buildPersonas(payload, { currentProfileId: context()?.id || '' });
    writePersonaCache(personas);
    return personas;
  }

  function option(value, label, kind, extra = {}) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    node.dataset.personaKind = kind;
    Object.entries(extra).forEach(([key, val]) => { node.dataset[key] = String(val ?? ''); });
    return node;
  }

  function ensureDialog() {
    let dialog = document.querySelector('[data-issue221-persona-dialog]');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'qa-account-dialog';
    dialog.dataset.issue221PersonaDialog = '1';

    const body = document.createElement('div');
    body.className = 'qa-account-dialog__body';
    const heading = document.createElement('h2');
    heading.textContent = '직원 화면 체험';
    const copy = document.createElement('p');
    copy.textContent = '실제 로그인 가능한 활성 직원은 직원 이름과 현재 역할로 표시합니다. 운영환경에서는 직원 계정에 로그인하지 않고 그 역할의 안전한 화면 기준으로 체험합니다.';
    const select = document.createElement('select');
    select.dataset.issue221PersonaSelect = '1';
    select.setAttribute('aria-label', '체험할 직원 또는 역할');
    const status = document.createElement('p');
    status.className = 'qa-account-dialog__status';
    status.dataset.issue221PersonaStatus = '1';
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
    open.dataset.issue221PersonaOpen = '1';
    open.addEventListener('click', applySelection);
    actions.append(cancel, open);
    body.append(heading, copy, select, status, actions);
    dialog.append(body);
    document.body.append(dialog);
    return dialog;
  }

  function fillOptions(dialog, personas) {
    const select = dialog.querySelector('[data-issue221-persona-select]');
    select.replaceChildren(option('self', '내 계정', 'self'));

    if (personas.length) {
      const employeeGroup = document.createElement('optgroup');
      employeeGroup.label = '직원 계정';
      personas.forEach(persona => employeeGroup.append(option(
        `employee:${persona.profileId}`,
        `${persona.name} · ${persona.roleName}`,
        'employee',
        {
          profileId: persona.profileId,
          displayName: persona.name,
          roleCode: persona.roleCode,
          roleName: persona.roleName
        }
      )));
      select.append(employeeGroup);
    }

    const missingRoles = core.missingRoleCodes(personas);
    if (missingRoles.length) {
      const previewGroup = document.createElement('optgroup');
      previewGroup.label = '역할 미리보기';
      missingRoles.forEach(roleCode => previewGroup.append(option(
        `preset:${roleCode}`,
        `${core.ROLE_LABELS[roleCode]} · 역할 미리보기`,
        'preset',
        { roleCode, roleName: core.ROLE_LABELS[roleCode] }
      )));
      select.append(previewGroup);
    }

    const marker = readJson(PERSONA_MARKER_KEY);
    const activeRole = simulation()?.active ? simulation().role_code : null;
    if (marker?.profileId && marker.roleCode === activeRole) {
      const activeEmployee = [...select.options].find(item => item.dataset.profileId === marker.profileId);
      if (activeEmployee) select.value = activeEmployee.value;
    } else if (activeRole) {
      const activePreset = [...select.options].find(item => item.dataset.personaKind === 'preset' && item.dataset.roleCode === activeRole);
      if (activePreset) select.value = activePreset.value;
    }

    return { employeeCount: personas.length, previewCount: missingRoles.length };
  }

  async function openDialog() {
    if (opening) return;
    opening = true;
    const dialog = ensureDialog();
    const status = dialog.querySelector('[data-issue221-persona-status]');
    const open = dialog.querySelector('[data-issue221-persona-open]');
    status.textContent = '활성 직원 계정을 확인하고 있습니다.';
    open.disabled = true;
    if (!dialog.open) dialog.showModal();

    try {
      let personas = readPersonaCache();
      if (!personas && !simulation()?.active) personas = await fetchPersonas();
      personas = personas || [];
      const counts = fillOptions(dialog, personas);
      if (counts.employeeCount) {
        status.textContent = `직원 계정 ${counts.employeeCount}명${counts.previewCount ? ` · 역할 미리보기 ${counts.previewCount}개` : ''}`;
      } else if (simulation()?.active) {
        status.textContent = '저장된 직원 목록이 없습니다. 내 계정으로 돌아간 뒤 다시 열어 주세요.';
      } else {
        status.textContent = counts.previewCount ? `역할 미리보기 ${counts.previewCount}개를 사용할 수 있습니다.` : '현재 체험 가능한 직원이 없습니다.';
      }
      open.disabled = false;
    } catch (error) {
      console.error('Issue #221 employee persona list unavailable.', error);
      const counts = fillOptions(dialog, []);
      status.textContent = counts.previewCount
        ? '직원 목록을 불러오지 못했습니다. 역할 미리보기만 사용할 수 있습니다.'
        : '직원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      open.disabled = false;
    } finally {
      opening = false;
    }
  }

  async function setSafeRolePreview(roleCode, persona = null) {
    if (switching) return;
    switching = true;
    try {
      await app().rpc('set_role_simulation_mode', { p_role_code: roleCode });
      if (roleCode) sessionStorage.setItem(ROLE_MODE_KEY, roleCode);
      else sessionStorage.removeItem(ROLE_MODE_KEY);
      if (persona) {
        sessionStorage.setItem(PERSONA_MARKER_KEY, JSON.stringify({
          profileId: persona.profileId,
          name: persona.name,
          roleCode: persona.roleCode,
          roleName: persona.roleName,
          startedAt: new Date().toISOString()
        }));
      } else {
        sessionStorage.removeItem(PERSONA_MARKER_KEY);
      }
      window.location.reload();
    } catch (error) {
      switching = false;
      window.alert(app()?.friendlyError?.(error) || '직원 화면을 전환하지 못했습니다.');
    }
  }

  async function openExactQaEmployee(persona, dialog) {
    if (!isExactQaHost()) return setSafeRolePreview(persona.roleCode, persona);

    sessionStorage.setItem(QA_HANDOFF_KEY, JSON.stringify({
      target_profile_id: persona.profileId,
      target_name: persona.name,
      created_at: new Date().toISOString()
    }));
    const previewTab = window.open('about:blank', '_blank');
    if (!previewTab) {
      sessionStorage.removeItem(QA_HANDOFF_KEY);
      dialog.querySelector('[data-issue221-persona-status]').textContent = '새 탭이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.';
      return;
    }
    previewTab.location.replace('/app/qa-account-preview.html#waiting=1');
    dialog.querySelector('[data-issue221-persona-status]').textContent = `${persona.name} 직원 화면 체험 탭을 열었습니다.`;
    dialog.close();
    window.setTimeout(() => sessionStorage.removeItem(QA_HANDOFF_KEY), 5000);
  }

  async function applySelection() {
    if (switching) return;
    const dialog = ensureDialog();
    const select = dialog.querySelector('[data-issue221-persona-select]');
    const selected = select.selectedOptions[0];
    const kind = selected?.dataset.personaKind;
    if (!selected || !kind) return;

    if (kind === 'self') {
      if (simulation()?.active) await setSafeRolePreview(null);
      else {
        sessionStorage.removeItem(PERSONA_MARKER_KEY);
        dialog.close();
      }
      return;
    }

    const roleCode = selected.dataset.roleCode;
    if (kind === 'preset') {
      await setSafeRolePreview(roleCode);
      return;
    }

    if (kind === 'employee') {
      const persona = {
        profileId: selected.dataset.profileId,
        name: selected.dataset.displayName,
        roleCode,
        roleName: selected.dataset.roleName || core.ROLE_LABELS[roleCode] || roleCode
      };
      await openExactQaEmployee(persona, dialog);
    }
  }

  function enhanceActivePersonaCopy() {
    const marker = readJson(PERSONA_MARKER_KEY);
    const currentSimulation = simulation();
    if (!currentSimulation?.active) {
      if (marker) sessionStorage.removeItem(PERSONA_MARKER_KEY);
      return;
    }
    if (!marker?.name || marker.roleCode !== currentSimulation.role_code) return;

    const strong = document.querySelector('[data-role-simulation-banner] strong');
    if (strong) strong.textContent = `${marker.name} · ${marker.roleName || core.ROLE_LABELS[marker.roleCode]} 기준 화면 체험 중`;
    const launcher = document.querySelector('[data-persona-launcher]');
    if (launcher) launcher.textContent = `👤 ${marker.name} · ${marker.roleName || core.ROLE_LABELS[marker.roleCode]} 기준 ▾`;
  }

  async function handleLauncher(event) {
    const launcher = event.target.closest?.('[data-persona-launcher]');
    if (!launcher) return;
    if (!context()?.role_simulation?.can_switch) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    launcher.setAttribute('aria-expanded', 'true');
    try { await openDialog(); }
    finally { launcher.setAttribute('aria-expanded', 'false'); }
  }

  document.addEventListener('click', handleLauncher, true);
  document.addEventListener('taejang-app-ready', () => requestAnimationFrame(enhanceActivePersonaCopy));
  document.addEventListener('taejang-dashboard-refresh', () => requestAnimationFrame(enhanceActivePersonaCopy));
})();
