import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type NoticeImportance = 'normal' | 'important' | 'urgent';

export type NoticeMediaItem = {
  id: string;
  storage_path: string;
  mime_type: string;
  alt_text: string;
  display_order: number;
  signed_url?: string | null;
};

export type NoticeSummary = {
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
  media?: NoticeMediaItem[];
};

export type NoticeDetail = NoticeSummary & {
  body_easy: string;
  effective_start_date: string | null;
  effective_end_date: string | null;
  location: string | null;
  materials: string | null;
  related_schedule_id: string | null;
  related_work_guide_id: string | null;
  related_link_url: string | null;
  related_link_label: string | null;
  acknowledged_at: string | null;
  media: NoticeMediaItem[];
};

function assertArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function loadMyNotices(client: PlatformSupabaseClient, limit = 20): Promise<NoticeSummary[]> {
  const { data, error } = await client.rpc('get_my_notice_list', { p_limit: limit });
  if (error) throw error;
  return assertArray(data) as NoticeSummary[];
}

export async function loadNoticeMediaUrl(
  client: PlatformSupabaseClient,
  item: NoticeMediaItem,
): Promise<string | null> {
  try {
    const { data, error } = await client.storage.from('notice-media').createSignedUrl(item.storage_path, 3600);
    return error ? null : data?.signedUrl || null;
  } catch {
    return null;
  }
}

export async function loadMyNoticeDetail(client: PlatformSupabaseClient, noticeId: string): Promise<NoticeDetail> {
  const { data, error } = await client.rpc('get_my_notice_detail', { p_notice_id: noticeId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('공지 상세를 불러오지 못했습니다.');
  }
  const detail = data as NoticeDetail;
  return {
    ...detail,
    // Keep guarded media metadata, but never block notice text on Storage URLs.
    media: Array.isArray(detail.media) ? detail.media.map(item => ({ ...item, signed_url: null })) : [],
  };
}

export async function acknowledgeMyNotice(
  client: PlatformSupabaseClient,
  noticeId: string,
  version: number,
): Promise<string | null> {
  const { data, error } = await client.rpc('acknowledge_notice', {
    p_notice_id: noticeId,
    p_notice_version: version,
  });
  if (error) throw error;

  const result = data as { ok?: boolean; code?: string; acknowledged_at?: string } | null;
  if (!result?.ok) {
    if (result?.code === 'NOTICE_VERSION_CHANGED') {
      throw new Error('공지 내용이 변경되었습니다. 최신 내용을 다시 확인해주세요.');
    }
    if (result?.code === 'ACKNOWLEDGEMENT_NOT_REQUIRED') return null;
    throw new Error('공지 확인을 저장하지 못했습니다.');
  }
  return result.acknowledged_at || null;
}

export function noticeDeepLinkPath(noticeId: string) {
  return `/notices/${encodeURIComponent(noticeId)}`;
}
