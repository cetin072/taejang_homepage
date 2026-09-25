import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type ScheduleItem = {
  id: string;
  schedule_type: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  manager_label: string | null;
  materials: string | null;
  transport_method: string | null;
  vehicle_departure_at: string | null;
  easy_text: string;
  status: 'published' | 'cancelled';
  is_changed: boolean;
  updated_at: string;
};

function scheduleItems(value: unknown): ScheduleItem[] {
  return Array.isArray(value) ? value as ScheduleItem[] : [];
}

export async function loadMyUpcomingSchedules(
  client: PlatformSupabaseClient,
  limit = 6,
): Promise<ScheduleItem[]> {
  // The server defaults p_from_date to korea_current_date(), so the device
  // cannot choose the authoritative "today" boundary.
  const { data, error } = await client.rpc('get_my_schedule_list', { p_limit: limit });
  if (error) throw error;
  return scheduleItems(data);
}

export async function loadMyScheduleDetail(
  client: PlatformSupabaseClient,
  scheduleId: string,
): Promise<ScheduleItem> {
  const { data, error } = await client.rpc('get_my_schedule_detail', { p_schedule_id: scheduleId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('일정 상세를 불러오지 못했습니다.');
  }
  return data as ScheduleItem;
}

export function scheduleDeepLinkPath(scheduleId: string) {
  return `/schedules/${encodeURIComponent(scheduleId)}`;
}
