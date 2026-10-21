import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { noticeDeepLinkPath, type NoticeSummary } from './notice-api';
import { noticeDate } from './notice-read-state';

export function NoticeListCard({ item, unread = false }: { item: NoticeSummary; unread?: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${noticeDate(item)}, ${item.title}${unread ? ', 미확인' : ''}, 공지 열기`}
      onPress={() => router.push(noticeDeepLinkPath(item.id))}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.meta}>
        <Text style={styles.date}>{noticeDate(item)}</Text>
        {unread ? <View accessible={false} style={styles.dot} /> : null}
      </View>
      <Text numberOfLines={2} ellipsizeMode="tail" style={styles.title}>{item.title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 88,
    padding: 16,
    gap: 6,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignSelf: 'stretch',
    minWidth: 0,
  },
  pressed: { opacity: 0.86 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  date: { color: '#60746a', fontSize: 13, flexShrink: 1 },
  title: { color: '#173f31', fontSize: 19, fontWeight: '800', lineHeight: 27, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a13024' },
});
