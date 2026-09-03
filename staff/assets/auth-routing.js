(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaejangAuthRouting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // A user can hold several roles. Operational roles take precedence over the
  // technical super-admin role so dual-role accounts enter their real work area.
  const ROLE_ROUTES = [
    ['ceo', 'ceo', '대표이사'],
    ['operations_manager', 'operations-manager', '운영총괄'],
    ['super_admin', 'super-admin', '시스템 관리'],
    ['department_lead', 'department-lead', '부서 팀장'],
    ['worker_support_lead', 'worker-support', '근로자지원'],
    ['promotion_lead', 'promotion', '운영팀장'],
    ['worker_support_staff', 'worker-support', '근로자지원'],
    ['promotion_staff', 'promotion', '홍보직원'],
    ['field_lead', 'field-lead', '현장 책임자'],
    ['office_staff', 'office-staff', '일반 사무'],
    ['work_assistant', 'work-assistant', '근로지원'],
    ['external_guide', 'external-guide', '외부 지도'],
    ['general_worker', 'general-worker', '일반 근로자']
  ];

  function roleCodes(roles) {
    return (Array.isArray(roles) ? roles : []).map(role =>
      typeof role === 'string' ? role : role && role.code
    ).filter(Boolean);
  }

  function resolveRoleRoute(roles) {
    const codes = new Set(roleCodes(roles));
    const match = ROLE_ROUTES.find(([code]) => codes.has(code));
    return match ? { code: match[0], home: match[1], label: match[2] } : null;
  }

  function accessDestination(context) {
    if (!context) return { kind: 'signin' };
    if (context.account_status === 'pending') return { kind: 'pending' };
    if (context.account_status !== 'active') return { kind: 'blocked', status: context.account_status };
    const route = resolveRoleRoute(context.roles);
    return route ? { kind: 'app', route } : { kind: 'unassigned' };
  }

  function staffDestination(context) {
    const destination = accessDestination(context);
    if (destination.kind === 'app' && destination.route.code === 'super_admin') {
      return { kind: 'admin', route: destination.route };
    }
    return destination;
  }

  return { ROLE_ROUTES, roleCodes, resolveRoleRoute, accessDestination, staffDestination };
});
