import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { AttendancePosition } from './attendance-location';

export type AttendanceEventType = 'clock_in' | 'clock_out';
export type AttendanceEventStatus =
  | 'recorded'
  | 'exception_pending'
  | 'exception_approved'
  | 'exception_rejected'
  | 'corrected'
  | 'correction_invalidated';

export type AttendanceEvent = {
  id?: string;
  status: AttendanceEventStatus;
  event_at: string | null;
  requested_at: string | null;
};

export type AttendanceToday = {
  work_date: string;
  employee_uuid?: string;
  attendance_required?: boolean;
  is_workday?: boolean;
  holiday_work_assigned?: boolean;
  day_reason?: string | null;
  server_time?: string;
  clock_in_available?: boolean;
  clock_in_available_at?: string;
  clock_in: AttendanceEvent | null;
  clock_out: AttendanceEvent | null;
};

export type AttendanceResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  event_at?: string;
  server_time?: string;
  can_request_exception?: boolean;
  qa_mode?: boolean;
  writes_attendance?: boolean;
  accuracy_m?: number;
  distance_m?: number;
  work_date?: string;
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


export async function validateAttendanceQa(
  client: PlatformSupabaseClient,
  eventType: AttendanceEventType,
  position: AttendancePosition,
  hasQaClockIn: boolean,
): Promise<AttendanceResult> {
  const { data, error } = await client.rpc('qa_validate_attendance_event', {
    p_event_type: eventType,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_accuracy_m: position.accuracy,
    p_has_qa_clock_in: hasQaClockIn,
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
