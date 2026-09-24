import * as Linking from 'expo-linking';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

const APP_PRIVACY_URL = 'https://taejang.co.kr/employee-app-privacy.html';
const ACCOUNT_DELETION_URL = 'https://taejang.co.kr/account-deletion.html';

export function PolicyLinks({ includeAccountDeletion = false }: { includeAccountDeletion?: boolean }) {
  const openUrl = (url: string, label: string) => {
    void Linking.openURL(url).catch(() => {
      Alert.alert('페이지 열기', `${label} 페이지를 열지 못했습니다. 잠시 후 다시 시도해주세요.`);
    });
  };

  return (
    <View style={styles.links}>
      <Pressable accessibilityRole="link" accessibilityLabel="개인정보처리방침" onPress={() => openUrl(APP_PRIVACY_URL, '개인정보처리방침')} style={styles.linkButton}>
        <Text style={styles.linkText}>개인정보처리방침</Text>
      </Pressable>
      {includeAccountDeletion ? (
        <Pressable accessibilityRole="link" accessibilityLabel="계정 삭제 요청" onPress={() => openUrl(ACCOUNT_DELETION_URL, '계정 삭제 요청')} style={styles.linkButton}>
          <Text style={styles.deleteText}>계정 삭제 요청</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
  linkButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7 },
  linkText: { color: '#35624d', fontSize: 13, fontWeight: '800' },
  deleteText: { color: '#7c3932', fontSize: 13, fontWeight: '800' },
});
