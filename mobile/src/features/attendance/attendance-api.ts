import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type AttendanceEventType = 'clock_in' | 'clock_out';

export type AttendanceEventState = {
  id?: string | null;
  status?: string | null;
  event_at?: string | null;
  requested_at?: string | null;
};

export type AttendanceToday = {
  work_date: string;
  employee_uuid?: string | null;
  attendance_required?: boolean;
  is_workday?: boolean;
  day_reason?: string | null;
  clock_in: AttendanceEventState | null;
  clock_out: AttendanceEventState | null;
};

export type AttendanceActionResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  event_type?: AttendanceEventType;
  event_at?: string | null;
  requested_at?: string | null;
  can_request_exception?: boolean;
};

export type AttendanceExceptionPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function resultOrThrow(data: unknown, error: unknown, fallback: string) {
  if (error) throw error instanceof Error ? error : new Error(fallback);
  if (!data || typeof data !== 'object') throw new Error(fallback);
  return data as AttendanceActionResult;
}

export async function loadMyAttendanceToday(client: PlatformSupabaseClient) {
  const { data, error } = await client.rpc('get_my_attendance_today');
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('출퇴근 상태를 확인할 수 없습니다.');
  return data as AttendanceToday;
}

export async function recordMyAttendance(
  client: PlatformSupabaseClient,
  eventType: AttendanceEventType,
  position: AttendanceExceptionPosition,
) {
  const { data, error } = await client.rpc('record_attendance_event', {
    p_event_type: eventType,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_accuracy_m: position.accuracy,
  });
  return resultOrThrow(data, error, '출퇴근 기록을 저장하지 못했습니다.');
}

export async function requestMyAttendanceException(
  client: PlatformSupabaseClient,
  eventType: AttendanceEventType,
  failureCode: 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'LOCATION_UNCERTAIN',
  position?: AttendanceExceptionPosition | null,
) {
  const { data, error } = await client.rpc('request_attendance_exception', {
    p_event_type: eventType,
    p_failure_code: failureCode,
    p_latitude: position?.latitude ?? null,
    p_longitude: position?.longitude ?? null,
    p_accuracy_m: position?.accuracy ?? null,
  });
  return resultOrThrow(data, error, '관리자 확인 요청을 저장하지 못했습니다.');
}

export function attendanceEventRecorded(value: AttendanceEventState | null | undefined) {
  return value?.status === 'recorded' || value?.status === 'exception_approved';
}

export function attendanceEventPending(value: AttendanceEventState | null | undefined) {
  return value?.status === 'exception_pending';
}
