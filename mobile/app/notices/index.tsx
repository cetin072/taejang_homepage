import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyNotices, noticeDeepLinkPath, type NoticeSummary } from '@/src/features/notices/notice-api';
import { cacheNotices, getCachedNotices } from '@/src/features/notices/notice-cache';
import { usePlatform } from '@/src/providers/platform-provider';

function badge(item: NoticeSummary) {
  if (item.importance === 'urgent') return '긴급';
  if (item.importance === 'important') return '중요';
  return '공지';
}

export default function NoticeListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session } = usePlatform();
  const userId = session?.user.id;
  const [items, setItems] = useState<NoticeSummary[]>(() => userId ? getCachedNotices(userId, 20) : []);
  const [cacheUserId, setCacheUserId] = useState(userId);
  const [loading, setLoading] = useState(() => !userId || getCachedNotices(userId, 20).length === 0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!client || !session) return;
    const cached = getCachedNotices(session.user.id, 20);
    setCacheUserId(session.user.id);
    setItems(cached);
    setLoading(cached.length === 0);
    setError('');
    try {
      const fresh = await loadMyNotices(client, 20);
      setItems(cacheNotices(session.user.id, fresh, 20));
    } catch {
      if (cached.length === 0) setError('공지를 불러오지 못했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void load();
    });
    return () => subscription.remove();
  }, [load]);

  const visibleItems = cacheUserId === userId ? items : [];
  const hasCachedItems = visibleItems.length > 0;
  const showInitialLoading = loading || cacheUserId !== userId;

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

        {!hasCachedItems && !showInitialLoading && error ? (
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

        {(hasCachedItems || (!showInitialLoading && !error)) ? visibleItems.map(item => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.title} 공지 열기`}
            onPress={() => router.push(noticeDeepLinkPath(item.id))}
            style={({ pressed }) => [styles.notice, pressed ? styles.pressed : null]}
          >
            <Text style={styles.meta}>
              {badge(item)}
              {item.is_new ? ' · 새 공지' : ''}
              {item.requires_acknowledgement && !item.acknowledged ? ' · 확인 필요' : ''}
            </Text>
            <Text style={styles.noticeTitle}>{item.title}</Text>
            {item.summary ? <Text numberOfLines={2} style={styles.summary}>{item.summary}</Text> : null}
          </Pressable>
        )) : null}
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
  notice: {
    gap: 8,
    minHeight: 118,
    justifyContent: 'center',
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d7ded8',
    backgroundColor: '#ffffff',
  },
  pressed: { opacity: 0.86 },
  meta: { color: '#4d705d', fontSize: 13, fontWeight: '800' },
  noticeTitle: { color: '#173f31', fontSize: 21, fontWeight: '900', lineHeight: 29 },
  summary: { color: '#56675e', fontSize: 15, lineHeight: 22 },
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
