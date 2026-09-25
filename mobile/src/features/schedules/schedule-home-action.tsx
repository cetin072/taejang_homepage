import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { scheduleDateLabel } from './schedule-format';
import { loadMyUpcomingSchedules, type ScheduleItem } from './schedule-api';
import { usePlatform } from '@/src/providers/platform-provider';

export function ScheduleHomeAction({ minHeight = 164 }: { minHeight?: number }) {
  const router = useRouter();
  const { client, session } = usePlatform();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    try {
      setItems(await loadMyUpcomingSchedules(client, 1));
      setLoadFailed(false);
    } catch {
      setItems([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void load();
    });
    return () => subscription.remove();
  }, [load]);

  const first = items[0];
  const subtitle = loading
    ? '확인 중…'
    : loadFailed
      ? '불러오지 못했습니다. 다시 확인해주세요'
      : first
        ? `${scheduleDateLabel(first)} · ${first.title}`
        : '가까운 일정이 없습니다';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="내 일정 열기"
      onPress={() => router.push('/schedules')}
      style={({ pressed }) => [styles.action, { minHeight }, pressed ? styles.pressed : null]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>내 일정</Text>
        <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 24, borderRadius: 28, borderWidth: 1, borderColor: '#c6d2c9', backgroundColor: '#ffffff' },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  copy: { alignItems: 'center', gap: 10 },
  title: { color: '#173f31', fontSize: 31, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: '#60746a', fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
