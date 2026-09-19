import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const CHANNELS = [
  { label: '홈페이지', url: 'https://taejang.co.kr' },
  { label: '네이버 블로그', url: 'https://blog.naver.com/taejang-official' },
  { label: '유튜브', url: 'https://youtube.com/@taejangofficial' },
] as const;

export function OfficialChannelsFooter() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>태장 소식 보기</Text>
      <View style={styles.links}>
        {CHANNELS.map(channel => (
          <Pressable
            key={channel.url}
            accessibilityRole="link"
            accessibilityLabel={`태장 공식 ${channel.label} 열기`}
            onPress={() => void Linking.openURL(channel.url)}
          >
            <Text style={styles.link}>{channel.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6, paddingVertical: 12 },
  label: { color: '#829087', fontSize: 11 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14 },
  link: { color: '#60746a', fontSize: 12, textDecorationLine: 'underline' },
});
