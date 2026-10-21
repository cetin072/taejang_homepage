import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { noticesNewestFirst } from '@/src/features/notices/notice-api';
import { NoticeListCard } from '@/src/features/notices/notice-list-card';
import { isNoticeUnread } from '@/src/features/notices/notice-read-state';
import { useMyNotices } from '@/src/features/notices/use-my-notices';

export default function NoticeListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items: visibleItems, versions, loading: showInitialLoading, error, retry: load } = useMyNotices();
  const hasCachedItems = visibleItems.length > 0;

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.back}>
          <Text style={styles.backText}>← 홈</Text>
        </Pressable>
        <Text style={styles.eyebrow}>태장</Text>
        <Text style={styles.title}>공지사항</Text>

        {showInitialLoading && !hasCachedItems ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.help}>공지를 확인하고 있습니다.</Text>
          </View>
        ) : null}

        {!showInitialLoading && error ? (
          <Pressable onPress={() => void load()} style={styles.emptyCard}>
            <Text style={styles.error}>{error}</Text>
            <Text style={styles.retry}>다시 시도</Text>
          </Pressable>
        ) : null}

        {!hasCachedItems && !showInitialLoading && !error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>현재 확인할 공지가 없습니다.</Text>
          </View>
        ) : null}

        {noticesNewestFirst(visibleItems).map(item => (
          <NoticeListCard key={item.id} item={item} unread={isNoticeUnread(item, versions)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f4ed' },
  scroll: { gap: 14, padding: 22, paddingBottom: 40 },
  back: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center' },
  backText: { color: '#35624d', fontSize: 16, fontWeight: '800' },
  eyebrow: { color: '#35624d', fontSize: 13, fontWeight: '800' },
  title: { color: '#173f31', fontSize: 32, fontWeight: '900', marginBottom: 8 },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  emptyCard: {
    gap: 8,
    padding: 24,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7ded8',
  },
  emptyTitle: { color: '#344b40', fontSize: 18, fontWeight: '800' },
  help: { color: '#60746a', fontSize: 14 },
  error: { color: '#8b2f2f', fontSize: 15, lineHeight: 22 },
  retry: { color: '#35624d', fontSize: 15, fontWeight: '800' },
});
