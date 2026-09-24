import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PolicyLinks } from '@/src/features/common/policy-links';
import { usePlatform } from '@/src/providers/platform-provider';

const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '버전 정보 없음';
type AccessContext = { display_name?: string | null };

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session, signOut } = usePlatform();
  const [busy, setBusy] = useState(false);
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
  logout: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#d7aaa4', backgroundColor: '#ffffff' },
  logoutText: { color: '#87362f', fontSize: 17, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
});
