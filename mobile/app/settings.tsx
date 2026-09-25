import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PolicyLinks } from '@/src/features/common/policy-links';
import { registerCurrentPushDevice } from '@/src/notifications/push-registration';
import { usePlatform } from '@/src/providers/platform-provider';

const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '버전 정보 없음';
type AccessContext = { display_name?: string | null };

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session, signOut } = usePlatform();
  const [busy, setBusy] = useState(false);
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
      if (result.status === 'registered') {
        Alert.alert('알림 설정', '중요 공지 알림을 받을 준비가 되었습니다.');
      } else if (result.status === 'permission_required') {
        Alert.alert('알림 설정', '휴대폰 설정에서 태장 앱의 알림을 허용해주세요.', [
          { text: '나중에' },
          { text: '설정 열기', onPress: () => void Linking.openSettings() },
        ]);
      } else if (result.status === 'physical_device_required') {
        Alert.alert('알림 설정', '알림은 실제 휴대폰에서 설정할 수 있습니다.');
      } else if (result.status === 'project_not_configured') {
        Alert.alert('알림 설정', '알림 연결을 준비 중입니다. 잠시 후 다시 시도해주세요.');
      } else {
        Alert.alert('알림 설정', '이 기기에서는 알림 설정을 지원하지 않습니다.');
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
        <View style={styles.account}>
          <Text numberOfLines={2} style={styles.name}>{displayName}</Text>
          <Text style={styles.help}>내 계정</Text>
        </View>
        <View style={styles.links}>
          <PolicyLinks includeAccountDeletion />
        </View>
        {session ? (
          <Pressable accessibilityRole="button" accessibilityLabel="공지 알림 설정" disabled={notificationBusy} onPress={() => void handleNotifications()} style={[styles.utilityButton, notificationBusy ? styles.disabled : null]}>
            <Text style={styles.utilityButtonTitle}>{notificationBusy ? '알림을 확인하고 있습니다…' : '공지 알림 설정'}</Text>
            <Text style={styles.utilityButtonHelp}>중요 공지를 알림으로 받습니다</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="앱 정보와 연결 진단" onPress={() => router.push('/support')} style={styles.utilityButton}>
          <Text style={styles.utilityButtonTitle}>앱 정보와 연결 진단</Text>
          <Text style={styles.utilityButtonHelp}>문의할 때 필요한 안전한 정보만 확인합니다</Text>
        </Pressable>
        <View style={styles.versionRow}>
          <Text style={styles.versionLabel}>앱 버전</Text>
          <Text style={styles.version}>{appVersion}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="로그아웃"
          disabled={busy}
          onPress={() => void handleSignOut()}
          style={({ pressed }) => [styles.logout, busy ? styles.disabled : null, pressed && !busy ? styles.pressed : null]}
        >
          <Text style={styles.logoutText}>{busy ? '로그아웃 중…' : '로그아웃'}</Text>
        </Pressable>
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
  account: { gap: 5, padding: 20, borderRadius: 20, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d7ded8' },
  name: { color: '#173f31', fontSize: 21, fontWeight: '900', lineHeight: 29 },
  help: { color: '#60746a', fontSize: 14, fontWeight: '700' },
  links: { alignItems: 'flex-start', paddingVertical: 2 },
  versionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#d7ded8' },
  versionLabel: { color: '#344b40', fontSize: 16, fontWeight: '800' },
  version: { color: '#60746a', fontSize: 15 },
  utilityButton: { gap: 4, minHeight: 66, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: '#d7ded8', backgroundColor: '#ffffff' },
  utilityButtonTitle: { color: '#173f31', fontSize: 16, fontWeight: '900' },
  utilityButtonHelp: { color: '#60746a', fontSize: 13, fontWeight: '600' },
  logout: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#d7aaa4', backgroundColor: '#ffffff' },
  logoutText: { color: '#87362f', fontSize: 17, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
});
