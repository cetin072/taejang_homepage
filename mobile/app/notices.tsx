import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyNotices, sortNotices, type MobileNoticeListItem } from '@/src/features/notices/notice-api';
import { usePlatform } from '@/src/providers/platform-provider';

function importanceLabel(value: MobileNoticeListItem['importance']) {
  if (value === 'urgent') return '긴급';
  if (value === 'important') return '중요';
  return '일반';
}

export default function NoticesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { phase, session, client } = usePlatform();
  const [items, setItems] = useState<MobileNoticeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function reload() {
    if (!client || !session) return;
    setLoading(true);
    setMessage('');
    try {
      setItems(sortNotices(await loadMyNotices(client, 100)));
    } catch {
      setMessage('공지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (phase !== 'ready') return;
    if (!session || !client) {
      setLoading(false);
      return;
    }
    void reload();
  }, [phase, session?.access_token, client]);

  if (phase === 'loading' || loading) {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" />
        <Text style={styles.body}>공지를 불러오고 있습니다.</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.title}>로그인이 필요합니다</Text>
        <Button title="직원앱 홈으로" onPress={() => router.replace('/')} />
      </View>
    );
  }

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Button title="← 직원앱 홈" onPress={() => router.back()} />
        <View>
          <Text style={styles.eyebrow}>태장 업무플랫폼</Text>
          <Text style={styles.title}>공지사항</Text>
          <Text style={styles.body}>긴급·중요·미확인 공지가 먼저 보입니다.</Text>
        </View>

        {message ? <Text style={styles.error}>{message}</Text> : null}
        {!items.length ? <Text style={styles.empty}>현재 확인할 공지가 없습니다.</Text> : null}

        {items.map(item => {
          const needsAck = item.requires_acknowledgement && !item.acknowledged;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.title + ' 공지 열기'}
              style={[styles.card, needsAck ? styles.cardNeedsAck : null]}
              onPress={() => router.push({ pathname: '/notice/[id]', params: { id: item.id } })}
            >
              <View style={styles.row}>
                <Text style={[styles.badge, item.importance === 'urgent' ? styles.badgeUrgent : null]}>
                  {importanceLabel(item.importance)}
                </Text>
                <Text style={styles.status}>
                  {needsAck ? '확인 필요' : item.acknowledged ? '확인 완료' : item.is_new ? '새 공지' : ''}
                </Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}
              {item.is_changed ? <Text style={styles.changed}>수정된 공지</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f7f4' },
  scroll: { gap: 14, padding: 22 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    backgroundColor: '#f4f7f4',
  },
  eyebrow: { color: '#35624d', fontSize: 13, fontWeight: '700' },
  title: { color: '#173f31', fontSize: 30, fontWeight: '800' },
  body: { color: '#344b40', fontSize: 16, lineHeight: 24 },
  card: {
    gap: 9,
    padding: 17,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  cardNeedsAck: { borderWidth: 2, borderColor: '#dba640' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  badge: { color: '#6b5a2c', fontSize: 13, fontWeight: '800' },
  badgeUrgent: { color: '#a12828' },
  status: { color: '#8a5b00', fontSize: 13, fontWeight: '800' },
  cardTitle: { color: '#173f31', fontSize: 19, lineHeight: 27, fontWeight: '800' },
  summary: { color: '#42574c', fontSize: 15, lineHeight: 22 },
  changed: { color: '#6d5c25', fontSize: 13, fontWeight: '700' },
  empty: {
    padding: 22,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    color: '#60746a',
    textAlign: 'center',
  },
  error: { color: '#9b2c2c', fontSize: 14, lineHeight: 20 },
});
