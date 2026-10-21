import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { noticeDeepLinkPath, type NoticeSummary } from './notice-api';

export function NoticeListCard({ item, unread = false }: { item: NoticeSummary; unread?: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${unread ? ', 미확인' : ''}, 공지 열기`}
      onPress={() => router.push(noticeDeepLinkPath(item.id))}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <Text numberOfLines={2} ellipsizeMode="tail" style={styles.title}>{item.title}</Text>
      {unread ? <View accessible={false} style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 88,
    padding: 16,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignSelf: 'stretch',
    minWidth: 0,
  },
  pressed: { opacity: 0.86 },
  title: { color: '#173f31', fontSize: 19, fontWeight: '800', lineHeight: 27, flex: 1, minWidth: 0 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a13024', flexShrink: 0 },
});
