export type EmployeeAppFeatureKey =
  | 'attendance.clock'
  | 'notice.read'
  | 'work-platform.open';

export type EmployeeAppFeatureState = 'enabled' | 'disabled' | 'hidden';
export type AttendanceMode = 'record' | 'qa';

export type EmployeeAppAccess = {
  account_status?: string;
  capabilities?: string[];
  actual_roles?: Array<{ code?: string }>;
  work_platform_available?: boolean;
};

export type EmployeeAppFeature = {
  key: EmployeeAppFeatureKey;
  state: EmployeeAppFeatureState;
  reason?: string;
  attendanceMode?: AttendanceMode;
};

export const EMPLOYEE_APP_FEATURE_ORDER: readonly EmployeeAppFeatureKey[] = [
  'attendance.clock',
  'notice.read',
  'work-platform.open',
];

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

  const workPlatformEnabled = active && access?.work_platform_available === true;
  features.set('work-platform.open', {
    key: 'work-platform.open',
    state: workPlatformEnabled ? 'enabled' : 'disabled',
    reason: workPlatformEnabled ? undefined : '현재 계정에서 사용할 업무 플랫폼 기능이 없습니다.',
  });

  return features;
}
