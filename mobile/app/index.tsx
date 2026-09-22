import DateTimePicker from '@react-native-community/datetimepicker';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttendanceCard } from '@/src/features/attendance/attendance-card';
import { OfficialChannelsFooter } from '@/src/features/common/official-channels-footer';
import { resolveEmployeeAppFeatures } from '@/src/features/common/employee-feature-registry';
import { NoticeHomeAction } from '@/src/features/notices/notice-home-action';
import { usePlatform } from '@/src/providers/platform-provider';

type AccessRole = { code?: string; name?: string };
type AccessContext = {
  account_status?: string;
  display_name?: string | null;
  capabilities?: string[];
  actual_roles?: AccessRole[];
  effective_roles?: AccessRole[];
  work_platform_available?: boolean;
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  return Number.isNaN(date.valueOf()) ? new Date() : date;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function PasswordInput({
  label,
  value,
  onChangeText,
  autoComplete,
  placeholder = '비밀번호',
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  onSubmitEditing?: () => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Field label={label}>
      <View style={styles.passwordWrap}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoComplete={autoComplete}
          autoCorrect={false}
          placeholder={placeholder}
          secureTextEntry={!visible}
          style={[styles.input, styles.passwordInput]}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
          onPress={() => setVisible(current => !current)}
          style={styles.passwordToggle}
        >
          <Text style={styles.passwordToggleText}>{visible ? '숨기기' : '보기'}</Text>
        </Pressable>
      </View>
    </Field>
  );
}

function PrimaryButton({
  title,
  subtitle,
  onPress,
  minHeight,
  secondary = false,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  minHeight: number;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        { minHeight },
        secondary ? styles.platformAction : null,
        disabled ? styles.actionDisabled : null,
        pressed && !disabled ? styles.actionPressed : null,
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
  const {
    phase,
    session,
    error,
    client,
    reload,
    signIn,
    signUpEmployee,
    requestPasswordReset,
    createWorkPlatformUrl,
    signOut,
  } = usePlatform();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'recovery'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySent, setRecoverySent] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupHiredOn, setSignupHiredOn] = useState('');
  const [showHireDatePicker, setShowHireDatePicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [signupComplete, setSignupComplete] = useState(false);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [platformOpening, setPlatformOpening] = useState(false);

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

  async function openWorkPlatform() {
    if (platformOpening) return;
    setPlatformOpening(true);
    try {
      const url = await createWorkPlatformUrl();
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        '업무 플랫폼 연결',
        '자동 로그인 연결에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    } finally {
      setPlatformOpening(false);
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
      setAccess(null);
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

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refreshAccess();
    });
    return () => subscription.remove();
  }, [session, refreshAccess]);

  const employeeFeatures = useMemo(() => resolveEmployeeAppFeatures(access), [access]);
  const attendanceFeature = employeeFeatures.get('attendance.clock');
  const noticeFeature = employeeFeatures.get('notice.read');
  const workPlatformFeature = employeeFeatures.get('work-platform.open');
  const canOpenWorkPlatform = workPlatformFeature?.state === 'enabled';
  const primaryCount = 3;
  const actionHeight = useMemo(() => {
    const available = Math.max(360, windowHeight - 300);
    const raw = Math.floor((available - (primaryCount - 1) * 14) / primaryCount);
    return Math.max(138, Math.min(174, raw));
  }, [primaryCount, windowHeight]);

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
              <Text style={styles.eyebrow}>태장 직원앱</Text>
            </View>

            {signupComplete ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>가입 요청이 접수되었습니다.</Text>
                <Text style={styles.body}>운영팀장 확인 후 태장 직원앱을 사용할 수 있습니다.</Text>
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
                <Field label="이메일">
                  <TextInput
                    accessibilityLabel="이메일"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder="name@taejang.co.kr"
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                  />
                </Field>
                <PasswordInput
                  label="비밀번호"
                  value={password}
                  onChangeText={setPassword}
                  autoComplete="current-password"
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
                <View style={styles.authLinks}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setMessage('');
                      setRecoveryEmail(email);
                      setRecoverySent(false);
                      setAuthMode('recovery');
                    }}
                    style={styles.textAction}
                  >
                    <Text style={styles.textActionLabel}>비밀번호 찾기</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setMessage('');
                      setAuthMode('signup');
                    }}
                    style={styles.textAction}
                  >
                    <Text style={styles.textActionLabel}>처음이신가요? 가입 요청</Text>
                  </Pressable>
                </View>
                {message ? <Text style={styles.errorText}>{message}</Text> : null}
              </View>
            ) : authMode === 'recovery' ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>비밀번호 찾기</Text>
                <Text style={styles.body}>가입할 때 사용한 이메일로 재설정 링크를 보내드립니다.</Text>
                <Field label="이메일">
                  <TextInput
                    accessibilityLabel="비밀번호 재설정 이메일"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder="name@taejang.co.kr"
                    style={styles.input}
                    value={recoveryEmail}
                    onChangeText={setRecoveryEmail}
                  />
                </Field>
                <Pressable
                  disabled={busy || !recoveryEmail.trim()}
                  style={[styles.formPrimary, busy || !recoveryEmail.trim() ? styles.disabled : null]}
                  onPress={() => void run(async () => {
                    await requestPasswordReset(recoveryEmail);
                    setRecoverySent(true);
                  })}
                >
                  <Text style={styles.formPrimaryText}>{busy ? '보내는 중…' : '재설정 메일 보내기'}</Text>
                </Pressable>
                {recoverySent ? (
                  <Text style={styles.successText}>
                    등록된 계정이면 비밀번호 재설정 메일이 발송됩니다. 받은 편지함과 스팸함을 확인해주세요.
                  </Text>
                ) : null}
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
            ) : (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>신입직원 가입 요청</Text>
                <Field label="이름">
                  <TextInput
                    accessibilityLabel="이름"
                    autoComplete="name"
                    placeholder="이름"
                    style={styles.input}
                    value={signupName}
                    onChangeText={setSignupName}
                  />
                </Field>
                <Field label="이메일">
                  <TextInput
                    accessibilityLabel="이메일"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder="name@taejang.co.kr"
                    style={styles.input}
                    value={signupEmail}
                    onChangeText={setSignupEmail}
                  />
                </Field>
                <Field label="전화번호">
                  <TextInput
                    accessibilityLabel="전화번호"
                    autoComplete="tel"
                    keyboardType="phone-pad"
                    placeholder="010-0000-0000"
                    style={styles.input}
                    value={signupPhone}
                    onChangeText={setSignupPhone}
                  />
                </Field>
                <PasswordInput
                  label="비밀번호"
                  value={signupPassword}
                  onChangeText={setSignupPassword}
                  autoComplete="new-password"
                  placeholder="8자 이상"
                />
                <Field label="입사일">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="입사일 달력 열기"
                    onPress={() => setShowHireDatePicker(true)}
                    style={styles.dateInput}
                  >
                    <Text style={signupHiredOn ? styles.dateValue : styles.datePlaceholder}>
                      {signupHiredOn || '날짜 선택'}
                    </Text>
                    <Text style={styles.dateIcon}>달력</Text>
                  </Pressable>
                </Field>
                {showHireDatePicker ? (
                  <DateTimePicker
                    value={parseDate(signupHiredOn)}
                    mode="date"
                    display={Platform.OS === 'android' ? 'calendar' : 'default'}
                    onChange={(_event, date) => {
                      setShowHireDatePicker(false);
                      if (date) setSignupHiredOn(formatDate(date));
                    }}
                  />
                ) : null}
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
        <View style={styles.homeTop}>
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
            {attendanceFeature?.state !== 'hidden' ? (
              <AttendanceCard
                minHeight={actionHeight}
                mode={attendanceFeature?.attendanceMode || 'record'}
              />
            ) : null}
            {noticeFeature?.state !== 'hidden' ? <NoticeHomeAction minHeight={actionHeight} /> : null}
            {workPlatformFeature?.state !== 'hidden' ? (
              <PrimaryButton
                title={platformOpening ? '업무 플랫폼 연결 중…' : '업무 플랫폼 열기'}
                subtitle={canOpenWorkPlatform ? '내 업무와 관리 기능' : workPlatformFeature?.reason}
                minHeight={actionHeight}
                secondary
                disabled={!canOpenWorkPlatform || platformOpening}
                onPress={() => void openWorkPlatform()}
              />
            ) : null}
          </View>
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
  loginScroll: { flexGrow: 1, justifyContent: 'center', gap: 22, padding: 24 },
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
    gap: 14,
    padding: 20,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7ded8',
  },
  field: { gap: 7 },
  fieldLabel: { color: '#274d3c', fontSize: 14, fontWeight: '900' },
  input: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#aebdb3',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    color: '#173f31',
    fontSize: 16,
  },
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 74 },
  passwordToggle: {
    position: 'absolute',
    right: 8,
    minWidth: 58,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  passwordToggleText: { color: '#35624d', fontSize: 13, fontWeight: '900' },
  dateInput: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#aebdb3',
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  dateValue: { color: '#173f31', fontSize: 16, fontWeight: '700' },
  datePlaceholder: { color: '#89978f', fontSize: 16 },
  dateIcon: { color: '#35624d', fontSize: 13, fontWeight: '900' },
  formPrimary: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#173f31',
    paddingHorizontal: 16,
  },
  formPrimaryText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  authLinks: { gap: 2, alignItems: 'center' },
  textAction: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  textActionLabel: { color: '#35624d', fontSize: 14, fontWeight: '800' },
  errorText: { color: '#9b2c2c', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  successText: {
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#edf6ef',
    color: '#27543b',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
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
  homeScroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  homeTop: { gap: 14 },
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#9fb5a7',
  },
  platformAction: { backgroundColor: '#e7eee7', borderColor: '#9db2a2' },
  actionPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  actionDisabled: { opacity: 0.5 },
  primaryActionTitle: { color: '#173f31', fontSize: 29, fontWeight: '900', letterSpacing: -0.6 },
  platformActionTitle: { color: '#234e3a' },
  primaryActionSubtitle: { color: '#60746a', fontSize: 15, fontWeight: '700' },
  platformActionSubtitle: { color: '#5b7165' },
});
