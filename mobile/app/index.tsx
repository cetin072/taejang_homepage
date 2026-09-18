import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyNotices, sortNotices, type MobileNoticeListItem } from '@/src/features/notices/notice-api';
import { requestNativeNotificationPermission } from '@/src/notifications/native-notifications';
import { usePlatform } from '@/src/providers/platform-provider';

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function noticeTone(item: MobileNoticeListItem) {
  if (item.importance === 'urgent') return '긴급공지';
  if (item.importance === 'important') return '중요공지';
  if (item.requires_acknowledgement && !item.acknowledged) return '확인 필요';
  if (item.is_new) return '새 공지';
  return '공지';
}

export default function HomeScreen() {
  const { phase, session, error, config, client, reload, signIn, signOut } = usePlatform();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notices, setNotices] = useState<MobileNoticeListItem[]>([]);
  const [noticeError, setNoticeError] = useState('');
  const [noticeLoading, setNoticeLoading] = useState(false);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (nextError) {
      setMessage(messageOf(nextError, '처리 중 오류가 발생했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  async function refreshNotices() {
    if (!client || !session || noticeLoading) return;
    setNoticeLoading(true);
    setNoticeError('');
    try {
      setNotices(sortNotices(await loadMyNotices(client, 12)));
    } catch {
      setNoticeError('공지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setNoticeLoading(false);
    }
  }

  useEffect(() => {
    if (!session || !client) {
      setNotices([]);
      return;
    }
    void refreshNotices();
  }, [session?.access_token, client]);

  if (phase === 'loading') {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>태장 직원앱을 연결하고 있습니다.</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.title}>연결을 확인해주세요</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Button title="다시 시도" onPress={reload} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={styles.loginScroll}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.hero}>
              <Text style={styles.eyebrow}>태장 업무플랫폼</Text>
              <Text style={styles.title}>태장 직원앱</Text>
              <Text style={styles.body}>출퇴근과 중요공지를 가장 먼저, 간단하게 확인합니다.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>로그인</Text>
              <TextInput
                accessibilityLabel="이메일"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="이메일"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                accessibilityLabel="비밀번호"
                autoCapitalize="none"
                autoComplete="current-password"
                autoCorrect={false}
                placeholder="비밀번호"
                secureTextEntry
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => {
                  if (email.trim() && password) void run(() => signIn(email, password));
                }}
              />
              <Button
                title={busy ? '로그인 중…' : '로그인'}
                disabled={busy || !email.trim() || !password}
                onPress={() => void run(() => signIn(email, password))}
              />
              {message ? <Text style={styles.errorText}>{message}</Text> : null}
            </View>

            <Text style={styles.footer}>기존 태장 업무플랫폼 계정을 그대로 사용합니다.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  const priorityNotices = notices.slice(0, 3);
  const pendingCount = notices.filter(item => item.requires_acknowledgement && !item.acknowledged).length;

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.homeScroll}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{config?.environmentLabel || '태장 업무플랫폼'}</Text>
          <Text style={styles.title}>태장 직원앱</Text>
          <Text style={styles.body}>중요한 공지와 출퇴근을 가장 먼저 확인합니다.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>공지사항</Text>
              <Text style={styles.help}>
                {pendingCount > 0 ? '확인 필요한 공지 ' + pendingCount + '건' : '새로운 중요공지를 확인하세요.'}
              </Text>
            </View>
            <Button title="전체 보기" onPress={() => router.push('/notices')} />
          </View>

          {noticeLoading ? <ActivityIndicator /> : null}
          {noticeError ? <Text style={styles.errorText}>{noticeError}</Text> : null}
          {!noticeLoading && !noticeError && priorityNotices.length === 0 ? (
            <Text style={styles.help}>현재 확인할 공지가 없습니다.</Text>
          ) : null}

          {priorityNotices.map(item => {
            const needsAck = item.requires_acknowledgement && !item.acknowledged;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title + ' 공지 열기'}
                style={[styles.noticeCard, needsAck ? styles.noticeCardPending : null]}
                onPress={() => router.push({ pathname: '/notice/[id]', params: { id: item.id } })}
              >
                <View style={styles.noticeMetaRow}>
                  <Text style={[styles.noticeBadge, item.importance === 'urgent' ? styles.noticeUrgent : null]}>
                    {noticeTone(item)}
                  </Text>
                  {needsAck ? <Text style={styles.noticePending}>확인 필요</Text> : null}
                </View>
                <Text style={styles.noticeTitle}>{item.title}</Text>
                {item.summary ? <Text style={styles.noticeSummary}>{item.summary}</Text> : null}
              </Pressable>
            );
          })}

          <Button title="공지 새로고침" disabled={noticeLoading} onPress={() => void refreshNotices()} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>출퇴근</Text>
          <Text style={styles.help}>다음 단계에서 기존 태장 출퇴근 RPC와 GPS 계약을 그대로 연결합니다.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>중요공지 알림 준비</Text>
          <Text style={styles.body}>Android 네이티브 알림 권한과 중요공지 채널을 준비합니다.</Text>
          <Text style={styles.help}>회사 서버에서 보내는 Remote Push token 등록은 별도 다음 단계입니다.</Text>
          <Button
            title="알림 권한 준비"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const permission = await requestNativeNotificationPermission();
                setMessage(permission.granted
                  ? '알림 권한이 준비되었습니다.'
                  : '알림 권한이 허용되지 않았습니다. 휴대폰 설정에서 다시 허용할 수 있습니다.');
              })
            }
          />
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>로그인 상태</Text>
          <Text style={styles.body}>{session.user.email || '태장 직원 계정'}</Text>
          <Text style={styles.help}>앱을 종료했다 다시 열어도 SecureStore 기반 세션을 복원합니다.</Text>
          <Button title="로그아웃" disabled={busy} onPress={() => void run(signOut)} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: '#f4f7f4' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    backgroundColor: '#f4f7f4',
  },
  loginScroll: { flexGrow: 1, justifyContent: 'center', gap: 18, padding: 22 },
  homeScroll: { gap: 16, padding: 22 },
  hero: { gap: 7 },
  eyebrow: { color: '#35624d', fontSize: 13, fontWeight: '700' },
  title: { color: '#173f31', fontSize: 30, fontWeight: '800' },
  sectionTitle: { color: '#173f31', fontSize: 20, fontWeight: '800' },
  body: { color: '#344b40', fontSize: 16, lineHeight: 24 },
  help: { color: '#60746a', fontSize: 14, lineHeight: 21 },
  statusText: { color: '#344b40', fontSize: 16 },
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  noticeCard: {
    gap: 7,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f7f9f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  noticeCardPending: { borderWidth: 2, borderColor: '#dba640' },
  noticeMetaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  noticeBadge: { color: '#6b5a2c', fontSize: 13, fontWeight: '800' },
  noticeUrgent: { color: '#a12828' },
  noticePending: { color: '#8a5b00', fontSize: 13, fontWeight: '800' },
  noticeTitle: { color: '#173f31', fontSize: 18, lineHeight: 25, fontWeight: '800' },
  noticeSummary: { color: '#42574c', fontSize: 14, lineHeight: 21 },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#9eb2a5',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    color: '#173f31',
    fontSize: 16,
  },
  errorText: { color: '#9b2c2c', fontSize: 14, lineHeight: 20 },
  message: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#e6f0e9',
    color: '#214b35',
    fontSize: 14,
  },
  footer: { textAlign: 'center', color: '#6d7e75', fontSize: 13 },
});
