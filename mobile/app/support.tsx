import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { getApiBaseUrl } from '@/src/platform/config';
import { usePlatform } from '@/src/providers/platform-provider';

type ConnectionState = 'checking' | 'available' | 'unavailable';
const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '버전 정보 없음';
const build = Constants.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? '정보 없음';

export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { config } = usePlatform();
  const [connection, setConnection] = useState<ConnectionState>('checking');

  const checkConnection = useCallback(async () => {
    setConnection('checking');
    try {
      const response = await fetch(`${getApiBaseUrl()}/.netlify/functions/staff-config`, { cache: 'no-store' });
      setConnection(response.ok ? 'available' : 'unavailable');
    } catch {
      setConnection('unavailable');
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);
  const connectionText = connection === 'available' ? '연결할 수 있습니다' : connection === 'unavailable' ? '연결을 확인하지 못했습니다' : '연결을 확인하고 있습니다';

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable accessibilityRole="button" accessibilityLabel="설정으로 돌아가기" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← 설정</Text></Pressable>
        <Text style={styles.title}>앱 정보와 연결 진단</Text>
        <Text style={styles.description}>비밀번호, 로그인 토큰, 위치 정보는 표시하지 않습니다.</Text>
        <View style={styles.card}>
          <Row label="앱 버전" value={appVersion} />
          <Row label="빌드 번호" value={String(build)} />
          <Row label="기기" value={`${Constants.platform?.android ? 'Android' : '지원 기기'}`} />
          <Row label="연결 상태" value={connectionText} />
          {config?.environmentLabel ? <Row label="환경" value={config.environmentLabel} /> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="연결 다시 확인" onPress={() => void checkConnection()} style={styles.button}>
          {connection === 'checking' ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>연결 다시 확인</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="태장에 문의하기" onPress={() => void Linking.openURL('https://taejang.co.kr/#contact')} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>태장에 문의하기</Text></Pressable>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f4ed' }, scroll: { gap: 16, padding: 22, paddingBottom: 40 },
  back: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center' }, backText: { color: '#35624d', fontSize: 16, fontWeight: '800' },
  title: { color: '#173f31', fontSize: 28, fontWeight: '900' }, description: { color: '#60746a', fontSize: 15, lineHeight: 22, fontWeight: '600' },
  card: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: '#d7ded8', backgroundColor: '#ffffff' },
  row: { gap: 5, padding: 16, borderBottomWidth: 1, borderBottomColor: '#edf0ee' }, label: { color: '#60746a', fontSize: 13, fontWeight: '800' }, value: { color: '#173f31', fontSize: 16, fontWeight: '800' },
  button: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#35624d' }, buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  secondaryButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#aabbb0' }, secondaryButtonText: { color: '#35624d', fontSize: 16, fontWeight: '900' },
});
