import type { NoticeSummary } from './notice-api';

type NoticeCacheEntry = { items: NoticeSummary[]; limit: number };
type MediaCacheEntry = { signedUrl: string; expiresAt: number };

const noticeCache = new Map<string, NoticeCacheEntry>();
const mediaCache = new Map<string, MediaCacheEntry>();

function mediaKey(userId: string, mediaId: string) {
  return `${userId}:${mediaId}`;
}

export function getCachedNotices(userId: string, limit: number): NoticeSummary[] {
  return noticeCache.get(userId)?.items.slice(0, limit) ?? [];
}

export function cacheNotices(userId: string, items: NoticeSummary[], limit: number): NoticeSummary[] {
  const previous = noticeCache.get(userId);
  const nextItems = !previous || limit >= previous.limit
    ? items
    : [...items, ...previous.items.filter(item => !items.some(next => next.id === item.id))];
  noticeCache.set(userId, { items: nextItems, limit: Math.max(limit, previous?.limit ?? 0) });
  return nextItems.slice(0, limit);
}

export function getCachedNoticeMediaUrl(userId: string, mediaId: string): string | null {
  const key = mediaKey(userId, mediaId);
  const cached = mediaCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) mediaCache.delete(key);
    return null;
  }
  return cached.signedUrl;
}

export function cacheNoticeMediaUrl(userId: string, mediaId: string, signedUrl: string) {
  // Signed URLs live for one hour. Keep a short safety margin before requesting another.
  mediaCache.set(mediaKey(userId, mediaId), { signedUrl, expiresAt: Date.now() + (55 * 60 * 1000) });
}

export function clearNoticeCache(userId?: string) {
  if (!userId) {
    noticeCache.clear();
    mediaCache.clear();
    return;
  }
  noticeCache.delete(userId);
  for (const key of mediaCache.keys()) {
    if (key.startsWith(`${userId}:`)) mediaCache.delete(key);
  }
}
