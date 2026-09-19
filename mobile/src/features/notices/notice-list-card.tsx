import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadMyNotices, noticeDeepLinkPath, type NoticeSummary } from './notice-api';
import { usePlatform } from '@/src/providers/platform-provider';

function importanceLabel(value: NoticeSummary['importance']) {
  if (value === 'urgent') return '긴급';
  if (value === 'important') return '중요';
  return '공지';
}

function noticeMeta(item: NoticeSummary) {
  const markers = [
    importanceLabel(item.importance),
    item.is_new ? '새 공지' : '',
    item.is_changed ? '수정됨' : '',
    item.requires_acknowledgement && !item.acknowledged ? '확인 필요' : '',
  ].filter(Boolean);
  return markers.join(' · ');
}

export function NoticeListCard() {
  const router = useRouter();
  const { client, session } = usePlatform();
  const [items, setItems] = useState<NoticeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    setError('');
    try {
      setItems(await loadMyNotices(client, 12));
    } catch {
      setError('공지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    if (!client || !session) return;
    void refresh();
  }, [client, session, refresh]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>회사 공지</Text>
          <Text style={styles.title}>꼭 확인하세요</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.refreshButton}>
          <Text style={styles.refreshText}>새로고침</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.help}>공지를 불러오고 있습니다.</Text>
        </View>
      ) : null}

      {!loading && error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !error && !items.length ? (
        <Text style={styles.help}>현재 확인할 공지가 없습니다.</Text>
      ) : null}

      {!loading && !error ? items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.title} 공지 열기`}
          style={[
            styles.notice,
            item.requires_acknowledgement && !item.acknowledged ? styles.noticeUnread : null,
          ]}
          onPress={() => router.push(noticeDeepLinkPath(item.id))}
        >
          <Text style={styles.meta}>{noticeMeta(item)}</Text>
          <Text style={styles.noticeTitle}>{item.title}</Text>
          {item.summary ? <Text numberOfLines={2} style={styles.summary}>{item.summary}</Text> : null}
          {item.requires_acknowledgement ? (
            <Text style={item.acknowledged ? styles.acknowledged : styles.needsAck}>
              {item.acknowledged ? '✓ 확인했습니다' : '내용 확인이 필요합니다'}
            </Text>
          ) : null}
        </Pressable>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: '#35624d', fontSize: 13, fontWeight: '700' },
  title: { color: '#173f31', fontSize: 20, fontWeight: '800' },
  refreshButton: { paddingHorizontal: 10, paddingVertical: 8 },
  refreshText: { color: '#35624d', fontWeight: '700' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notice: {
    gap: 6,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f7faf7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d7e3da',
  },
  noticeUnread: { borderColor: '#6d987d', backgroundColor: '#f0f7f2' },
  meta: { color: '#4c6c5b', fontSize: 12, fontWeight: '700' },
  noticeTitle: { color: '#173f31', fontSize: 17, fontWeight: '800', lineHeight: 24 },
  summary: { color: '#455a50', fontSize: 14, lineHeight: 20 },
  needsAck: { color: '#9a5c09', fontSize: 13, fontWeight: '800' },
  acknowledged: { color: '#35624d', fontSize: 13, fontWeight: '800' },
  help: { color: '#60746a', fontSize: 14, lineHeight: 21 },
  error: { color: '#9b2c2c', fontSize: 14, lineHeight: 20 },
});
