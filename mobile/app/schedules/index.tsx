import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyUpcomingSchedules, scheduleDeepLinkPath, type ScheduleItem } from '@/src/features/schedules/schedule-api';
import { scheduleDateLabel, scheduleTypeLabel } from '@/src/features/schedules/schedule-format';
import { usePlatform } from '@/src/providers/platform-provider';

export default function ScheduleListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session } = usePlatform();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    setError('');
    try {
      setItems(await loadMyUpcomingSchedules(client, 20));
    } catch {
      setError('일정을 불러오지 못했습니다. 인터넷을 확인한 뒤 다시 눌러주세요.');
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

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable accessibilityRole="button" accessibilityLabel="홈으로 돌아가기" onPress={() => router.replace('/')} style={styles.back}>
          <Text style={styles.backText}>← 홈</Text>
        </Pressable>
        <Text style={styles.title}>내 일정</Text>
        <Text style={styles.help}>가까운 일정만 시간순으로 보여드립니다.</Text>

        {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.help}>일정을 불러오고 있습니다.</Text></View> : null}
        {!loading && error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{error}</Text><Text style={styles.retryText}>다시 확인</Text></Pressable> : null}
        {!loading && !error && items.length === 0 ? <Text style={styles.empty}>가까운 일정이 없습니다.</Text> : null}

        {!loading && !error ? items.map(item => (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title} 일정 열기`} onPress={() => router.push(scheduleDeepLinkPath(item.id))} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
            <Text style={item.status === 'cancelled' ? styles.cancelled : styles.meta}>{item.status === 'cancelled' ? '취소된 일정' : scheduleTypeLabel(item)}{item.is_changed ? ' · 변경됨' : ''}</Text>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.detail}>{scheduleDateLabel(item)}</Text>
            {item.location ? <Text style={styles.detail}>장소 · {item.location}</Text> : null}
          </Pressable>
        )) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f4ed' }, scroll: { gap: 14, padding: 22, paddingBottom: 40 },
  back: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center' }, backText: { color: '#35624d', fontSize: 16, fontWeight: '800' },
  title: { color: '#173f31', fontSize: 32, fontWeight: '900' }, help: { color: '#60746a', fontSize: 15, lineHeight: 22 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 }, empty: { padding: 18, borderRadius: 16, backgroundColor: '#ffffff', color: '#43584d', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  retry: { gap: 8, padding: 16, borderRadius: 16, backgroundColor: '#fff0ed' }, retryText: { color: '#8b2f2f', fontSize: 15, fontWeight: '800', lineHeight: 22, textAlign: 'center' },
  card: { gap: 7, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#d7ded8', backgroundColor: '#ffffff' }, pressed: { opacity: 0.86 },
  meta: { color: '#35624d', fontSize: 13, fontWeight: '900' }, cancelled: { color: '#8b2f2f', fontSize: 13, fontWeight: '900' }, itemTitle: { color: '#173f31', fontSize: 22, fontWeight: '900', lineHeight: 30 }, detail: { color: '#43584d', fontSize: 15, fontWeight: '700', lineHeight: 22 },
});
