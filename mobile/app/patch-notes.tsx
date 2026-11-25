import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MOBILE_PATCH_NOTES } from '@/src/features/settings/patch-notes';
import { installedAppVersion } from '@/src/platform/release-policy';

export default function PatchNotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const installed = installedAppVersion();

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable accessibilityRole="button" accessibilityLabel="설정으로 돌아가기" onPress={() => router.replace('/settings')} style={styles.back}>
          <Text style={styles.backText}>← 설정</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>패치노트</Text>
        <Text style={styles.version}>설치 버전 {installed.version}{installed.versionCode !== null ? ` · 빌드 ${installed.versionCode}` : ''}</Text>
        <Text style={styles.description}>이 앱에 포함된 변경 기록입니다. 앱을 업데이트하면 새 기록이 함께 추가됩니다.</Text>
        {MOBILE_PATCH_NOTES.map(note => (
          <View key={note.id} style={styles.card}>
            <Text style={styles.date}>변경 기록일 {note.date}</Text>
            <Text accessibilityRole="header" style={styles.cardTitle}>{note.title}</Text>
            <Text style={styles.body}>{note.summary}</Text>
            {note.items.map(item => <Text key={item} style={styles.item}>• {item}</Text>)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f4ed' },
  scroll: { gap: 16, padding: 22, paddingBottom: 40 },
  back: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center', paddingRight: 16 },
  backText: { color: '#35624d', fontSize: 16, fontWeight: '800' },
  title: { color: '#173f31', fontSize: 32, fontWeight: '900' },
  version: { color: '#60746a', fontSize: 14, fontWeight: '700' },
  description: { color: '#60746a', fontSize: 15, lineHeight: 23, fontWeight: '600' },
  card: { gap: 10, padding: 20, borderRadius: 20, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d7ded8' },
  date: { color: '#60746a', fontSize: 13, fontWeight: '700' },
  cardTitle: { color: '#173f31', fontSize: 21, lineHeight: 29, fontWeight: '900' },
  body: { color: '#344b40', fontSize: 16, lineHeight: 25, fontWeight: '600' },
  item: { color: '#344b40', fontSize: 16, lineHeight: 25 },
});
