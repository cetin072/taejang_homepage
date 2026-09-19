import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { AttendancePosition } from './attendance-location';

export type AttendanceEventType = 'clock_in' | 'clock_out';
export type AttendanceEventStatus =
  | 'recorded'
  | 'exception_pending'
  | 'exception_approved'
  | 'exception_rejected';

export type AttendanceEvent = {
  id: string;
  status: AttendanceEventStatus;
  event_at: string | null;
  requested_at: string | null;
};

export type AttendanceToday = {
  work_date: string;
  is_workday?: boolean;
  day_reason?: string | null;
  clock_in: AttendanceEvent | null;
  clock_out: AttendanceEvent | null;
};

export type AttendanceResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  event_at?: string;
  can_request_exception?: boolean;
};

export async function loadMyAttendanceToday(client: PlatformSupabaseClient): Promise<AttendanceToday> {
  const { data, error } = await client.rpc('get_my_attendance_today');
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('출퇴근 정보를 불러오지 못했습니다.');
  }
  return data as AttendanceToday;
}

export async function recordAttendanceEvent(
  client: PlatformSupabaseClient,
  eventType: AttendanceEventType,
  position: AttendancePosition,
): Promise<AttendanceResult> {
  const { data, error } = await client.rpc('record_attendance_event', {
    p_event_type: eventType,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_accuracy_m: position.accuracy,
  });
  if (error) throw error;
  return (data || {}) as AttendanceResult;
}

export async function requestAttendanceException(
  client: PlatformSupabaseClient,
  eventType: AttendanceEventType,
  failureCode: 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'LOCATION_UNCERTAIN',
  position: AttendancePosition | null,
): Promise<AttendanceResult> {
  const { data, error } = await client.rpc('request_attendance_exception', {
    p_event_type: eventType,
    p_failure_code: failureCode,
    p_latitude: position?.latitude ?? null,
    p_longitude: position?.longitude ?? null,
    p_accuracy_m: position?.accuracy ?? null,
  });
  if (error) throw error;
  return (data || {}) as AttendanceResult;
}
