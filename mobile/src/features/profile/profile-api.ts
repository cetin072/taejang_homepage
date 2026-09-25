import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type EmployeeProfile = {
  full_name: string;
  department_name: string;
  position_name: string;
  hired_on: string;
  phone: string | null;
};

export type ContactChangeRequest = {
  id: string;
  proposed_phone: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'changes_requested' | 'rejected' | 'cancelled';
  decision_comment: string | null;
  decided_at: string | null;
};

export async function loadMyEmployeeProfile(client: PlatformSupabaseClient) {
  const { data, error } = await client.rpc('get_my_employee_profile');
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw error || new Error('EMPLOYEE_PROFILE_UNAVAILABLE');
  return data as EmployeeProfile;
}

export async function loadMyContactChangeRequests(client: PlatformSupabaseClient) {
  const { data, error } = await client.rpc('list_my_employee_contact_change_requests');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ContactChangeRequest[];
}

export async function submitMyContactChangeRequest(client: PlatformSupabaseClient, phone: string) {
  const { data, error } = await client.rpc('submit_my_employee_contact_change_request', { p_phone: phone.trim() });
  if (error) throw error;
  return data as { ok?: boolean; code?: string } | null;
}
