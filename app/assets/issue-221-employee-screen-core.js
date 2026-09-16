((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TaejangIssue221EmployeeScreenCore = api;
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';

  const ROLE_CODES = Object.freeze(['general_worker', 'promotion_staff', 'promotion_lead']);
  const ROLE_LABELS = Object.freeze({
    general_worker: '일반직원',
    promotion_staff: '홍보직원',
    promotion_lead: '운영팀장'
  });

  const text = value => typeof value === 'string' ? value.trim() : '';

  function normalizePersona(raw) {
    const roleCode = text(raw?.role_code);
    if (!ROLE_CODES.includes(roleCode)) return null;
    const profileId = text(raw?.profile_id);
    const employeeUuid = text(raw?.employee_uuid);
    const name = text(raw?.name);
    if (!profileId || !employeeUuid || !name) return null;
    return Object.freeze({
      profileId,
      employeeUuid,
      employeeId: text(raw?.employee_id),
      name,
      roleCode,
      roleName: ROLE_LABELS[roleCode]
    });
  }

  function buildPersonas(payload, { currentProfileId = '' } = {}) {
    const seenEmployees = new Set();
    const result = [];
    const current = text(currentProfileId);
    const rows = Array.isArray(payload?.personas) ? payload.personas : [];
    for (const row of rows) {
      const persona = normalizePersona(row);
      if (!persona || persona.profileId === current || seenEmployees.has(persona.employeeUuid)) continue;
      seenEmployees.add(persona.employeeUuid);
      result.push(persona);
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  function missingRoleCodes(personas) {
    const present = new Set((personas || []).map(persona => persona?.roleCode).filter(Boolean));
    return ROLE_CODES.filter(roleCode => !present.has(roleCode));
  }

  function isExactQaPreviewHost(hostname) {
    const host = text(hostname).toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    return /^deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/.test(host);
  }

  return Object.freeze({ ROLE_CODES, ROLE_LABELS, buildPersonas, missingRoleCodes, isExactQaPreviewHost });
});
