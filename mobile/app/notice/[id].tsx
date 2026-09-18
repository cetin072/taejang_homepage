import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  acknowledgeMyNotice,
  loadMyNoticeDetail,
  safeNoticeHttpsUrl,
  type MobileNoticeDetail,
} from '@/src/features/notices/notice-api';
import { usePlatform } from '@/src/providers/platform-provider';

function importanceLabel(value: MobileNoticeDetail['importance']) {
  if (value === 'urgent') return '긴급공지';
  if (value === 'important') return '중요공지';
  return '공지';
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export default function NoticeDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const noticeId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { phase, session, client } = usePlatform();

  const [notice, setNotice] = useState<MobileNoticeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function reload() {
    if (!client || !session || !noticeId) return;
    setLoading(true);
    setMessage('');
    try {
      setNotice(await loadMyNoticeDetail(client, noticeId));
    } catch {
      setNotice(null);
      setMessage('이 공지를 지금 볼 수 없습니다. 새로고침하거나 담당자에게 확인해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (phase !== 'ready') return;
    if (!session || !client || !noticeId) {
      setLoading(false);
      return;
    }
    void reload();
  }, [phase, session?.access_token, client, noticeId]);

  async function acknowledge() {
    if (!client || !notice || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await acknowledgeMyNotice(client, notice.id, notice.version_no);
      setNotice({ ...notice, acknowledged: true, acknowledged_at: new Date().toISOString() });
      setMessage('공지 내용을 확인했습니다.');
    } catch (error) {
      if (error instanceof Error && error.message === 'NOTICE_VERSION_CHANGED') {
        setMessage('공지가 수정되었습니다. 최신 내용을 다시 불러왔습니다.');
        await reload();
      } else {
        setMessage('공지 확인을 저장하지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setBusy(false);
    }
  }

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

  if (!notice) {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.title}>공지를 확인할 수 없습니다</Text>
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <Button title="직원앱 홈으로" onPress={() => router.replace('/')} />
      </View>
    );
  }

  const relatedUrl = safeNoticeHttpsUrl(notice.related_link_url);
  const effectiveRange = notice.effective_start_date
    ? dateLabel(notice.effective_start_date) + (notice.effective_end_date ? ' ~ ' + dateLabel(notice.effective_end_date) : '')
    : '별도 기간 없음';

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Button title="← 공지 목록" onPress={() => router.back()} />

        <View style={styles.card}>
          <Text style={[styles.badge, notice.importance === 'urgent' ? styles.badgeUrgent : null]}>
            {importanceLabel(notice.importance)}
          </Text>
          <Text style={styles.title}>{notice.title}</Text>
          <Text style={styles.meta}>최종 수정 {dateLabel(notice.updated_at)}</Text>
          <Text style={styles.body}>{notice.body_easy}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>공지 정보</Text>
          <Text style={styles.body}>공지 종류: {notice.notice_kind || '일반'}</Text>
          <Text style={styles.body}>적용기간: {effectiveRange}</Text>
          {notice.location ? <Text style={styles.body}>장소: {notice.location}</Text> : null}
          {notice.materials ? <Text style={styles.body}>준비물: {notice.materials}</Text> : null}
        </View>

        {relatedUrl && notice.related_link_label ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>관련 자료</Text>
            <Button title={notice.related_link_label} onPress={() => void Linking.openURL(relatedUrl)} />
          </View>
        ) : null}

        {notice.requires_acknowledgement ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>확인 필요</Text>
            <Text style={styles.body}>
              {notice.acknowledged ? '이 공지의 현재 버전을 확인했습니다.' : '내용을 확인한 뒤 아래 버튼을 눌러 주세요.'}
            </Text>
            {!notice.acknowledged ? (
              <Button title={busy ? '저장 중…' : '확인했습니다'} disabled={busy} onPress={() => void acknowledge()} />
            ) : null}
          </View>
        ) : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f7f4' },
  scroll: { gap: 16, padding: 22 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    backgroundColor: '#f4f7f4',
  },
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  badge: { alignSelf: 'flex-start', color: '#9a5d00', fontWeight: '800' },
  badgeUrgent: { color: '#a12828' },
  title: { color: '#173f31', fontSize: 28, lineHeight: 38, fontWeight: '800' },
  sectionTitle: { color: '#173f31', fontSize: 19, fontWeight: '800' },
  meta: { color: '#6d7e75', fontSize: 13 },
  body: { color: '#344b40', fontSize: 16, lineHeight: 25 },
  message: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#e6f0e9',
    color: '#214b35',
    fontSize: 14,
  },
  error: { color: '#9b2c2c', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
