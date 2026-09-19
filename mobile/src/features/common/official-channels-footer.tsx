import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const CHANNELS = [
  { label: '홈페이지', mark: '泰', url: 'https://taejang.co.kr', tone: '#173f31' },
  { label: '블로그', mark: 'N', url: 'https://blog.naver.com/taejang-official', tone: '#03C75A' },
  { label: '유튜브', mark: '▶', url: 'https://youtube.com/@taejangofficial', tone: '#FF0033' },
] as const;

export function OfficialChannelsFooter() {
  return (
    <View style={styles.wrap}>
      <View style={styles.links}>
        {CHANNELS.map(channel => (
          <Pressable
            key={channel.url}
            accessibilityRole="link"
            accessibilityLabel={`태장 공식 ${channel.label} 열기`}
            onPress={() => void Linking.openURL(channel.url)}
            style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
          >
            <View style={[styles.icon, { backgroundColor: channel.tone }]}>
              <Text style={styles.mark}>{channel.mark}</Text>
            </View>
            <Text style={styles.label}>{channel.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  item: { width: 62, alignItems: 'center', gap: 7 },
  pressed: { opacity: 0.72 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  label: { color: '#5e6e65', fontSize: 12, fontWeight: '700' },
});
