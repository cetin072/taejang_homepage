import type { ScheduleItem } from './schedule-api';

const scheduleTypeLabels: Record<string, string> = {
  work: '근무',
  training: '교육',
  external_activity: '외부활동',
  holiday: '휴무',
  location_change: '장소 변경',
  special_event: '특별 일정',
  transport: '차량 이동',
  other: '일정',
};

function dateOf(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function format(value: string | null | undefined, options: Intl.DateTimeFormatOptions) {
  const date = dateOf(value);
  return date ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...options }).format(date) : '';
}

export function scheduleTypeLabel(item: ScheduleItem) {
  if (/건강\s*검진/.test(item.title)) return '건강검진';
  return scheduleTypeLabels[item.schedule_type] || '일정';
}

export function scheduleDateLabel(item: ScheduleItem) {
  const day = format(item.starts_at, { month: 'long', day: 'numeric', weekday: 'short' });
  if (item.all_day) return day;
  const start = format(item.starts_at, { hour: '2-digit', minute: '2-digit', hour12: false });
  const end = format(item.ends_at, { hour: '2-digit', minute: '2-digit', hour12: false });
  return end ? `${day} ${start} – ${end}` : `${day} ${start}`;
}

export function departureLabel(value: string | null) {
  const day = format(value, { month: 'long', day: 'numeric', weekday: 'short' });
  const time = format(value, { hour: '2-digit', minute: '2-digit', hour12: false });
  return day && time ? `${day} ${time}` : '';
}
