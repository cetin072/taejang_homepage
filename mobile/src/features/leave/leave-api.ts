import type { PlatformSupabaseClient } from '@/src/platform/supabase';
export type LeavePortion = 'full' | 'first_half' | 'second_half';
export type LeaveRequest = { id: string; work_date: string; portion: LeavePortion; units: number; status: 'pending' | 'approved' | 'rejected' | 'cancelled' };
export type LeaveContext = { configured: boolean; remaining: number | null; server_today: string; earliest_date: string; requests: LeaveRequest[] };
export async function loadMyLeave(client: PlatformSupabaseClient): Promise<LeaveContext> {
  const { data, error } = await client.rpc('get_my_leave_context');
  if (error) throw error;
  if (!data || typeof data.configured !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(data.earliest_date) || !Array.isArray(data.requests)
    || (data.configured && (typeof data.remaining !== 'number' || !Number.isFinite(data.remaining)))) throw new Error('LEAVE_RESPONSE_INVALID');
  return data as LeaveContext;
}
export async function submitMyLeave(client: PlatformSupabaseClient, id: string, days: { date: string; portion: LeavePortion }[]) {
  const { data, error } = await client.rpc('submit_my_leave_request', { p_id:id, p_days:days });
  if (error) throw error;
  if (data?.ok !== true) throw new Error('LEAVE_SUBMISSION_FAILED');
}
export async function cancelMyLeave(client: PlatformSupabaseClient, id: string) {
  const { data, error } = await client.rpc('cancel_my_leave_request', { p_request_id:id });
  if (error) throw error;
  if (data?.ok !== true) throw new Error('LEAVE_CANCELLATION_FAILED');
}
export function leaveError(error: unknown) {
  const code=String((error as { message?: string })?.message || '');
  const messages: Record<string,string> = {
    LEAVE_THREE_DAYS_REQUIRED:'연차는 사용일 최소 3일 전에 신청할 수 있습니다.',
    INSUFFICIENT_LEAVE:'남은 연차가 부족합니다. 신청 대기 내역도 확인해주세요.',
    LEAVE_NOT_CONFIGURED:'관리자가 연차를 등록한 후 신청할 수 있습니다.',
    NOT_SCHEDULED_WORKDAY:'등록된 근무일만 신청할 수 있습니다. 관리자에게 근무시간을 확인해주세요.',
    REQUEST_ID_CONFLICT:'이전 신청 결과를 확인한 후 다시 시도해주세요.',
    EMPLOYEE_LINK_REQUIRED:'활성 직원 계정 연결을 확인해주세요.',
    ATTENDANCE_CONFLICT:'기존 근태와 겹칩니다. 관리자에게 확인해주세요.',
  };
  return Object.entries(messages).find(([key])=>code.includes(key))?.[1] || (code.includes('duplicate') ? '이미 해당 날짜의 연차 신청이 있습니다.' : '처리하지 못했습니다. 입력은 보존됩니다. 연결 상태를 확인한 뒤 다시 시도해주세요.');
}
