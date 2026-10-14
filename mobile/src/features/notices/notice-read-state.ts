import { secureSessionStorage } from '@/src/platform/secure-storage';
import type { NoticeSummary } from './notice-api';

export type NoticeReadVersions = Record<string, number>;
type Storage = Pick<typeof secureSessionStorage, 'getItem' | 'setItem'>;

// One small, chunk-safe record per authenticated user. No notice text or tokens.
export function createNoticeReadStore(storage: Storage) {
  const records = new Map<string, Promise<NoticeReadVersions>>();
  const writes = new Map<string, Promise<unknown>>();
  function load(userId: string): Promise<NoticeReadVersions> {
    let record = records.get(userId);
    if (!record) {
      record = storage.getItem(`notice-read-v1.${userId}`).then(raw => {
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
          || Object.values(parsed).some(v => !Number.isInteger(v) || Number(v) < 1)) {
          throw new Error('INVALID_NOTICE_READ_STATE');
        }
        return parsed as NoticeReadVersions;
      }).catch(error => { records.delete(userId); throw error; });
      records.set(userId, record);
    }
    return record;
  }
  async function markRead(userId: string, notice: NoticeSummary) {
    if (notice.requires_acknowledgement) return;
    const write = (writes.get(userId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const current = await load(userId);
      if ((current[notice.id] ?? 0) >= notice.version_no) return;
      const next = { ...current, [notice.id]: notice.version_no };
      await storage.setItem(`notice-read-v1.${userId}`, JSON.stringify(next));
      records.set(userId, Promise.resolve(next));
    });
    writes.set(userId, write);
    try { await write; } finally { if (writes.get(userId) === write) writes.delete(userId); }
  }
  return {
    async load(userId: string) { await writes.get(userId); return load(userId); },
    markRead,
  };
}

export const noticeReadStore = createNoticeReadStore(secureSessionStorage);

export function isNoticeUnread(item: NoticeSummary, versions: NoticeReadVersions) {
  return item.requires_acknowledgement ? !item.acknowledged : versions[item.id] !== item.version_no;
}

export function unreadNotices(items: NoticeSummary[], versions: NoticeReadVersions) {
  return items.filter(item => isNoticeUnread(item, versions)).sort((a, b) =>
    Date.parse(b.publish_start_at) - Date.parse(a.publish_start_at) || a.id.localeCompare(b.id));
}

export function isRecentlyPublished(item: NoticeSummary, now = Date.now()) {
  const age = now - Date.parse(item.publish_start_at);
  return age >= 0 && age < 3 * 24 * 60 * 60 * 1000;
}

export function noticeDate(item: NoticeSummary) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric',
  }).format(new Date(item.publish_start_at));
}
