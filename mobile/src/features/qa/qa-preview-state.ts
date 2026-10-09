import type { AttendanceToday, AttendanceWorkdayStatus } from '@/src/features/attendance/attendance-api';

// Display-only QA personas. They never replace the authenticated server user or capabilities.
export type QaHomePersona = 'operations_lead' | 'employee';
export type QaInspectionMode = 'preview' | 'server';
export type QaDayScenario = 'today' | 'workday' | 'hangul';

export const QA_DAY_LABELS: Record<QaDayScenario, string> = {
  today: '오늘 · 서버 달력',
  workday: '평일 예시',
  hangul: '한글날 · 공휴일',
};

export function showQaWorkPlatform(persona: QaHomePersona) {
  return persona === 'operations_lead';
}

function previewDay(
  workDate: string,
  isWorkday: boolean,
  dayReason: string,
): AttendanceToday {
  return {
    work_date: workDate,
    attendance_required: true,
    is_workday: isWorkday,
    holiday_work_assigned: false,
    day_reason: dayReason,
    clock_in_available: true,
    clock_in: null,
    clock_out: null,
  };
}

// The 2026-10-09 case is a pinned regression fixture, not a client-side holiday policy.
// "Today" always uses the server's canonical Asia/Seoul calendar result.
export function buildQaPreviewDay(
  scenario: QaDayScenario,
  serverDay?: AttendanceWorkdayStatus,
): AttendanceToday {
  if (scenario === 'hangul') {
    return previewDay('2026-10-09', false, '한글날');
  }
  if (scenario === 'workday') {
    return previewDay('2026-10-08', true, '근무일');
  }

  if (
    !serverDay
    || !/^\d{4}-\d{2}-\d{2}$/.test(serverDay.work_date)
    || typeof serverDay.is_workday !== 'boolean'
  ) {
    throw new Error('서버 근무일 달력을 확인하지 못했습니다.');
  }

  return previewDay(serverDay.work_date, serverDay.is_workday, serverDay.reason || '근무일');
}
