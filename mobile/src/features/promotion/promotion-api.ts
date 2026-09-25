import * as Crypto from 'expo-crypto';

import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type PromotionContentType = 'homepage_article' | 'external_content' | 'press_release';
export type DisclosureAnswer = 'yes' | 'no' | 'unsure';

export type PromotionItem = {
  content_id: string;
  revision_id: string;
  revision_no: number;
  content_type: PromotionContentType;
  lifecycle: 'draft' | 'review_pending' | 'needs_revision' | 'approved' | 'scheduled' | 'published' | 'hidden' | 'archived';
  minimum_review_stage: string;
  slug: string | null;
  title: string;
  summary: string | null;
  public_body: string | null;
  external_url: string | null;
  byline: string | null;
  byline_kind: string;
  related_organization: string | null;
  source_reference_url: string | null;
  hero_image_url: string | null;
  public_media: unknown[];
  people_photo: DisclosureAnswer;
  number_or_amount: DisclosureAnswer;
  requested_publish_date: string | null;
  change_reason: string | null;
  submitted_at: string | null;
  updated_at: string;
};

export type PromotionWorkspace = {
  my_items: PromotionItem[];
  review_items: unknown[];
  publication_items: unknown[];
};

export type PromotionFeedback = {
  stage: string;
  decision: 'changes_requested' | 'rejected';
  comment: string | null;
  decided_at: string | null;
};

export type PromotionDraftInput = {
  contentId?: string | null;
  slug?: string | null;
  contentType: PromotionContentType;
  title: string;
  summary: string;
  body: string;
  externalUrl: string;
  sourceReferenceUrl: string;
  byline: string | null;
  bylineKind: string;
  relatedOrganization: string | null;
  heroImageUrl: string | null;
  publicMedia: unknown[];
  peoplePhoto: DisclosureAnswer;
  numberOrAmount: DisclosureAnswer;
  requestedPublishDate: string;
};

export type SavedPromotionDraft = {
  contentId: string;
  slug: string;
};

export async function loadPromotionWorkspace(client: PlatformSupabaseClient): Promise<PromotionWorkspace> {
  const { data, error } = await client.rpc('get_my_promotion_workspace');
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('홍보 업무를 불러오지 못했습니다.');
  }
  return data as PromotionWorkspace;
}

export async function loadPromotionFeedback(
  client: PlatformSupabaseClient,
  contentId: string,
): Promise<PromotionFeedback | null> {
  const { data, error } = await client.rpc('get_my_promotion_feedback', {
    p_content_id: contentId,
  });
  if (error) throw error;
  if (data == null) return null;
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('보완 의견을 불러오지 못했습니다.');
  }
  return data as PromotionFeedback;
}

function nullable(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function makeMobileSlug() {
  return `mobile-${Date.now().toString(36)}-${Crypto.randomUUID().slice(0, 8)}`;
}

export async function savePromotionDraft(
  client: PlatformSupabaseClient,
  input: PromotionDraftInput,
): Promise<SavedPromotionDraft> {
  if (!input.title.trim()) throw new Error('제목을 입력해주세요.');
  if (!input.body.trim() && !input.publicMedia.length && input.contentType !== 'external_content') {
    throw new Error('본문을 입력해주세요.');
  }

  const slug = input.slug?.trim() || makeMobileSlug();

  const { data, error } = await client.rpc('save_promotion_draft', {
    p_content_id: input.contentId || null,
    p_content_type: input.contentType,
    p_slug: slug,
    p_title: input.title.trim(),
    p_summary: nullable(input.summary),
    p_public_body: nullable(input.body),
    p_external_url: input.contentType === 'external_content' ? nullable(input.externalUrl) : null,
    p_byline: nullable(input.byline),
    p_byline_kind: input.bylineKind || 'company',
    p_related_organization: nullable(input.relatedOrganization),
    p_source_reference_url: nullable(input.sourceReferenceUrl),
    p_hero_image_url: nullable(input.heroImageUrl),
    p_public_media: Array.isArray(input.publicMedia) ? input.publicMedia : [],
    p_people_photo: input.peoplePhoto,
    p_number_or_amount: input.numberOrAmount,
    p_requested_publish_date: nullable(input.requestedPublishDate),
    p_change_reason: input.contentId ? '홍보 콘텐츠 모바일 보완·수정본 저장' : '홍보 콘텐츠 모바일 초안 저장',
  });
  if (error) throw error;

  const result = data as { ok?: boolean; code?: string; content_id?: string } | null;
  if (!result?.ok || !result.content_id) throw new Error(result?.code || '홍보 초안을 저장하지 못했습니다.');
  return { contentId: result.content_id, slug };
}

export async function submitPromotionDraft(client: PlatformSupabaseClient, contentId: string) {
  const { data, error } = await client.rpc('submit_promotion_revision', {
    p_content_id: contentId,
  });
  if (error) throw error;

  const result = data as { ok?: boolean; code?: string } | null;
  if (!result?.ok) throw new Error(result?.code || '운영팀장에게 상신하지 못했습니다.');
}

export function promotionStatusLabel(lifecycle: PromotionItem['lifecycle']) {
  return {
    draft: '작성 중',
    review_pending: '검토 중',
    needs_revision: '보완 필요',
    approved: '승인 완료',
    scheduled: '게시 예정',
    published: '게시 완료',
    hidden: '숨김',
    archived: '보관',
  }[lifecycle];
}
