import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { AttendanceCard } from '@/src/features/attendance/attendance-card';
import { OfficialChannelsFooter } from '@/src/features/common/official-channels-footer';
import { NoticeHomeAction } from '@/src/features/notices/notice-home-action';
import { getApiBaseUrl } from '@/src/platform/config';
import { usePlatform } from '@/src/providers/platform-provider';

type AccessRole = { code?: string; name?: string };
type AccessContext = {
  account_status?: string;
  display_name?: string | null;
  capabilities?: string[];
  actual_roles?: AccessRole[];
  effective_roles?: AccessRole[];
};

const WORK_PLATFORM_CAPABILITIES = new Set([
  'promotion.write',
  'promotion.review_lead',
  'promotion.review_operations',
  'attendance.admin_view',
  'employee.view_all',
  'employee.create',
  'employee.onboard',
  'account.view_management',
  'task.manage',
  'schedule.manage',
  'notice.manage',
  'homepage.draft',
  'homepage.review',
]);

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PrimaryButton({
  title,
  subtitle,
  onPress,
  secondary = false,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        secondary ? styles.platformAction : null,
        pressed ? styles.actionPressed : null,
      ]}
    >
      <Text style={[styles.primaryActionTitle, secondary ? styles.platformActionTitle : null]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.primaryActionSubtitle, secondary ? styles.platformActionSubtitle : null]}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function HomeScreen() {
  const { phase, session, error, client, reload, signIn, signUpEmployee, signOut } = usePlatform();
  const insets = useSafeAreaInsets();
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupHiredOn, setSignupHiredOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [signupComplete, setSignupComplete] = useState(false);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const refreshAccess = useCallback(async () => {
    if (!client || !session) return;
    setAccessLoading(true);
    setAccessError('');
    try {
      const { data, error: contextError } = await client.rpc('get_my_access_context_v2');
      if (contextError) throw contextError;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('계정 상태를 확인하지 못했습니다.');
      }
      setAccess(data as AccessContext);
    } catch (nextError) {
      setAccessError(messageOf(nextError, '계정 상태를 확인하지 못했습니다.'));
    } finally {
      setAccessLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    if (!session) {
      setAccess(null);
      setSettingsOpen(false);
      return;
    }
    void refreshAccess();
  }, [session, refreshAccess]);

  const capabilities = useMemo(() => new Set(access?.capabilities || []), [access?.capabilities]);
  const canRecordAttendance = capabilities.has('attendance.self_record');
  const canOpenWorkPlatform = [...capabilities].some(capability => WORK_PLATFORM_CAPABILITIES.has(capability));

  if (phase === 'loading') {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.brandMark}>泰張</Text>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>태장을 연결하고 있습니다.</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.brandMark}>泰張</Text>
        <Text style={styles.title}>연결을 확인해주세요</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.smallButton} onPress={reload}>
          <Text style={styles.smallButtonText}>다시 시도</Text>
        </Pressable>
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
            <View style={styles.loginBrand}>
              <Text style={styles.brandMark}>泰張</Text>
              <Text style={styles.title}>태장</Text>
              <Text style={styles.eyebrow}>태장 업무플랫폼</Text>
            </View>

            {signupComplete ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>가입 요청이 접수되었습니다.</Text>
                <Text style={styles.body}>운영팀장 확인 후 태장 플랫폼을 사용할 수 있습니다.</Text>
                <Text style={styles.help}>이메일 확인 안내가 왔다면 먼저 확인한 뒤 로그인해주세요.</Text>
                <Pressable
                  style={styles.formPrimary}
                  onPress={() => {
                    setSignupComplete(false);
                    setAuthMode('login');
                    setEmail(signupEmail);
                    setPassword('');
                  }}
                >
                  <Text style={styles.formPrimaryText}>로그인 화면으로</Text>
                </Pressable>
              </View>
            ) : authMode === 'login' ? (
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
                <Pressable
                  disabled={busy || !email.trim() || !password}
                  style={[styles.formPrimary, busy || !email.trim() || !password ? styles.disabled : null]}
                  onPress={() => void run(() => signIn(email, password))}
                >
                  <Text style={styles.formPrimaryText}>{busy ? '로그인 중…' : '로그인'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setMessage('');
                    setAuthMode('signup');
                  }}
                  style={styles.textAction}
                >
                  <Text style={styles.textActionLabel}>처음이신가요?  가입 요청</Text>
                </Pressable>
                {message ? <Text style={styles.errorText}>{message}</Text> : null}
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>신입직원 가입 요청</Text>
                <TextInput
                  accessibilityLabel="이름"
                  autoComplete="name"
                  placeholder="이름"
                  style={styles.input}
                  value={signupName}
                  onChangeText={setSignupName}
                />
                <TextInput
                  accessibilityLabel="이메일"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="이메일"
                  style={styles.input}
                  value={signupEmail}
                  onChangeText={setSignupEmail}
                />
                <TextInput
                  accessibilityLabel="전화번호"
                  autoComplete="tel"
                  keyboardType="phone-pad"
                  placeholder="전화번호"
                  style={styles.input}
                  value={signupPhone}
                  onChangeText={setSignupPhone}
                />
                <TextInput
                  accessibilityLabel="비밀번호"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect={false}
                  placeholder="비밀번호 (8자 이상)"
                  secureTextEntry
                  style={styles.input}
                  value={signupPassword}
                  onChangeText={setSignupPassword}
                />
                <TextInput
                  accessibilityLabel="입사일"
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  placeholder="입사일  YYYY-MM-DD"
                  style={styles.input}
                  value={signupHiredOn}
                  onChangeText={setSignupHiredOn}
                />
                <Pressable
                  disabled={busy}
                  style={[styles.formPrimary, busy ? styles.disabled : null]}
                  onPress={() => void run(async () => {
                    const result = await signUpEmployee({
                      name: signupName,
                      email: signupEmail,
                      phone: signupPhone,
                      password: signupPassword,
                      hiredOn: signupHiredOn,
                    });
                    if (!result.sessionStarted) setSignupComplete(true);
                  })}
                >
                  <Text style={styles.formPrimaryText}>{busy ? '요청 중…' : '가입 요청'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMessage('');
                    setAuthMode('login');
                  }}
                  style={styles.textAction}
                >
                  <Text style={styles.textActionLabel}>로그인으로 돌아가기</Text>
                </Pressable>
                {message ? <Text style={styles.errorText}>{message}</Text> : null}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  if (accessLoading && !access) {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.brandMark}>泰張</Text>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>계정 상태를 확인하고 있습니다.</Text>
      </View>
    );
  }

  if (accessError && !access) {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.title}>계정 상태를 확인하지 못했습니다.</Text>
        <Text style={styles.errorText}>{accessError}</Text>
        <Pressable style={styles.smallButton} onPress={() => void refreshAccess()}>
          <Text style={styles.smallButtonText}>다시 확인</Text>
        </Pressable>
        <Pressable style={styles.textAction} onPress={() => void run(signOut)}>
          <Text style={styles.textActionLabel}>로그아웃</Text>
        </Pressable>
      </View>
    );
  }

  if (access?.account_status === 'pending') {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.brandMark}>泰張</Text>
        <Text style={styles.title}>가입 승인 대기</Text>
        <Text style={styles.bodyCenter}>가입 요청이 접수되었습니다.{String.fromCharCode(10)}운영팀장 확인 후 이용할 수 있습니다.</Text>
        <Pressable style={styles.smallButton} onPress={() => void refreshAccess()}>
          <Text style={styles.smallButtonText}>{accessLoading ? '확인 중…' : '승인 상태 확인'}</Text>
        </Pressable>
        <Pressable style={styles.textAction} onPress={() => void run(signOut)}>
          <Text style={styles.textActionLabel}>로그아웃</Text>
        </Pressable>
      </View>
    );
  }

  if (access?.account_status !== 'active') {
    return (
      <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <StatusBar style="dark" />
        <Text style={styles.brandMark}>泰張</Text>
        <Text style={styles.title}>현재 이용할 수 없습니다.</Text>
        <Text style={styles.bodyCenter}>계정 상태는 담당자에게 문의해주세요.</Text>
        <Pressable style={styles.smallButton} onPress={() => void run(signOut)}>
          <Text style={styles.smallButtonText}>로그아웃</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.homeScroll}>
        <View style={styles.homeHeader}>
          <View style={styles.homeBrand}>
            <Text style={styles.brandMarkSmall}>泰張</Text>
            <Text style={styles.homeTitle}>태장</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="설정"
            onPress={() => setSettingsOpen(value => !value)}
            style={styles.settingsButton}
          >
            <Text style={styles.settingsText}>설정</Text>
          </Pressable>
        </View>

        {settingsOpen ? (
          <View style={styles.settingsPanel}>
            <Text style={styles.help}>{access.display_name || '태장 직원'} 계정</Text>
            <Pressable onPress={() => void run(signOut)} style={styles.logoutButton}>
              <Text style={styles.logoutText}>{busy ? '처리 중…' : '로그아웃'}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actions}>
          {canRecordAttendance ? <AttendanceCard /> : null}
          <NoticeHomeAction />
          {canOpenWorkPlatform ? (
            <PrimaryButton
              title="업무 플랫폼 열기"
              subtitle="내 업무와 관리 기능"
              secondary
              onPress={() => void Linking.openURL(`${getApiBaseUrl()}/app/`)}
            />
          ) : null}
        </View>

        <OfficialChannelsFooter />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: '#f6f4ed' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 26,
    backgroundColor: '#f6f4ed',
  },
  loginScroll: { flexGrow: 1, justifyContent: 'center', gap: 24, padding: 24 },
  loginBrand: { alignItems: 'center', gap: 4, marginBottom: 4 },
  brandMark: { color: '#173f31', fontSize: 34, fontWeight: '900', letterSpacing: 4 },
  brandMarkSmall: { color: '#173f31', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  eyebrow: { color: '#567064', fontSize: 13, fontWeight: '800' },
  title: { color: '#173f31', fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  sectionTitle: { color: '#173f31', fontSize: 23, fontWeight: '900' },
  body: { color: '#3d5148', fontSize: 16, lineHeight: 24 },
  bodyCenter: { color: '#3d5148', fontSize: 16, lineHeight: 25, textAlign: 'center' },
  help: { color: '#66766d', fontSize: 13, lineHeight: 20 },
  statusText: { color: '#43584d', fontSize: 15, fontWeight: '700' },
  card: {
    gap: 13,
    padding: 20,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7ded8',
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#aebdb3',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    color: '#173f31',
    fontSize: 16,
  },
  formPrimary: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#173f31',
    paddingHorizontal: 16,
  },
  formPrimaryText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  textAction: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  textActionLabel: { color: '#35624d', fontSize: 14, fontWeight: '800' },
  errorText: { color: '#9b2c2c', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  smallButton: {
    minHeight: 50,
    minWidth: 150,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#173f31',
    paddingHorizontal: 18,
  },
  smallButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  homeScroll: { flexGrow: 1, gap: 18, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 24 },
  homeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  homeBrand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  homeTitle: { color: '#173f31', fontSize: 27, fontWeight: '900', letterSpacing: -0.6 },
  settingsButton: { minHeight: 42, minWidth: 52, alignItems: 'center', justifyContent: 'center' },
  settingsText: { color: '#66766d', fontSize: 13, fontWeight: '800' },
  settingsPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#ebece5',
  },
  logoutButton: { paddingHorizontal: 12, paddingVertical: 9 },
  logoutText: { color: '#7c3932', fontSize: 13, fontWeight: '900' },
  actions: { gap: 14 },
  primaryAction: {
    minHeight: 118,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: 20,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#9fb5a7',
  },
  platformAction: { backgroundColor: '#e7eee7', borderColor: '#9db2a2' },
  actionPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  primaryActionTitle: { color: '#173f31', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  platformActionTitle: { color: '#234e3a' },
  primaryActionSubtitle: { color: '#60746a', fontSize: 14, fontWeight: '700' },
  platformActionSubtitle: { color: '#5b7165' },
});
