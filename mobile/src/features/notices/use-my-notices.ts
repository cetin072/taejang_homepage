import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { usePlatform } from '@/src/providers/platform-provider';
import { loadMyNotices, type NoticeSummary } from './notice-api';
import { cacheNotices, getCachedNotices } from './notice-cache';
import { noticeReadStore, type NoticeReadVersions } from './notice-read-state';

// The existing RPC permits at most 200. Fetch once per focus/resume, never poll.
export const NOTICE_LIST_LIMIT = 200;
export function useMyNotices() {
  const { client, session } = usePlatform();
  const userId = session?.user.id;
  const request = useRef(0);
  const inFlight = useRef(false);
  const focused = useRef(false);
  const [state, setState] = useState<{
    userId?: string; items: NoticeSummary[]; versions: NoticeReadVersions; loading: boolean; error: string;
  }>({ items: [], versions: {}, loading: true, error: '' });

  const load = useCallback(async () => {
    if (!client || !userId || inFlight.current || !focused.current) return;
    const token = ++request.current;
    inFlight.current = true;
    const cached = getCachedNotices(userId, NOTICE_LIST_LIMIT);
    setState(previous => ({ ...previous, userId, items: cached, versions: previous.userId === userId ? previous.versions : {}, loading: true, error: '' }));
    try {
      const [items, versions] = await Promise.all([
        loadMyNotices(client, NOTICE_LIST_LIMIT), noticeReadStore.load(userId),
      ]);
      if (token !== request.current) return;
      setState({ userId, items: cacheNotices(userId, items, NOTICE_LIST_LIMIT), versions, loading: false, error: '' });
    } catch {
      if (token !== request.current) return;
      setState(previous => ({ ...previous, loading: false, error: '공지 정보를 불러오지 못했습니다. 다시 시도' }));
    } finally {
      if (token === request.current) inFlight.current = false;
    }
  }, [client, userId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') void load();
      previous = next;
    });
    return () => {
      focused.current = false;
      request.current++;
      inFlight.current = false;
      subscription.remove();
    };
  }, [load]));

  const owned = state.userId === userId;
  return {
    items: owned ? state.items : [], versions: owned ? state.versions : {},
    loading: !owned || state.loading, error: owned ? state.error : '', retry: load,
  };
}
