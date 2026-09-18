import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  Button,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoticeListCard } from '@/src/features/notices/notice-list-card';
import { registerCurrentPushDevice } from '@/src/notifications/push-registration';
import { usePlatform } from '@/src/providers/platform-provider';

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function HomeScreen() {
  const { phase, session, error, config, client, reload, signIn, signOut } = usePlatform();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

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

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.homeScroll}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{config?.environmentLabel || '태장 업무플랫폼'}</Text>
          <Text style={styles.title}>직원앱 준비 완료</Text>
          <Text style={styles.body}>
            로그인과 세션 복원이 연결되었습니다. 지금은 공지를 확인할 수 있고, 다음 단계에서 출퇴근과 원격 Push를 연결합니다.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>로그인 상태</Text>
          <Text style={styles.body}>{session.user.email || '태장 직원 계정'}</Text>
          <Text style={styles.help}>앱을 종료했다 다시 열어도 SecureStore 기반 세션을 복원합니다.</Text>
        </View>

        <NoticeListCard />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>중요공지 알림 준비</Text>
          <Text style={styles.body}>Android 네이티브 알림 권한과 중요공지 채널을 먼저 준비합니다.</Text>
          <Text style={styles.help}>알림 권한을 허용하면 이 기기를 태장 중요공지 Push 수신 기기로 등록합니다.</Text>
          <Button
            title="알림 권한 준비"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                if (!client) throw new Error('알림 연결이 아직 준비되지 않았습니다.');
                const result = await registerCurrentPushDevice(client, { requestPermission: true });
                setMessage(
                  result.status === 'registered'
                    ? '중요공지 Push 알림이 준비되었습니다.'
                    : result.status === 'project_not_configured'
                      ? 'Push 프로젝트 설정이 아직 연결되지 않았습니다.'
                      : result.status === 'physical_device_required'
                        ? '실제 Android 기기에서 Push 알림을 준비할 수 있습니다.'
                        : '알림 권한이 필요합니다. 휴대폰 설정에서 다시 허용할 수 있습니다.',
                );
              })
            }
          />
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Button title="로그아웃" disabled={busy} onPress={() => void run(signOut)} />
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
