import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadMyNotices, noticeDeepLinkPath, type NoticeSummary } from './notice-api';
import { cacheNotices, getCachedNotices } from './notice-cache';
import { usePlatform } from '@/src/providers/platform-provider';

export function NoticeHomeAction({ minHeight = 164 }: { minHeight?: number }) {
  const router = useRouter();
  const { client, session } = usePlatform();
  const userId = session?.user.id;
  const [items, setItems] = useState<NoticeSummary[]>(() => userId ? getCachedNotices(userId, 4) : []);
  const [cacheUserId, setCacheUserId] = useState(userId);
  const [loading, setLoading] = useState(() => !userId || getCachedNotices(userId, 4).length === 0);

  const load = useCallback(async () => {
    if (!client || !session) return;
    const cached = getCachedNotices(session.user.id, 4);
    setCacheUserId(session.user.id);
    setItems(cached);
    setLoading(cached.length === 0);
    try {
      const fresh = await loadMyNotices(client, 4);
      setItems(cacheNotices(session.user.id, fresh, 4));
    } catch {
      if (cached.length === 0) setItems([]);
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

  function open() {
    if (visibleItems.length === 1) {
      router.push(noticeDeepLinkPath(visibleItems[0].id));
      return;
    }
    router.push('/notices');
  }

  const visibleItems = cacheUserId === userId ? items : [];
  const unread = visibleItems.filter(item => item.is_new || (item.requires_acknowledgement && !item.acknowledged)).length;
  const subtitle = loading
    ? '확인 중…'
    : visibleItems.length === 0
      ? '현재 공지 확인'
      : unread > 0
        ? `새로 확인할 공지 ${unread}건`
        : visibleItems.length === 1
          ? '공지 1건'
          : `공지 ${visibleItems.length}건`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="공지사항 열기"
      onPress={open}
      style={({ pressed }) => [
        styles.action,
        { minHeight },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>공지사항</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {unread > 0 ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  copy: { alignItems: 'center', gap: 10 },
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
