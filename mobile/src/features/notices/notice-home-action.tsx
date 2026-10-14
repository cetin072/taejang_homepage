import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { noticeDeepLinkPath } from './notice-api';
import { isRecentlyPublished, noticeDate, unreadNotices } from './notice-read-state';
import { NOTICE_LIST_LIMIT, useMyNotices } from './use-my-notices';

export function NoticeHomeAction({ minHeight = 164 }: { minHeight?: number }) {
  const router = useRouter();
  const { items, versions, loading, error, retry } = useMyNotices();
  const unread = unreadNotices(items, versions);
  const latest = unread[0];
  const recent = unread.some(item => isRecentlyPublished(item));
  const ready = !loading && !error;
  function open() {
    if (error) { void retry(); return; }
    if (ready && latest) { router.push(noticeDeepLinkPath(latest.id)); return; }
    router.push('/notices');
  }

  return (
    <View style={styles.container}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={error || (ready && latest ? `${latest.title} 공지 내용 확인하기` : '공지사항 열기')}
      onPress={open}
      style={({ pressed }) => [
        styles.action,
        { minHeight },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>공지사항</Text>
        {loading ? <Text style={styles.subtitle}>확인 중…</Text> : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : latest ? (<>
          <Text style={recent ? styles.newBadge : styles.subtitle}>
            {recent ? '● 새 공지' : '미확인 공지'} {unread.length}건{items.length === NOTICE_LIST_LIMIT ? ' 이상' : ''}
          </Text>
          <Text style={styles.subtitle}>{noticeDate(latest)} · {latest.importance === 'urgent' ? '긴급 공지' : latest.importance === 'important' ? '중요 공지' : '일반 공지'}</Text>
          <Text numberOfLines={2} style={styles.noticeTitle}>{latest.title}</Text>
          {recent ? <Text style={styles.subtitle}>새로운 공지가 등록되었습니다.</Text> : null}
          <Text style={styles.link}>공지 내용 확인하기 →</Text>
        </>) : <Text style={styles.subtitle}>새로운 공지가 없습니다.</Text>}
      </View>
      {ready && recent ? <View style={styles.dot} /> : null}
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.push('/notices')} style={styles.history}>
      <Text style={styles.link}>지난 공지 보기 →</Text>
    </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  history: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  link: { color: '#35624d', fontSize: 16, fontWeight: '800' },
  error: { color: '#8b2f2f', fontSize: 16, textAlign: 'center' },
  newBadge: { color: '#a13024', fontSize: 18, fontWeight: '800' },
  noticeTitle: { color: '#173f31', fontSize: 21, fontWeight: '800', textAlign: 'center' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#c6d2c9',
    backgroundColor: '#ffffff',
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  copy: { flex: 1, alignItems: 'center', gap: 10 },
  title: { color: '#173f31', fontSize: 31, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: '#60746a', fontSize: 15, fontWeight: '700' },
  dot: {
    position: 'absolute',
    top: 20,
    right: 22,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#b13b2d',
  },
});
