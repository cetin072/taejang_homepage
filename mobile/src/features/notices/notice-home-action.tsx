import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { noticeDeepLinkPath, type NoticeSummary } from './notice-api';
import { isRecentlyPublished, noticeDate, unreadNotices } from './notice-read-state';
import { NOTICE_LIST_LIMIT, useMyNotices } from './use-my-notices';

// The server list already excludes notices outside the publication window.
function latestRecent(items: NoticeSummary[]) {
  return items.filter(item => isRecentlyPublished(item)).sort((a, b) =>
    Date.parse(b.publish_start_at) - Date.parse(a.publish_start_at) || a.id.localeCompare(b.id))[0];
}

export function NoticeHomeAction({ minHeight = 132 }: { minHeight?: number }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const { items, versions, loading, error, retry } = useMyNotices();
  const unread = unreadNotices(items, versions);
  const latest = unread[0] || latestRecent(items);
  const unreadRecent = unread.some(item => isRecentlyPublished(item));
  const isUnread = unread.length > 0;
  const ready = !loading && !error;

  function open() {
    if (error) { void retry(); return; }
    if (ready && latest) { router.push(noticeDeepLinkPath(latest.id)); return; }
    router.push('/notices');
  }

  return (
    <View style={[styles.action, { minHeight }]}>
      <Text accessibilityRole="header" style={styles.title}>공지사항</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={error || (ready && latest ? `${latest.title}, ${isUnread ? '미확인' : '읽음'}, 내용 보기` : '공지사항 열기')}
        onPress={open}
        style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
      >
        <View style={styles.copy}>
          {loading ? <Text style={styles.subtitle}>확인 중…</Text> : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : latest ? (<>
            <Text style={isUnread && unreadRecent ? styles.newBadge : styles.subtitle}>
              {noticeDate(latest)}
              {latest.importance === 'urgent' ? ' · 긴급' : latest.importance === 'important' ? ' · 중요' : ''}
              {isUnread ? ` · 미확인 ${unread.length}건${items.length === NOTICE_LIST_LIMIT ? ' 이상' : ''}` : ' · ✓ 읽음'}
            </Text>
            <Text numberOfLines={fontScale > 1 ? undefined : 2} style={styles.noticeTitle}>{latest.title}</Text>
            <Text style={styles.link}>내용 보기 →</Text>
          </>) : <Text style={styles.subtitle}>새로운 공지가 없습니다.</Text>}
        </View>
        {ready && isUnread && unreadRecent ? <View style={styles.dot} /> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="전체 목록 보기"
        onPress={() => router.push('/notices')}
        style={({ pressed }) => [styles.history, pressed ? styles.pressed : null]}
      >
        <Text style={styles.historyText}>전체 목록 보기 →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#c6d2c9',
    backgroundColor: '#ffffff',
    justifyContent: 'space-between',
    gap: 8,
  },
  primary: { minHeight: 48, paddingVertical: 4 },
  pressed: { opacity: 0.86 },
  copy: { alignItems: 'stretch', gap: 8 },
  title: { color: '#173f31', fontSize: 23, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: '#60746a', fontSize: 15, fontWeight: '700', textAlign: 'left' },
  error: { color: '#8b2f2f', fontSize: 16, textAlign: 'left' },
  newBadge: { color: '#a13024', fontSize: 18, fontWeight: '800' },
  noticeTitle: { color: '#173f31', fontSize: 21, fontWeight: '800', textAlign: 'left' },
  link: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: '#173f31', color: '#ffffff', fontSize: 17, fontWeight: '800' },
  history: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#cad9cd',
    backgroundColor: '#ffffff',
  },
  historyText: { color: '#35624d', fontSize: 16, fontWeight: '900' },
  dot: {
    position: 'absolute',
    top: 12,
    right: 10,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#b13b2d',
  },
});
