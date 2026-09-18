import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type NoticeImportance = 'normal' | 'important' | 'urgent';

export type MobileNoticeListItem = {
  id: string;
  notice_kind: string;
  importance: NoticeImportance;
  title: string;
  summary: string;
  publish_start_at: string;
  publish_end_at: string | null;
  requires_acknowledgement: boolean;
  version_no: number;
  acknowledged: boolean;
  is_new: boolean;
  is_changed: boolean;
  updated_at: string;
};

export type MobileNoticeDetail = {
  id: string;
  notice_kind: string;
  importance: NoticeImportance;
  title: string;
  body_easy: string;
  publish_start_at: string;
  publish_end_at: string | null;
  effective_start_date: string | null;
  effective_end_date: string | null;
  location: string | null;
  materials: string | null;
  related_schedule_id: string | null;
  related_work_guide_id: string | null;
  related_link_url: string | null;
  related_link_label: string | null;
  requires_acknowledgement: boolean;
  version_no: number;
  acknowledged: boolean;
  acknowledged_at: string | null;
  updated_at: string;
};

function rpcError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error;
  return new Error(fallback);
}

export async function loadMyNotices(client: PlatformSupabaseClient, limit = 20) {
  const { data, error } = await client.rpc('get_my_notice_list', { p_limit: limit });
  if (error) throw rpcError(error, '공지를 불러오지 못했습니다.');
  if (!Array.isArray(data)) return [];
  return data as MobileNoticeListItem[];
}

export async function loadMyNoticeDetail(client: PlatformSupabaseClient, noticeId: string) {
  const { data, error } = await client.rpc('get_my_notice_detail', { p_notice_id: noticeId });
  if (error) throw rpcError(error, '공지 상세를 불러오지 못했습니다.');
  if (!data || typeof data !== 'object') throw new Error('공지 상세를 확인할 수 없습니다.');
  return data as MobileNoticeDetail;
}

export async function acknowledgeMyNotice(
  client: PlatformSupabaseClient,
  noticeId: string,
  version: number,
) {
  const { data, error } = await client.rpc('acknowledge_notice', {
    p_notice_id: noticeId,
    p_notice_version: version,
  });
  if (error) throw rpcError(error, '공지 확인을 저장하지 못했습니다.');
  const result = data as { ok?: boolean; code?: string; current_version?: number } | null;
  if (result?.code === 'NOTICE_VERSION_CHANGED') {
    const versionError = new Error('NOTICE_VERSION_CHANGED');
    Object.assign(versionError, { currentVersion: result.current_version });
    throw versionError;
  }
  if (!result?.ok || result.code !== 'NOTICE_ACKNOWLEDGED') {
    throw new Error(result?.code || 'NOTICE_ACKNOWLEDGEMENT_FAILED');
  }
  return result;
}

export function safeNoticeHttpsUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function noticePriority(item: MobileNoticeListItem) {
  const importance = item.importance === 'urgent' ? 30 : item.importance === 'important' ? 20 : 10;
  const acknowledgement = item.requires_acknowledgement && !item.acknowledged ? 6 : 0;
  const freshness = item.is_new || item.is_changed ? 2 : 0;
  return importance + acknowledgement + freshness;
}

export function sortNotices(items: MobileNoticeListItem[]) {
  return [...items].sort((left, right) => noticePriority(right) - noticePriority(left));
}
