(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangAttendanceRosterSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // Matches the existing public.positions hierarchy; do not infer a job
  // title from the employee's login role or name.
  const positionCodes = [
    'ceo', 'operations_manager', 'system_super_admin', 'department_lead',
    'general_field_lead', 'task_field_lead', 'field_manager', 'staff',
    'general_worker', 'work_assistant', 'external_guide'
  ];
  const knownRanks = new Map(positionCodes.map((code, index) => [code, (index + 1) * 10]));
  const korean = new Intl.Collator('ko-KR', { numeric: true });

  function positionOrders(context) {
    const positions = new Map((Array.isArray(context?.positions) ? context.positions : [])
      .filter(position => position?.id)
      .map(position => [
        String(position.id),
        Number.isFinite(position.sort_order) ? position.sort_order : knownRanks.get(position.code)
      ]));
    const orders = new Map();
    for (const employee of Array.isArray(context?.employees) ? context.employees : []) {
      const rank = positions.get(String(employee.position_id));
      if (employee.id && Number.isFinite(rank)) orders.set(String(employee.id), rank);
    }
    return orders;
  }

  function sortRows(rows, orders = new Map()) {
    const rank = row => {
      const fromContext = orders.get(String(row.employee_uuid));
      const value = Number.isFinite(fromContext) ? fromContext : row.position_order;
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    };
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const first = rank(a), second = rank(b);
      if (first !== second) return first < second ? -1 : 1;
      return korean.compare(a.display_name || '\uffff', b.display_name || '\uffff')
        || korean.compare(a.employee_id || '', b.employee_id || '')
        || String(a.employee_uuid || '').localeCompare(String(b.employee_uuid || ''));
    });
  }

  return Object.freeze({ positionOrders, sortRows });
});
