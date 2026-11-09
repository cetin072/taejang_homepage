import type { ReactNode } from 'react';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PolicyLinks } from '@/src/features/common/policy-links';
import { appVariantLabel, isQaApp } from '@/src/platform/app-variant';
import { pushRegistrationMessage, registerCurrentPushDevice } from '@/src/notifications/push-registration';
import { usePlatform } from '@/src/providers/platform-provider';

const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '버전 정보 없음';
type AccessContext = { display_name?: string | null };

// Same grouped-settings pattern as Worklog, adapted locally to the staff app palette.
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.group}>
    <Text accessibilityRole="header" style={styles.groupTitle}>{title}</Text>
    <View style={styles.groupCard}>{children}</View>
  </View>;
}

function SettingsRow({ title, label, onPress, disabled = false, expanded }: { title: string; label?: string; onPress(): void; disabled?: boolean; expanded?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label || title} accessibilityState={expanded === undefined ? undefined : { expanded }} disabled={disabled} onPress={onPress} style={[styles.utilityButton, disabled ? styles.disabled : null]}>
    <Text style={styles.utilityButtonTitle}>{title}</Text>
    <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.chevron}>{expanded ? '⌄' : '›'}</Text>
  </Pressable>;
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session, signOut } = usePlatform();
  const [busy, setBusy] = useState(false);
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const fallbackDisplayName = session?.user.user_metadata?.display_name || session?.user.email || '태장 직원';
  const displayName = access?.display_name?.trim() || fallbackDisplayName;

  useEffect(() => {
    let active = true;
    setAccess(null);
    if (!client || !session) return () => { active = false; };

    void client.rpc('get_my_access_context_v2').then(({ data, error }) => {
      if (!active || error || !data || typeof data !== 'object' || Array.isArray(data)) return;
      setAccess(data as AccessContext);
    });
    return () => { active = false; };
  }, [client, session?.user.id]);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      router.replace('/');
    } catch {
      Alert.alert('로그아웃', '로그아웃하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function handleNotifications() {
    if (!client || notificationBusy) return;
    setNotificationBusy(true);
    try {
      const result = await registerCurrentPushDevice(client, { requestPermission: true });
      if (result.status === 'permission_required') {
        Alert.alert('알림 설정', pushRegistrationMessage(result.status), [
          { text: '나중에' },
          { text: '설정 열기', onPress: () => void Linking.openSettings() },
        ]);
      } else {
        Alert.alert('알림 설정', pushRegistrationMessage(result.status));
      }
    } catch {
      Alert.alert('알림 설정', '알림을 설정하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
    } finally {
      setNotificationBusy(false);
    }
  }

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable accessibilityRole="button" accessibilityLabel="홈으로 돌아가기" onPress={() => router.replace('/')} style={styles.back}>
          <Text style={styles.backText}>← 홈</Text>
        </Pressable>
        <Text style={styles.title}>설정</Text>
        {session ? <SettingsGroup title="알림">
          <SettingsRow title={notificationBusy ? '알림 확인 중…' : '공지 알림 설정'} label="공지 알림 설정" disabled={notificationBusy} onPress={() => void handleNotifications()} />
        </SettingsGroup> : null}
        <SettingsGroup title="앱 정보">
          <SettingsRow title="업데이트·패치노트" label="패치노트 열기" onPress={() => router.push('/patch-notes')} />
          <SettingsRow title="앱 정보와 연결 진단" onPress={() => router.push('/support')} />
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>앱 버전</Text>
            <Text style={styles.version}>{appVersion}</Text>
          </View>
          {isQaApp ? <View style={styles.qaBanner} accessibilityLabel="태장 QA 검수용 앱">
            <Text style={styles.qaBannerTitle}>{appVariantLabel()}</Text>
            <Text style={styles.qaBannerHelp}>검수용 · 정식 앱과 별도 설치</Text>
          </View> : null}
          <SettingsRow title="개인정보·계정 관리" expanded={policyExpanded} onPress={() => setPolicyExpanded(value => !value)} />
          {policyExpanded ? <View style={styles.links}><PolicyLinks includeAccountDeletion /></View> : null}
        </SettingsGroup>
        <SettingsGroup title="계정">
          <View style={styles.account}>
            <Text style={styles.name}>{displayName}</Text>
          </View>
          {session ? <SettingsRow title="내 정보" label="내 정보 열기" onPress={() => router.push('/profile')} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="로그아웃"
            disabled={busy}
            onPress={() => void handleSignOut()}
            style={({ pressed }) => [styles.logout, busy ? styles.disabled : null, pressed && !busy ? styles.pressed : null]}
          >
            <Text style={styles.logoutText}>{busy ? '로그아웃 중…' : '로그아웃'}</Text>
          </Pressable>
        </SettingsGroup>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f4ed' },
  scroll: { gap: 16, padding: 22, paddingBottom: 40 },
  back: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center' },
  backText: { color: '#35624d', fontSize: 16, fontWeight: '800' },
  title: { color: '#173f31', fontSize: 32, fontWeight: '900' },
  qaBanner: { gap: 4, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#d6bd65', backgroundColor: '#fff8d8' },
  qaBannerTitle: { color: '#6b5314', fontSize: 17, fontWeight: '900' },
  qaBannerHelp: { color: '#7d692d', fontSize: 13, fontWeight: '700', lineHeight: 19 },
  group: { gap: 8 },
  groupTitle: { color: '#60746a', fontSize: 14, fontWeight: '800', paddingHorizontal: 4 },
  groupCard: { borderWidth: 1, borderColor: '#d7ded8', borderRadius: 18, backgroundColor: '#ffffff', overflow: 'hidden' },
  account: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d7ded8' },
  name: { color: '#173f31', fontSize: 17, fontWeight: '800', lineHeight: 25 },
  links: { alignItems: 'flex-start', padding: 8 },
  versionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 16 },
  versionLabel: { color: '#344b40', fontSize: 16, fontWeight: '800' },
  version: { color: '#60746a', fontSize: 15 },
  utilityButton: { gap: 12, flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d7ded8' },
  utilityButtonTitle: { flex: 1, color: '#173f31', fontSize: 16, fontWeight: '800' },
  chevron: { color: '#35624d', fontSize: 24 },
  logout: { minHeight: 56, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff7f5' },
  logoutText: { color: '#87362f', fontSize: 17, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
});
