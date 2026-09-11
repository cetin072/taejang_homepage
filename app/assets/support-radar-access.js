(() => {
  'use strict';

  const CAPABILITIES = Object.freeze({
    managementView: 'support_radar.management_view',
    managementEdit: 'support_radar.management_edit',
    assignedWork: 'support_radar.assigned_work'
  });
  const legacyManagementView = new Set(['operations_manager', 'ceo']);
  const legacyManagementEdit = new Set(['operations_manager']);
  const legacyAssignedWork = new Set([
    'operations_manager', 'department_lead', 'promotion_lead', 'promotion_staff',
    'worker_support_lead', 'worker_support_staff', 'office_staff'
  ]);

  const app = () => window.TaejangApp;
  const roleCodes = () => {
    const effective = app()?.getEffectiveRoles?.();
    if (Array.isArray(effective)) return new Set(effective);
    return new Set((app()?.getContext?.()?.roles || []).map(role => role?.code).filter(Boolean));
  };
  const capabilities = () => new Set(app()?.getCapabilities?.() || []);
  const hasSupportContract = () => [...capabilities()].some(code => code.startsWith('support_radar.'));
  const allowed = (capability, legacyRoles) => hasSupportContract()
    ? Boolean(app()?.can?.(capability))
    : [...roleCodes()].some(role => legacyRoles.has(role));

  const access = {
    CAPABILITIES,
    hasSupportContract,
    canManagementView: () => allowed(CAPABILITIES.managementView, legacyManagementView),
    canManagementEdit: () => allowed(CAPABILITIES.managementEdit, legacyManagementEdit),
    canAssignedWork: () => allowed(CAPABILITIES.assignedWork, legacyAssignedWork)
  };
  access.canUse = () => access.canManagementView() || access.canAssignedWork();
  access.canReview = () => access.canManagementEdit() || access.canAssignedWork();

  const lifecycle = {
    emit(surface, detail = {}) {
      document.dispatchEvent(new CustomEvent('taejang-support-radar-rendered', {
        detail: { surface, ...detail }
      }));
    }
  };

  window.TaejangSupportRadarAccess = access;
  window.TaejangSupportRadarLifecycle = lifecycle;
})();
