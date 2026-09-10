export const testGroups = Object.freeze({
  platformStatic: Object.freeze([
    'tests/phase1a-security-foundation.test.js',
    'tests/staff-entry-routing.test.js',
    'tests/staff-password-recovery.test.js',
    'tests/general-worker-today-board.test.js',
    'tests/staff-schedules-notices.test.js',
    'tests/frequent-staff-guidance.test.js',
    'tests/promotion-phase-c.test.js',
    'tests/pilot-management-ux.test.js',
    'tests/phase-c-workspace-v2.test.js',
    'tests/phase-c-live-publication.test.js',
    'tests/promotion-approved-delete-ux.test.js',
    'tests/worker-mobile-attendance.test.js',
    'tests/attendance-location-acquisition.test.js',
    'tests/app-role-navigation.test.js',
    'tests/operations-homepage-direct.test.js',
    'tests/employee-identity-foundation.test.js',
    'tests/operations-recoverable-delete.test.js',
    'tests/issue-146-operations-permissions.test.js',
    'tests/issue-146-db-contract-fixes.test.js',
    'tests/issue-146-lint-regression.test.js',
    'tests/issue-146-final-blockers.test.js',
    'tests/capability-access-foundation.test.js',
    'tests/capability-ui-gates.test.js',
    'tests/issue-148-promotion-homepage-capability-contract.test.js',
    'tests/internal-app-ia.test.js',
    'tests/internal-app-followup-ux.test.js',
    'tests/app-failure-states.test.js',
    'tests/required-check-workflows.test.js',
    'tests/support-radar-bizinfo-normalizer.test.mjs',
    'tests/support-radar-reingestion-plan.test.mjs',
    'tests/support-radar-ingestion-run.test.mjs'
  ]),
  publicHomepage: Object.freeze([
    'tests/public-homepage-main-simplification.test.js',
    'tests/public-navigation-consolidation.test.js',
    'tests/public-external-content.test.js',
    'tests/public-static-fallback.test.js',
    'tests/public-image-budget.test.js',
    'tests/business-section-hierarchy.test.js',
    'tests/community-esg.test.js',
    'tests/content-detail-thumbnail.test.js',
    'tests/hero-video-slider.test.js'
  ]),
  stagingSafety: Object.freeze([
    'tests/first-super-admin-bootstrap.test.js',
    'tests/staging-environment-tooling.test.js',
    'tests/staging-first-super-admin-workflow.test.js',
    'tests/staging-safety-runtime.test.mjs',
    'tests/staging-seed-options.test.mjs'
  ])
});

export function getTestGroup(name) {
  const group = testGroups[name];
  if (!group) {
    const allowed = Object.keys(testGroups).join(', ');
    throw new Error(`Unknown test group: ${name}. Expected one of: ${allowed}`);
  }
  return [...group];
}
