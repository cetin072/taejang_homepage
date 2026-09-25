import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyScheduleDetail, type ScheduleItem } from '@/src/features/schedules/schedule-api';
import { departureLabel, scheduleDateLabel, scheduleTypeLabel } from '@/src/features/schedules/schedule-format';
import { usePlatform } from '@/src/providers/platform-provider';

export default function ScheduleDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { client, session } = usePlatform();
  const [item, setItem] = useState<ScheduleItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!client || !session || !id) return;
    setLoading(true);
    setError('');
    try { setItem(await loadMyScheduleDetail(client, id)); }
    catch { setError('일정 상세를 불러오지 못했습니다. 다시 눌러주세요.'); }
    finally { setLoading(false); }
  }, [client, session, id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => { if (nextState === 'active') void load(); });
    return () => subscription.remove();
  }, [load]);

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable accessibilityRole="button" accessibilityLabel="내 일정으로 돌아가기" onPress={() => router.replace('/schedules')} style={styles.back}><Text style={styles.backText}>← 내 일정</Text></Pressable>
        {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.help}>일정을 확인하고 있습니다.</Text></View> : null}
        {!loading && error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{error}</Text><Text style={styles.retryText}>다시 확인</Text></Pressable> : null}
        {!loading && !error && item ? <>
          <Text style={item.status === 'cancelled' ? styles.cancelled : styles.meta}>{item.status === 'cancelled' ? '취소된 일정' : scheduleTypeLabel(item)}{item.is_changed ? ' · 변경됨' : ''}</Text>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.time}>{scheduleDateLabel(item)}</Text>
          <View style={styles.card}>
            <Text style={styles.easy}>{item.easy_text}</Text>
            {item.location ? <Text style={styles.detail}>장소 · {item.location}</Text> : null}
            {item.manager_label ? <Text style={styles.detail}>담당 · {item.manager_label}</Text> : null}
            {item.materials ? <Text style={styles.detail}>준비물 · {item.materials}</Text> : null}
            {item.transport_method ? <Text style={styles.detail}>이동 · {item.transport_method}</Text> : null}
            {departureLabel(item.vehicle_departure_at) ? <Text style={styles.detail}>차량 출발 · {departureLabel(item.vehicle_departure_at)}</Text> : null}
          </View>
        </> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f4ed' }, scroll: { gap: 14, padding: 22, paddingBottom: 40 }, back: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center' }, backText: { color: '#35624d', fontSize: 16, fontWeight: '800' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 }, help: { color: '#60746a', fontSize: 15, lineHeight: 22 }, retry: { gap: 8, padding: 16, borderRadius: 16, backgroundColor: '#fff0ed' }, retryText: { color: '#8b2f2f', fontSize: 15, fontWeight: '800', lineHeight: 22, textAlign: 'center' },
  meta: { color: '#35624d', fontSize: 14, fontWeight: '900' }, cancelled: { color: '#8b2f2f', fontSize: 14, fontWeight: '900' }, title: { color: '#173f31', fontSize: 31, fontWeight: '900', lineHeight: 40 }, time: { color: '#43584d', fontSize: 17, fontWeight: '800', lineHeight: 25 },
  card: { gap: 12, padding: 19, borderRadius: 18, borderWidth: 1, borderColor: '#d7ded8', backgroundColor: '#ffffff' }, easy: { color: '#173f31', fontSize: 18, fontWeight: '800', lineHeight: 28 }, detail: { color: '#43584d', fontSize: 15, fontWeight: '700', lineHeight: 23 },
});
