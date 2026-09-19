import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { loadPromotionWorkspace, type PromotionWorkspace } from './promotion-api';
import { usePlatform } from '@/src/providers/platform-provider';

export function PromotionStaffShortcut() {
  const router = useRouter();
  const { client, session } = usePlatform();
  const [workspace, setWorkspace] = useState<PromotionWorkspace | null>(null);

  const load = useCallback(async () => {
    if (!client || !session) return;
    try {
      const next = await loadPromotionWorkspace(client);
      if (next.role === 'promotion_staff') setWorkspace(next);
      else setWorkspace(null);
    } catch {
      // General workers and manager roles intentionally see no mobile promotion-authoring card.
      setWorkspace(null);
    }
  }, [client, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspace) return null;

  const needsRevision = workspace.my_items.filter(item => item.lifecycle === 'needs_revision').length;
  const reviewPending = workspace.my_items.filter(item => item.lifecycle === 'review_pending').length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="홍보 업무 열기"
      style={styles.card}
      onPress={() => router.push('/promotion')}
    >
      <Text style={styles.eyebrow}>홍보직원 업무</Text>
      <Text style={styles.title}>홍보글 작성·상신</Text>
      <Text style={styles.body}>
        {needsRevision
          ? `보완이 필요한 글이 ${needsRevision}건 있습니다.`
          : reviewPending
            ? `운영팀장 검토 중인 글이 ${reviewPending}건 있습니다.`
            : '새 홍보글을 작성하거나 기존 초안을 이어서 작성하세요.'}
      </Text>
      <Text style={styles.link}>홍보 업무 열기 →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 7,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#f4efff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cfc1e8',
  },
  eyebrow: { color: '#654b8d', fontSize: 13, fontWeight: '800' },
  title: { color: '#382650', fontSize: 19, fontWeight: '800' },
  body: { color: '#514261', fontSize: 14, lineHeight: 21 },
  link: { color: '#654b8d', fontSize: 14, fontWeight: '800' },
});
