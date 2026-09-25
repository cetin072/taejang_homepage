export type EmployeeAppFeatureKey =
  | 'attendance.clock'
  | 'notice.read'
  | 'promotion.author'
  | 'work-platform.open';

export type EmployeeAppFeatureState = 'enabled' | 'disabled' | 'hidden';
export type AttendanceMode = 'record' | 'qa';

export type EmployeeAppAccess = {
  account_status?: string;
  capabilities?: string[];
  actual_roles?: Array<{ code?: string }>;
};

export type EmployeeAppFeature = {
  key: EmployeeAppFeatureKey;
  state: EmployeeAppFeatureState;
  reason?: string;
  attendanceMode?: AttendanceMode;
};

const WORK_PLATFORM_CAPABILITIES = new Set([
  'promotion.write',
  'promotion.review_lead',
  'promotion.review_operations',
  'attendance.admin_view',
  'employee.view_all',
  'employee.create',
  'employee.onboard',
  'account.view_management',
  'task.manage',
  'schedule.manage',
  'notice.manage',
  'homepage.draft',
  'homepage.review',
]);

export const EMPLOYEE_APP_FEATURE_ORDER: readonly EmployeeAppFeatureKey[] = [
  'attendance.clock',
  'notice.read',
  'promotion.author',
  'work-platform.open',
];

function hasAny(capabilities: Set<string>, candidates: Set<string>) {
  for (const capability of capabilities) {
    if (candidates.has(capability)) return true;
  }
  return false;
}

export function resolveEmployeeAppFeatures(access: EmployeeAppAccess | null | undefined) {
  const capabilities = new Set(access?.capabilities || []);
  const active = access?.account_status === 'active';
  const qaAttendance = capabilities.has('attendance.qa_validate');

  const features = new Map<EmployeeAppFeatureKey, EmployeeAppFeature>();

  features.set('attendance.clock', {
    key: 'attendance.clock',
    state: active ? 'enabled' : 'disabled',
    reason: active ? undefined : '활성 직원 계정에서 사용할 수 있습니다.',
    attendanceMode: qaAttendance ? 'qa' : 'record',
  });

  features.set('notice.read', {
    key: 'notice.read',
    state: active ? 'enabled' : 'disabled',
    reason: active ? undefined : '활성 직원 계정에서 사용할 수 있습니다.',
  });

  const promotionAuthoringEnabled = active && capabilities.has('promotion.write');
  features.set('promotion.author', {
    key: 'promotion.author',
    // This only determines whether the mobile shortcut is useful. The existing
    // promotion RPCs remain the authority for every read and write.
    state: promotionAuthoringEnabled ? 'enabled' : 'hidden',
  });

  const workPlatformEnabled = active && hasAny(capabilities, WORK_PLATFORM_CAPABILITIES);
  features.set('work-platform.open', {
    key: 'work-platform.open',
    state: workPlatformEnabled ? 'enabled' : 'disabled',
    reason: workPlatformEnabled ? undefined : '현재 계정에서 사용할 업무 플랫폼 기능이 없습니다.',
  });

  return features;
}

export function canUsePromotionAuthoring(access: EmployeeAppAccess | null | undefined) {
  return resolveEmployeeAppFeatures(access).get('promotion.author')?.state === 'enabled';
}
