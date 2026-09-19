import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { loadMyNotices, noticeDeepLinkPath, type NoticeSummary } from './notice-api';
import { usePlatform } from '@/src/providers/platform-provider';

export function NoticeHomeAction({ minHeight = 164 }: { minHeight?: number }) {
  const router = useRouter();
  const { client, session } = usePlatform();
  const [items, setItems] = useState<NoticeSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    try {
      setItems(await loadMyNotices(client, 4));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    void load();
  }, [load]);

  function open() {
    if (items.length === 1) {
      router.push(noticeDeepLinkPath(items[0].id));
      return;
    }
    router.push('/notices');
  }

  const unread = items.filter(item => item.is_new || (item.requires_acknowledgement && !item.acknowledged)).length;
  const subtitle = loading
    ? '확인 중…'
    : items.length === 0
      ? '현재 공지 확인'
      : unread > 0
        ? `새로 확인할 공지 ${unread}건`
        : items.length === 1
          ? '공지 1건'
          : `공지 ${items.length}건`;

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
