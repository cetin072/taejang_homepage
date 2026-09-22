import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  acknowledgeMyNotice,
  loadMyNoticeDetail,
  type NoticeDetail,
} from '@/src/features/notices/notice-api';
import { usePlatform } from '@/src/providers/platform-provider';

function importanceLabel(value: NoticeDetail['importance']) {
  if (value === 'urgent') return '긴급공지';
  if (value === 'important') return '중요공지';
  return '공지';
}

export default function NoticeDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const noticeId = typeof params.id === 'string' ? params.id : '';
  const { client, session } = usePlatform();
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackBusy, setAckBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!client || !session || !noticeId) return;
    setLoading(true);
    setError('');
    try {
      setNotice(await loadMyNoticeDetail(client, noticeId));
    } catch {
      setError('이 공지를 지금 불러올 수 없습니다. 다시 확인해주세요.');
    } finally {
      setLoading(false);
    }
  }, [client, session, noticeId]);

  useEffect(() => {
    if (!client || !session || !noticeId) return;
    void load();
  }, [client, session, noticeId, load]);

  async function acknowledge() {
    if (!client || !notice || ackBusy) return;
    setAckBusy(true);
    setMessage('');
    try {
      await acknowledgeMyNotice(client, notice.id, notice.version_no);
      setNotice(await loadMyNoticeDetail(client, notice.id));
      setMessage('공지 내용을 확인했습니다.');
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : '공지 확인을 저장하지 못했습니다.');
    } finally {
      setAckBusy(false);
    }
  }

  if (!session) {
    return (
      <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.title}>로그인이 필요합니다</Text>
        <Button title="홈으로" onPress={() => router.replace('/')} />
      </View>
    );
  }

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Button title="← 공지 목록으로" onPress={() => router.back()} />

        {loading ? (
          <View style={styles.centerInline}>
            <ActivityIndicator />
            <Text style={styles.help}>공지 내용을 불러오고 있습니다.</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
            <Button title="다시 시도" onPress={() => void load()} />
          </View>
        ) : null}

        {!loading && notice ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>{importanceLabel(notice.importance)}</Text>
            <Text style={styles.title}>{notice.title}</Text>
            <Text style={styles.body}>{notice.body_easy}</Text>

            {notice.media?.length ? (
              <View style={styles.gallery}>
                {notice.media.map(item => (
                  item.signed_url ? (
                    <Image
                      key={item.id}
                      accessibilityLabel={item.alt_text || '공지 사진'}
                      source={{ uri: item.signed_url }}
                      style={styles.photo}
                    />
                  ) : null
                ))}
              </View>
            ) : null}

            {notice.location ? <Text style={styles.meta}>장소 · {notice.location}</Text> : null}
            {notice.materials ? <Text style={styles.meta}>준비물 · {notice.materials}</Text> : null}

            {notice.requires_acknowledgement ? (
              notice.acknowledged ? (
                <Text style={styles.acknowledged}>✓ 내용을 확인했습니다.</Text>
              ) : (
                <Button
                  title={ackBusy ? '저장 중…' : '내용 확인했습니다'}
                  disabled={ackBusy}
                  onPress={() => void acknowledge()}
                />
              )
            ) : null}

            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f7f4' },
  scroll: { gap: 16, padding: 20 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: '#f4f7f4',
  },
  centerInline: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  card: {
    gap: 14,
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  eyebrow: { color: '#35624d', fontSize: 13, fontWeight: '800' },
  title: { color: '#173f31', fontSize: 28, fontWeight: '800', lineHeight: 36 },
  body: { color: '#344b40', fontSize: 17, lineHeight: 27 },
  gallery: { gap: 12 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: '#eef2ef' },
  meta: { color: '#60746a', fontSize: 14, lineHeight: 21 },
  help: { color: '#60746a', fontSize: 14 },
  error: { color: '#9b2c2c', fontSize: 15, lineHeight: 22 },
  acknowledged: { color: '#35624d', fontSize: 15, fontWeight: '800' },
  message: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#e6f0e9',
    color: '#214b35',
    fontSize: 14,
  },
});
