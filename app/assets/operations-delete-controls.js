(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const isOperations = () => app()?.getRoute?.() === 'operations_manager';
  const busy = new Set();
  let scheduled = false;

  function actionButton(label, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'button button-danger';
    node.textContent = label;
    node.addEventListener('click', handler);
    return node;
  }

  async function confirmAndDelete({ kind, title, rpc, args, refresh, extraWarning = '' }) {
    if (!isOperations()) return;
    const target = title || kind;
    const warning = extraWarning ? `\n${extraWarning}` : '';
    if (!window.confirm(`${target}을(를) 삭제할까요?${warning}\n삭제 후 일반 관리 목록에서는 사라집니다.`)) return;
    const reason = window.prompt(`${kind} 삭제 이유를 적어주세요.`, '테스트 자료 정리')?.trim();
    if (!reason) return;
    try {
      const result = await app().rpc(rpc, { ...args, p_reason: reason });
      if (!result?.ok) throw new Error(result?.code || 'DELETE_FAILED');
      await refresh?.();
    } catch (error) {
      window.alert(app()?.friendlyError?.(error) || error?.message || `${kind}을(를) 삭제하지 못했습니다.`);
    }
  }

  async function decorateEmployees() {
    if (!isOperations() || busy.has('employees')) return;
    const cards = [...document.querySelectorAll('.employee-grid .employee-card')];
    if (!cards.length) return;
    busy.add('employees');
    try {
      const context = await app().rpc('get_employee_management_context');
      const employees = Array.isArray(context?.employees) ? context.employees : [];
      const byId = new Map(employees.map(employee => [employee.employee_id, employee]));
      cards.forEach(card => {
        if (card.querySelector('[data-ops-delete-employee]')) return;
        const employeeId = card.querySelector('.status-label')?.textContent?.trim();
        const employee = byId.get(employeeId);
        if (!employee || employee.protected) return;
        const actions = card.querySelector('.quick-links');
        if (!actions) return;
        const node = actionButton('직원 삭제', () => confirmAndDelete({
          kind: '직원',
          title: `${employee.full_name} (${employee.employee_id})`,
          rpc: 'archive_employee',
          args: { p_employee_uuid: employee.id },
          extraWarning: employee.linked_profile ? '연결된 업무플랫폼 계정도 즉시 접근 차단됩니다.' : '',
          refresh: async () => document.dispatchEvent(new CustomEvent('taejang-open-employee-management'))
        }));
        node.dataset.opsDeleteEmployee = '1';
        actions.append(node);
      });
    } catch {
      // Delete controls are optional; the underlying management screen remains usable.
    } finally {
      busy.delete('employees');
    }
  }

  async function decorateIndexedList(config) {
    if (!isOperations() || busy.has(config.key)) return;
    const list = document.getElementById(config.listId);
    if (!list) return;
    const cards = [...list.querySelectorAll('.admin-record-card')];
    if (!cards.length) return;
    busy.add(config.key);
    try {
      const rows = await config.load();
      const items = Array.isArray(rows) ? rows : [];
      cards.forEach((card, index) => {
        if (card.querySelector(`[data-${config.dataAttribute}]`)) return;
        const item = items[index];
        if (!item) return;
        const node = actionButton(config.label, () => confirmAndDelete({
          kind: config.kind,
          title: item.title || config.kind,
          rpc: config.rpc,
          args: { [config.idArg]: item.id },
          refresh: async () => document.getElementById(config.refreshId)?.click()
        }));
        node.setAttribute(`data-${config.dataAttribute}`, '1');
        card.append(node);
      });
    } catch {
      // Keep the existing management list usable when the optional delete decoration fails.
    } finally {
      busy.delete(config.key);
    }
  }

  function sync() {
    if (!isOperations()) return;
    decorateEmployees();
    decorateIndexedList({
      key: 'schedules', listId: 'schedule-admin-list', refreshId: 'refresh-schedule-admin',
      dataAttribute: 'ops-delete-schedule', label: '일정 삭제', kind: '일정',
      rpc: 'delete_schedule_item', idArg: 'p_schedule_id',
      load: () => app().rpc('list_manageable_schedules', { p_include_past: true, p_limit: 200 })
    });
    decorateIndexedList({
      key: 'notices', listId: 'notice-admin-list', refreshId: 'refresh-notice-admin',
      dataAttribute: 'ops-delete-notice', label: '공지 삭제', kind: '공지',
      rpc: 'delete_notice', idArg: 'p_notice_id',
      load: () => app().rpc('list_manageable_notices', { p_limit: 200 })
    });
    decorateIndexedList({
      key: 'guidance', listId: 'guidance-admin-list', refreshId: 'refresh-guidance-admin',
      dataAttribute: 'ops-delete-guidance', label: '안내 삭제', kind: '안내',
      rpc: 'delete_staff_guidance', idArg: 'p_guidance_id',
      load: () => app().rpc('list_manageable_staff_guidance', { p_limit: 200 })
    });
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; sync(); }, 60);
  }

  document.addEventListener('taejang-app-ready', scheduleSync);
  document.addEventListener('taejang-dashboard-refresh', scheduleSync);
  document.addEventListener('taejang-schedule-admin-loaded', scheduleSync);

  const start = () => {
    const shell = document.getElementById('desktop-app-shell') || document.body;
    new MutationObserver(scheduleSync).observe(shell, { childList: true, subtree: true });
    scheduleSync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOperationsDeleteControls = { sync };
})();
