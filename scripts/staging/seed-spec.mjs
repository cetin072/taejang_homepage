export const FULL_QA_CONFIRMATION_ENV = 'STAGING_FULL_QA_CONFIRM';
export const FULL_QA_CONFIRMATION_VALUE = 'FULL_QA';

export const MINIMAL_TEST_USERS = [
  ['test-admin', '[TEST] 시험 관리자', 'super_admin', 'system_super_admin', 'staging_test'],
  ['test-worker', '[TEST] 시험 근로자', 'general_worker', 'general_worker', 'staging_test']
];

// Keep the complete RLS/role QA matrix available, but make it opt-in only.
export const FULL_QA_USERS = [
  ['super-admin-1', '검수 최고관리자 1', 'super_admin', 'system_super_admin', 'staging_qa_operations'],
  ['super-admin-2', '검수 최고관리자 2', 'super_admin', 'system_super_admin', 'staging_qa_operations'],
  ['ceo', '검수 대표', 'ceo', 'ceo', 'staging_qa_operations'],
  ['operations', '검수 운영총괄', 'operations_manager', 'operations_manager', 'staging_qa_operations'],
  ['department-lead', '검수 팀장', 'department_lead', 'department_lead', 'staging_qa_field'],
  ['field-lead', '검수 현장책임자', 'field_lead', 'general_field_lead', 'staging_qa_field'],
  ['office', '검수 사무직', 'office_staff', 'staff', 'staging_qa_operations'],
  ['worker-1', '검수 근로자 1', 'general_worker', 'general_worker', 'staging_qa_field'],
  ['worker-2', '검수 근로자 2', 'general_worker', 'general_worker', 'staging_qa_operations']
];

export function seedMode(argv = process.argv.slice(2), environment = process.env) {
  if (argv.length === 0) return 'minimal';
  if (argv.length !== 1 || argv[0] !== '--full') throw new Error('Only --full is supported. Run without options for the minimal TEST seed.');
  if (environment[FULL_QA_CONFIRMATION_ENV] !== FULL_QA_CONFIRMATION_VALUE) {
    throw new Error(`--full requires ${FULL_QA_CONFIRMATION_ENV}=${FULL_QA_CONFIRMATION_VALUE}. Stop without changing the remote project.`);
  }
  return 'full';
}
