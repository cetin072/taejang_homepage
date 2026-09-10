(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const isOperations = () => app()?.hasCapabilityContract?.()
    ? app()?.can?.('audit.target_history.read') === true
    : app()?.getRoute?.() === 'operations_manager';
  const busy = new Set();
  let scheduled = false;

  function actionButton(label, handler, danger = false) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = danger ? 'button button-danger' : 'button button-quiet';
    node.textContent = label;
    node.addEventListener('click', handler);
    return node;
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
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

  async function archiveItem({ config, item, refresh }) {
    if (!isOperations()) return;
    const target = item.title || config.kind;
    if (!window.confirm(`${target}을(를) 삭제할까요?\n실제 데이터는 지우지 않고 복구 가능한 보관 상태로 전환합니다.`)) return;
    const reason = window.prompt(`${config.kind} 삭제(보관) 이유를 적어주세요.`, '더 이상 사용하지 않음')?.trim();
    if (!reason) return;
    try {
      const result = await app().rpc(config.archiveRpc, { [config.idArg]: item.id, p_reason: reason });
      if (!result?.ok) throw new Error(result?.code || 'ARCHIVE_FAILED');
      await refresh?.();
    } catch (error) {
      window.alert(app()?.friendlyError?.(error) || error?.message || `${config.kind}을(를) 보관하지 못했습니다.`);
    }
  }

  async function restoreItem({ config, item, refresh }) {
    if (!isOperations()) return;
    const target = item.title || config.kind;
    const previous = item.archive_previous_status ? ` 이전 상태(${item.archive_previous_status})로 돌아갑니다.` : '';
    if (!window.confirm(`${target}을(를) 복구할까요?${previous}`)) return;
    const reason = window.prompt(`${config.kind} 복구 이유를 적어주세요.`, '다시 사용')?.trim();
    if (!reason) return;
    try {
      const result = await app().rpc(config.restoreRpc, { [config.idArg]: item.id, p_reason: reason });
      if (!result?.ok) throw new Error(result?.code || 'RESTORE_FAILED');
      await refresh?.();
    } catch (error) {
      window.alert(app()?.friendlyError?.(error) || error?.message || `${config.kind}을(를) 복구하지 못했습니다.`);
    }
  }

  async function toggleHistory({ config, item, card, button }) {
    if (!isOperations()) return;
    const existing = card.querySelector('[data-target-audit-panel]');
    if (existing) {
      existing.remove();
      button.textContent = '변경 이력';
      return;
    }

    button.disabled = true;
    try {
      const rows = await app().rpc('get_target_audit_trail', {
        p_target_type: config.targetType,
        p_target_id: item.id,
        p_limit: 100
      });
      const history = Array.isArray(rows) ? rows : [];
      const panel = document.createElement('div');
      panel.dataset.targetAuditPanel = '1';
      panel.className = 'message';
      if (!history.length) {
        panel.textContent = '기록된 변경 이력이 없습니다.';
      } else {
        const heading = document.createElement('strong');
        heading.textContent = `변경 이력 ${history.length}건`;
        panel.append(heading);
        history.forEach(entry => {
          const line = document.createElement('p');
          const actor = entry.actor_display_name || '시스템';
          const reason = entry.reason ? ` · ${entry.reason}` : '';
          line.textContent = `${formatDateTime(entry.created_at)} · ${actor} · ${entry.action}${reason}`;
          panel.append(line);
        });
      }
      card.append(panel);
      button.textContent = '이력 닫기';
    } catch (error) {
      window.alert(app()?.friendlyError?.(error) || error?.message || '변경 이력을 불러오지 못했습니다.');
    } finally {
      button.disabled = false;
    }
  }

  function appendHistoryButton(config, item, card, actions) {
    const history = actionButton('변경 이력', () => toggleHistory({ config, item, card, button: history }));
    history.dataset.targetAuditAction = '1';
    actions.append(history);
  }

  async function decorateEmployees() {
    if (!isOperations() || busy.has('employees')) return;
    const cards = [...document.querySelectorAll('.employee-grid .employee-card')];
    if (!cards.length || cards.every(card => card.querySelector('[data-ops-delete-employee]'))) return;
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
        }), true);
        node.dataset.opsDeleteEmployee = '1';
        actions.append(node);
      });
    } catch {
      // Recovery controls are optional; the underlying management screen remains usable.
    } finally {
      busy.delete('employees');
    }
  }

  function decorateActiveCard(config, item, card) {
    if (card.querySelector(`[data-${config.dataAttribute}]`)) return;
    const actions = document.createElement('div');
    actions.className = 'quick-links';
    actions.setAttribute(`data-${config.dataAttribute}`, '1');
    const remove = actionButton('삭제', () => archiveItem({
      config,
      item,
      refresh: async () => document.getElementById(config.refreshId)?.click()
    }), true);
    remove.dataset.recoveryAction = 'archive';
    actions.append(remove);
    appendHistoryButton(config, item, card, actions);
    card.append(actions);
  }

  function renderArchivedSection(config, items, list) {
    list.querySelector(`[data-${config.archiveSectionAttribute}]`)?.remove();
    if (!items.length) return;

    const section = document.createElement('section');
    section.setAttribute(`data-${config.archiveSectionAttribute}`, '1');
    section.className = 'dashboard-section';
    const heading = document.createElement('h3');
    heading.textContent = `보관함 ${items.length}건`;
    section.append(heading);

    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'admin-record-card';
      const kicker = document.createElement('p');
      kicker.className = 'card-kicker';
      kicker.textContent = `보관됨 · 이전 상태 ${item.archive_previous_status || '-'}`;
      const title = document.createElement('h4');
      title.textContent = item.title || config.kind;
      const help = document.createElement('p');
      help.className = 'help';
      const actor = item.archived_by_name ? ` · ${item.archived_by_name}` : '';
      const reason = item.archive_reason ? ` · ${item.archive_reason}` : '';
      help.textContent = `${formatDateTime(item.archived_at)}${actor}${reason}`;
      card.append(kicker, title, help);

      const actions = document.createElement('div');
      actions.className = 'quick-links';
      const restore = actionButton('복구', () => restoreItem({
        config,
        item,
        refresh: async () => document.getElementById(config.refreshId)?.click()
      }));
      restore.dataset.recoveryAction = 'restore';
      actions.append(restore);
      appendHistoryButton(config, item, card, actions);
      card.append(actions);
      section.append(card);
    });
    list.append(section);
  }

  async function decorateIndexedList(config) {
    if (!isOperations() || busy.has(config.key)) return;
    const list = document.getElementById(config.listId);
    if (!list) return;
    const cards = [...list.querySelectorAll(':scope > .admin-record-card')];
    const archivedSection = list.querySelector(`:scope > [data-${config.archiveSectionAttribute}]`);
    if (archivedSection && cards.every(card => card.querySelector(`[data-${config.dataAttribute}]`))) return;
    busy.add(config.key);
    try {
      const [activeRows, archivedRows] = await Promise.all([
        config.load(),
        app().rpc('get_archived_recovery_items', { p_resource_type: config.targetType, p_limit: 100 })
      ]);
      const activeItems = Array.isArray(activeRows) ? activeRows : [];
      const archivedItems = Array.isArray(archivedRows) ? archivedRows : [];
      cards.forEach((card, index) => {
        const item = activeItems[index];
        if (item) decorateActiveCard(config, item, card);
      });
      renderArchivedSection(config, archivedItems, list);
    } catch {
      // Keep the existing management list usable when optional recovery UI fails.
    } finally {
      busy.delete(config.key);
    }
  }

  function sync() {
    if (!isOperations()) return;
    decorateEmployees();
    decorateIndexedList({
      key: 'schedules', listId: 'schedule-admin-list', refreshId: 'refresh-schedule-admin',
      dataAttribute: 'ops-recovery-schedule', archiveSectionAttribute: 'ops-archive-schedule',
      kind: '일정', targetType: 'schedule_item', archiveRpc: 'archive_schedule_item',
      restoreRpc: 'restore_schedule_item', idArg: 'p_schedule_id',
      load: () => app().rpc('list_manageable_schedules', { p_include_past: true, p_limit: 200 })
    });
    decorateIndexedList({
      key: 'notices', listId: 'notice-admin-list', refreshId: 'refresh-notice-admin',
      dataAttribute: 'ops-recovery-notice', archiveSectionAttribute: 'ops-archive-notice',
      kind: '공지', targetType: 'notice', archiveRpc: 'archive_notice',
      restoreRpc: 'restore_notice', idArg: 'p_notice_id',
      load: () => app().rpc('list_manageable_notices', { p_limit: 200 })
    });
    decorateIndexedList({
      key: 'guidance', listId: 'guidance-admin-list', refreshId: 'refresh-guidance-admin',
      dataAttribute: 'ops-recovery-guidance', archiveSectionAttribute: 'ops-archive-guidance',
      kind: '안내', targetType: 'staff_guidance', archiveRpc: 'archive_staff_guidance',
      restoreRpc: 'restore_staff_guidance', idArg: 'p_guidance_id',
      load: () => app().rpc('list_manageable_staff_guidance', { p_limit: 200 })
    });
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; sync(); }, 60);
  }

  function hasRelevantAddedNode(records) {
    return records.some(record => [...record.addedNodes].some(node => {
      if (node.nodeType !== 1) return false;
      if (node.matches?.('[data-ops-archive-schedule], [data-ops-archive-notice], [data-ops-archive-guidance]')) return false;
      if (node.matches?.('.employee-card, .admin-record-card, .employee-grid, #schedule-admin-list, #notice-admin-list, #guidance-admin-list')) return true;
      return !!node.querySelector?.('.employee-card, .admin-record-card');
    }));
  }

  document.addEventListener('taejang-app-ready', scheduleSync);
  document.addEventListener('taejang-capabilities-ready', scheduleSync);
  document.addEventListener('taejang-dashboard-refresh', scheduleSync);
  document.addEventListener('taejang-schedule-admin-loaded', scheduleSync);
  document.addEventListener('taejang-open-employee-management', () => setTimeout(scheduleSync, 120));
  document.addEventListener('taejang-open-app-panel', event => {
    if (['schedule-admin-panel', 'notice-admin-panel', 'guidance-admin-panel'].includes(event.detail?.id)) setTimeout(scheduleSync, 120);
  });

  const start = () => {
    const shell = document.getElementById('desktop-app-shell') || document.body;
    new MutationObserver(records => {
      if (hasRelevantAddedNode(records)) scheduleSync();
    }).observe(shell, { childList: true, subtree: true });
    scheduleSync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOperationsDeleteControls = { sync };
})();
