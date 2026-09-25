import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadMyTodayWork, type TodayWork } from './today-work-api';
import { usePlatform } from '@/src/providers/platform-provider';

function publishedTasks(tasks: TodayWork[]) {
  return tasks.filter(task => task.status === 'published');
}

export function TodayWorkAction({ minHeight = 164 }: { minHeight?: number }) {
  const router = useRouter();
  const { client, session } = usePlatform();
  const [tasks, setTasks] = useState<TodayWork[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    try {
      const board = await loadMyTodayWork(client);
      setTasks(publishedTasks(board.tasks));
    } catch {
      setTasks([]);
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

  const first = tasks[0];
  const subtitle = loading
    ? '확인 중…'
    : tasks.length === 0
      ? '오늘은 안내된 업무가 없습니다'
      : tasks.length === 1
        ? first.title
        : `${first.title} 외 ${tasks.length - 1}건`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="오늘 할 일 열기"
      onPress={() => router.push('/today')}
      style={({ pressed }) => [styles.action, { minHeight }, pressed ? styles.pressed : null]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>오늘 할 일</Text>
        <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text>
      </View>
      {tasks.length > 0 ? <Text style={styles.count}>{tasks.length}</Text> : null}
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
  copy: { flex: 1, alignItems: 'center', gap: 10 },
  title: { color: '#173f31', fontSize: 31, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: '#60746a', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  count: {
    position: 'absolute',
    top: 19,
    right: 22,
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#e6f0e9',
    color: '#173f31',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
});
