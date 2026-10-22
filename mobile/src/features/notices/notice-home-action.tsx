import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { noticesNewestFirst } from './notice-api';
import { NoticeListCard } from './notice-list-card';
import { isNoticeUnread } from './notice-read-state';
import { useMyNotices } from './use-my-notices';

export function NoticeHomeAction() {
  const router = useRouter();
  const { items, versions, loading, error, retry } = useMyNotices();
  // Publication windows and employee targeting remain the server's responsibility.
  const recent = noticesNewestFirst(items).slice(0, 3);

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>공지사항</Text>
      {loading && !recent.length ? <Text style={styles.help}>공지를 확인하고 있습니다.</Text> : null}
      {!loading && error ? (
        <Pressable accessibilityRole="button" accessibilityLabel={error} onPress={() => void retry()} style={styles.retry}>
          <Text style={styles.error}>{error}</Text>
        </Pressable>
      ) : null}
      {!loading && !error && !recent.length ? <Text style={styles.help}>현재 등록된 공지사항이 없습니다.</Text> : null}
      {recent.map(item => <NoticeListCard key={item.id} item={item} unread={isNoticeUnread(item, versions)} />)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="전체 공지 보기"
        onPress={() => router.push('/notices')}
        style={({ pressed }) => [styles.history, pressed ? styles.pressed : null]}
      >
        <Text style={styles.historyText}>전체 공지 보기 →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  title: { color: '#173f31', fontSize: 21, fontWeight: '800' },
  help: { color: '#60746a', fontSize: 15, lineHeight: 22 },
  error: { color: '#8b2f2f', fontSize: 15, lineHeight: 22 },
  retry: { minHeight: 48, justifyContent: 'center' },
  pressed: { opacity: 0.86 },
  history: { alignSelf: 'flex-end', minHeight: 48, paddingHorizontal: 4, justifyContent: 'center' },
  historyText: { color: '#35624d', fontSize: 15, fontWeight: '700' },
});
