import * as Linking from 'expo-linking';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

const CHANNELS = [
  {
    label: '태장 홈페이지',
    url: 'https://taejang.co.kr',
    icon: require('../../../assets/taejang-favicon.png'),
  },
  {
    label: '공식 블로그',
    url: 'https://blog.naver.com/taejang-official',
    icon: require('../../../assets/naver-blog.png'),
  },
  {
    label: '공식 유튜브',
    url: 'https://youtube.com/@taejangofficial',
    icon: require('../../../assets/youtube.png'),
  },
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
            <View style={styles.iconFrame}>
              <Image source={channel.icon} style={styles.icon} resizeMode="contain" />
            </View>
            <Text style={styles.label}>{channel.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 2 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  item: { width: 88, alignItems: 'center', gap: 8 },
  pressed: { opacity: 0.7 },
  iconFrame: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d9ded9',
    overflow: 'hidden',
  },
  icon: { width: 48, height: 48 },
  label: { color: '#5e6e65', fontSize: 12, fontWeight: '800', textAlign: 'center' },
});