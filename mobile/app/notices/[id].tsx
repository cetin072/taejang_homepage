import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  acknowledgeMyNotice,
  loadMyNoticeDetail,
  loadNoticeMediaUrl,
  type NoticeDetail,
  type NoticeMediaItem,
} from '@/src/features/notices/notice-api';
import { cacheNoticeMediaUrl, getCachedNoticeMediaUrl } from '@/src/features/notices/notice-cache';
import { noticeReadStore } from '@/src/features/notices/notice-read-state';
import { usePlatform } from '@/src/providers/platform-provider';

function importanceLabel(value: NoticeDetail['importance']) {
  if (value === 'urgent') return '긴급공지';
  if (value === 'important') return '중요공지';
  return '공지';
}

function NoticePhoto({
  client,
  userId,
  item,
}: {
  client: NonNullable<ReturnType<typeof usePlatform>['client']>;
  userId: string;
  item: NoticeMediaItem;
}) {
  const [signedUrl, setSignedUrl] = useState(() => getCachedNoticeMediaUrl(userId, item.id));
  const [loading, setLoading] = useState(() => !getCachedNoticeMediaUrl(userId, item.id));

  useEffect(() => {
    let active = true;
    const cached = getCachedNoticeMediaUrl(userId, item.id);
    setSignedUrl(cached);
    setLoading(!cached);
    if (cached) return () => { active = false; };

    void loadNoticeMediaUrl(client, item).then(url => {
      if (!active) return;
      if (url) cacheNoticeMediaUrl(userId, item.id, url);
      setSignedUrl(url);
      setLoading(false);
    });
    return () => { active = false; };
  }, [client, item, userId]);

  if (signedUrl) {
    return (
      <Image
        accessibilityLabel={item.alt_text || '공지 사진'}
        resizeMethod="resize"
        source={{ uri: signedUrl, cache: 'force-cache' }}
        style={styles.photo}
      />
    );
  }

  return (
    <View style={styles.photoPlaceholder}>
      {loading ? <ActivityIndicator /> : null}
      <Text style={styles.photoHelp}>{loading ? '사진을 준비하고 있습니다.' : '사진을 불러오지 못했습니다.'}</Text>
    </View>
  );
}

export default function NoticeDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const noticeId = typeof params.id === 'string' ? params.id : '';
  const { client, session } = usePlatform();
  const request = useRef(0);
  const userId = session?.user.id;
  const [noticeOwner, setNoticeOwner] = useState('');
  const [readError, setReadError] = useState('');
  const [readRetry, setReadRetry] = useState(0);
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackBusy, setAckBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!client || !userId || !noticeId) return;
    const token = ++request.current;
    setLoading(true);
    setAckBusy(false);
    setNotice(null);
    setReadError('');
    setMessage('');
    setError('');
    try {
      const fresh = await loadMyNoticeDetail(client, noticeId);
      if (token !== request.current) return;
      setNoticeOwner(`${userId}:${noticeId}`);
      setNotice(fresh);
    } catch {
      if (token !== request.current) return;
      setError('이 공지를 지금 불러올 수 없습니다. 다시 확인해주세요.');
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [client, userId, noticeId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { request.current++; };
  }, [load]));

  // Runs after the successful text render. Photos load independently.
  useEffect(() => {
    if (loading || error || !notice || !userId || notice.requires_acknowledgement
      || noticeOwner !== `${userId}:${noticeId}`) return;
    let active = true;
    void noticeReadStore.markRead(userId, notice).then(() => {
      if (active) setReadError('');
    }).catch(() => {
      if (active) setReadError('읽음 상태를 저장하지 못했습니다. 다시 시도해주세요.');
    });
    return () => { active = false; };
  }, [notice, noticeOwner, noticeId, userId, loading, error, readRetry]);

  async function acknowledge() {
    if (!client || !notice || ackBusy || noticeOwner !== `${userId}:${noticeId}`) return;
    const token = request.current;
    setAckBusy(true);
    setMessage('');
    try {
      await acknowledgeMyNotice(client, notice.id, notice.version_no);
      const fresh = await loadMyNoticeDetail(client, notice.id);
      if (token !== request.current) return;
      setNotice(fresh);
      setMessage('공지 내용을 확인했습니다.');
    } catch (nextError) {
      if (token !== request.current) return;
      setMessage(nextError instanceof Error ? nextError.message : '공지 확인을 저장하지 못했습니다.');
    } finally {
      if (token === request.current) setAckBusy(false);
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

        {!loading && !error && notice && noticeOwner === `${userId}:${noticeId}` ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>{importanceLabel(notice.importance)}</Text>
            <Text style={styles.title}>{notice.title}</Text>
            <Text style={styles.body}>{notice.body_easy}</Text>

            {notice.media?.length && client ? (
              <View style={styles.gallery}>
                {notice.media.map(item => (
                  <NoticePhoto key={item.id} client={client} userId={session.user.id} item={item} />
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

            {readError ? <View><Text style={styles.error}>{readError}</Text><Button title="읽음 저장 다시 시도" onPress={() => setReadRetry(value => value + 1)} /></View> : null}
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
  photoPlaceholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 20,
    borderRadius: 14,
    backgroundColor: '#eef2ef',
  },
  photoHelp: { color: '#60746a', fontSize: 14, fontWeight: '700', textAlign: 'center' },
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
