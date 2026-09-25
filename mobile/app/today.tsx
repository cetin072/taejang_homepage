import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyTodayWork, type TodayWork } from '@/src/features/today/today-work-api';
import { usePlatform } from '@/src/providers/platform-provider';

function formatTime(value: string | null) {
  return value ? value.slice(0, 5) : '';
}

function timeLabel(item: TodayWork) {
  const start = formatTime(item.start_time);
  const end = formatTime(item.end_time);
  return start && end ? `${start} – ${end}` : start || end || '';
}

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session } = usePlatform();
  const [tasks, setTasks] = useState<TodayWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    setError('');
    try {
      const board = await loadMyTodayWork(client);
      setTasks(board.tasks.filter(task => task.status === 'published'));
    } catch {
      setError('오늘 할 일을 불러오지 못했습니다. 인터넷을 확인한 뒤 다시 눌러주세요.');
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

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable accessibilityRole="button" accessibilityLabel="홈으로 돌아가기" onPress={() => router.replace('/')} style={styles.back}>
          <Text style={styles.backText}>← 홈</Text>
        </Pressable>
        <Text style={styles.title}>오늘 할 일</Text>
        <Text style={styles.help}>오늘 해야 할 일을 확인한 뒤 현장 안내에 따라주세요.</Text>

        {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.help}>오늘 할 일을 불러오고 있습니다.</Text></View> : null}
        {!loading && error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{error}</Text><Text style={styles.retryText}>다시 확인</Text></Pressable> : null}
        {!loading && !error && tasks.length === 0 ? <Text style={styles.empty}>오늘은 안내된 업무가 없습니다.</Text> : null}

        {!loading && !error ? tasks.map((task, index) => (
          <View key={task.id} style={styles.card}>
            <Text style={styles.order}>{index + 1}번째 업무</Text>
            <Text style={styles.taskTitle}>{task.title}</Text>
            {timeLabel(task) ? <Text style={styles.meta}>{timeLabel(task)}</Text> : null}
            {task.location ? <Text style={styles.meta}>장소 · {task.location}</Text> : null}
            {task.lead?.name ? <Text style={styles.meta}>담당 · {task.lead.name}</Text> : null}
            {task.preparation ? <Text style={styles.detail}>준비물 · {task.preparation}</Text> : null}
            {task.caution ? <Text style={styles.detail}>주의 · {task.caution}</Text> : null}
          </View>
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
  title: { color: '#173f31', fontSize: 32, fontWeight: '900' },
  help: { color: '#60746a', fontSize: 15, lineHeight: 22 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  empty: { padding: 18, borderRadius: 16, backgroundColor: '#ffffff', color: '#43584d', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  retry: { gap: 8, padding: 16, borderRadius: 16, backgroundColor: '#fff0ed' },
  retryText: { color: '#8b2f2f', fontSize: 15, fontWeight: '800', lineHeight: 22, textAlign: 'center' },
  card: { gap: 7, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#d7ded8', backgroundColor: '#ffffff' },
  order: { color: '#35624d', fontSize: 13, fontWeight: '900' },
  taskTitle: { color: '#173f31', fontSize: 22, fontWeight: '900', lineHeight: 30 },
  meta: { color: '#43584d', fontSize: 15, fontWeight: '700', lineHeight: 22 },
  detail: { color: '#52685d', fontSize: 14, lineHeight: 21 },
});
