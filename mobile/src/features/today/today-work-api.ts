import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type TodayWork = {
  id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  lead: { id: string; name: string } | null;
  preparation: string | null;
  caution: string | null;
  status: 'published' | 'cancelled';
};

export type TodayBoard = {
  date: string;
  display_name: string | null;
  tasks: TodayWork[];
};

export async function loadMyTodayWork(client: PlatformSupabaseClient): Promise<TodayBoard> {
  const { data, error } = await client.rpc('get_my_today_board');
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('오늘 할 일을 불러오지 못했습니다.');
  }

  const board = data as Partial<TodayBoard>;
  return {
    date: typeof board.date === 'string' ? board.date : '',
    display_name: typeof board.display_name === 'string' ? board.display_name : null,
    tasks: Array.isArray(board.tasks) ? board.tasks as TodayWork[] : [],
  };
}
