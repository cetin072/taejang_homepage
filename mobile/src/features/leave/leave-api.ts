import type { PlatformSupabaseClient } from '@/src/platform/supabase';
export type LeavePortion = 'full' | 'first_half' | 'second_half';
export type LeaveRequest = { id: string; work_date: string; portion: LeavePortion; units: number; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; modification_count?: number; replaces_request_id?: string | null };
export type LeaveChange = { id:string; request_id:string; action:'cancel'|'amend'; new_work_date:string|null; new_portion:LeavePortion|null; reason:string; status:'pending'|'approved'|'rejected'; decision_note?:string|null };
export type LeaveContext = { configured: boolean; remaining: number | null; server_today: string; earliest_date: string; requests: LeaveRequest[]; change_requests?: LeaveChange[] };
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
export async function editMyPendingLeave(client:PlatformSupabaseClient,requestId:string,id:string,date:string,portion:LeavePortion){
  const {data,error}=await client.rpc('edit_my_pending_leave',{p_request_id:requestId,p_id:id,p_work_date:date,p_portion:portion});
  if(error)throw error;if(data?.ok!==true)throw new Error('LEAVE_EDIT_FAILED');
}
export async function requestMyLeaveChange(client:PlatformSupabaseClient,id:string,requestId:string,action:'cancel'|'amend',date:string|null,portion:LeavePortion|null,reason = '') {
  const {data,error}=await client.rpc('request_my_leave_change',{p_id:id,p_request_id:requestId,p_action:action,p_new_work_date:date,p_new_portion:portion,p_reason:reason});
  if(error)throw error;
  if(data?.ok!==true)throw new Error('LEAVE_CHANGE_FAILED');
}
export function leaveError(error: unknown) {
  const code=String((error as { message?: string })?.message || '');
  const messages: Record<string,string> = {
    LEAVE_MODIFICATION_LIMIT:'수정 요청은 1회만 가능합니다. 관리자에게 문의해주세요.',
    LEAVE_THREE_DAYS_REQUIRED:'연차는 사용일 최소 3일 전에 신청할 수 있습니다.',
    INSUFFICIENT_LEAVE:'남은 연차가 부족합니다. 신청 대기 내역도 확인해주세요.',
    LEAVE_ALREADY_STARTED:'사용일이 된 연차는 변경할 수 없습니다. 관리자에게 문의해주세요.',
    LEAVE_CHANGE_PENDING:'이미 취소·수정 요청을 보냈습니다. 관리자 처리를 기다려주세요.',
    LEAVE_CHANGE_UNCHANGED:'변경할 날짜 또는 종일·반차를 선택해주세요.',
    LEAVE_NOT_PENDING:'이미 승인 또는 처리된 신청입니다. 새로고침 후 확인해주세요.',
    LEAVE_NOT_APPROVED:'승인된 연차만 변경 요청할 수 있습니다.',
    LEAVE_NOT_ACTIVE:'이미 처리된 연차입니다. 새로고침 후 확인해주세요.',
    LEAVE_NOT_CONFIGURED:'관리자가 연차를 등록한 후 신청할 수 있습니다.',
    NOT_SCHEDULED_WORKDAY:'등록된 근무일만 신청할 수 있습니다. 관리자에게 근무시간을 확인해주세요.',
    REQUEST_ID_CONFLICT:'이전 신청 결과를 확인한 후 다시 시도해주세요.',
    EMPLOYEE_LINK_REQUIRED:'활성 직원 계정 연결을 확인해주세요.',
    ATTENDANCE_CONFLICT:'기존 근태와 겹칩니다. 관리자에게 확인해주세요.',
  };
  return Object.entries(messages).find(([key])=>code.includes(key))?.[1] || (code.includes('duplicate') ? '이미 해당 날짜의 연차 신청이 있습니다.' : '처리하지 못했습니다. 입력은 보존됩니다. 연결 상태를 확인한 뒤 다시 시도해주세요.');
}
