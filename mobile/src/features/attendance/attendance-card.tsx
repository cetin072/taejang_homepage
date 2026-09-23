import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  loadMyAttendanceToday,
  recordAttendanceEvent,
  requestAttendanceException,
  validateAttendanceQa,
  type AttendanceEvent,
  type AttendanceEventType,
  type AttendanceToday,
} from './attendance-api';
import {
  AttendanceLocationError,
  getBestAttendancePosition,
  type AttendancePosition,
} from './attendance-location';
import { usePlatform } from '@/src/providers/platform-provider';

type ExceptionFailureCode = 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'LOCATION_UNCERTAIN';
export type AttendanceCardMode = 'record' | 'qa';

function formatTime(value: string | null | undefined) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function completed(event: AttendanceEvent | null) {
  return Boolean(event && ['recorded', 'exception_approved', 'corrected'].includes(event.status));
}

export function AttendanceCard({
  minHeight = 164,
  mode = 'record',
}: {
  minHeight?: number;
  mode?: AttendanceCardMode;
}) {
  const { client, session } = usePlatform();
  const [today, setToday] = useState<AttendanceToday | null>(null);
  const [qaClockInAt, setQaClockInAt] = useState<string | null>(null);
  const [qaClockOutAt, setQaClockOutAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<AttendanceEventType | null>(null);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [exceptionTarget, setExceptionTarget] = useState<{
    eventType: AttendanceEventType;
    failureCode: ExceptionFailureCode;
    position: AttendancePosition | null;
  } | null>(null);
  const attempts = useRef<Record<AttendanceEventType, number>>({ clock_in: 0, clock_out: 0 });

  const refresh = useCallback(async () => {
    if (!client || !session) return null;
    setLoading(true);
    try {
      const next = await loadMyAttendanceToday(client);
      setToday(next);
      return next;
    } catch {
      setMessage('출퇴근 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      setMessageError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    if (!client || !session) return;
    void refresh();
  }, [client, session, refresh]);

  useEffect(() => {
    if (
      !today
      || today.is_workday === false
      || today.clock_in_available !== false
      || !today.server_time
      || !today.clock_in_available_at
    ) return;

    const serverNow = new Date(today.server_time).getTime();
    const availableAt = new Date(today.clock_in_available_at).getTime();
    const waitMs = availableAt - serverNow;
    if (!Number.isFinite(waitMs) || waitMs <= 0) return;

    const timer = setTimeout(() => void refresh(), waitMs + 250);
    return () => clearTimeout(timer);
  }, [
    refresh,
    today?.clock_in_available,
    today?.clock_in_available_at,
    today?.is_workday,
    today?.server_time,
  ]);

  function show(text: string, error = false) {
    setMessage(text);
    setMessageError(error);
  }

  function allowException(
    eventType: AttendanceEventType,
    failureCode: ExceptionFailureCode,
    position: AttendancePosition | null,
  ) {
    if ((mode === 'qa' && today?.attendance_required === false) || attempts.current[eventType] < 2) return;
    setExceptionTarget({ eventType, failureCode, position });
  }

  async function record(eventType: AttendanceEventType) {
    if (!client || busy) return;
    setBusy(eventType);
    setExceptionTarget(null);
    attempts.current[eventType] += 1;
    let position: AttendancePosition | null = null;

    try {
      const latest = await loadMyAttendanceToday(client);
      setToday(latest);

      const qaAttempt = mode === 'qa' && latest.attendance_required === false;

      if (!qaAttempt && latest.attendance_required === false) {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('근태 기록 제외 대상입니다.', true);
        return;
      }

      if (!qaAttempt && latest.is_workday === false) {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('오늘은 출근일이 아닙니다.', true);
        return;
      }

      if (!qaAttempt && eventType === 'clock_in' && latest.clock_in_available === false) {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('오전 6시부터 출근할 수 있습니다.', true);
        return;
      }

      position = await getBestAttendancePosition({
        onStage: stage => {
          show(stage === 'improving'
            ? '위치 정확도를 확인하고 있습니다.'
            : '현재 위치를 확인하고 있습니다.');
        },
      });

      show(qaAttempt
        ? '검수 서버에서 GPS·근무일·출입 위치를 확인하고 있습니다.'
        : '출퇴근 기록을 확인하고 있습니다.');

      const result = qaAttempt
        ? await validateAttendanceQa(client, eventType, position, Boolean(qaClockInAt))
        : await recordAttendanceEvent(client, eventType, position);

      if (result.ok || (!qaAttempt && ['ALREADY_RECORDED', 'EXCEPTION_APPROVED'].includes(result.code || ''))) {
        attempts.current[eventType] = 0;

        if (qaAttempt) {
          if (result.writes_attendance !== false) {
            throw new Error('QA_WRITE_GUARD_FAILED');
          }
          const checkedAt = result.server_time || new Date().toISOString();
          if (eventType === 'clock_in') setQaClockInAt(checkedAt);
          else setQaClockOutAt(checkedAt);
          show(
            eventType === 'clock_in'
              ? '검수 출근 정상 · GPS와 서버 경로가 정상이며 실제 근태에는 반영되지 않았습니다.'
              : '검수 퇴근 정상 · 출근·퇴근 검수 흐름이 정상이며 실제 근태에는 반영되지 않았습니다.',
          );
          return;
        }

        show(eventType === 'clock_in' ? '출근이 기록되었습니다.' : '퇴근이 기록되었습니다.');
        await refresh();
        return;
      }

      if (result.code === 'LOCATION_UNCERTAIN') {
        show(
          attempts.current[eventType] < 2
            ? '위치가 정확하지 않습니다. 잠시 후 다시 눌러주세요.'
            : '위치를 두 번 확인했지만 정확하지 않습니다.',
          true,
        );
        allowException(eventType, 'LOCATION_UNCERTAIN', position);
      } else if (result.code === 'OUTSIDE_GEOFENCE') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('회사 출근 장소 안에서만 출퇴근할 수 있습니다.', true);
      } else if (result.code === 'CLOCK_IN_REQUIRED') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show(qaAttempt ? '먼저 검수 출근을 완료해주세요.' : '먼저 출근 처리가 완료되어야 합니다.', true);
      } else if (result.code === 'CLOCK_IN_TOO_EARLY') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('오전 6시부터 출근할 수 있습니다.', true);
        await refresh();
      } else if (result.code === 'NON_WORKDAY') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('오늘은 휴일입니다. 휴일근무가 지정된 직원만 출퇴근할 수 있습니다.', true);
      } else if (result.code === 'ATTENDANCE_NOT_REQUIRED' || result.code === 'FORBIDDEN') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show(
          qaAttempt
            ? '현재 계정에는 출퇴근 검수 권한이 없습니다.'
            : '현재 계정으로는 출퇴근을 등록할 수 없습니다.',
          true,
        );
      } else if (result.code === 'ATTENDANCE_LOCATION_UNAVAILABLE') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('회사 출근 위치 설정을 확인하지 못했습니다.', true);
      } else {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show(
          qaAttempt
            ? '출퇴근 검수 경로를 확인하지 못했습니다. 네트워크와 서버 상태를 확인해주세요.'
            : '출퇴근 기록을 처리하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.',
          true,
        );
      }
    } catch (error) {
      if (error instanceof AttendanceLocationError) {
        if (error.code === 'PERMISSION_DENIED') {
          attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
          show('출퇴근을 위해 휴대폰의 위치 권한을 허용해주세요.', true);
        } else {
          show(
            attempts.current[eventType] < 2
              ? '위치를 확인하지 못했습니다. 다시 한 번 눌러주세요.'
              : '위치를 두 번 확인하지 못했습니다.',
            true,
          );
          allowException(eventType, error.code, position);
        }
      } else if (error instanceof Error && error.message === 'QA_WRITE_GUARD_FAILED') {
        show('안전 검수 조건을 확인하지 못해 중단했습니다. 실제 근태 저장은 실행하지 않았습니다.', true);
      } else {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show(
          (mode === 'qa' && today?.attendance_required === false)
            ? '검수 서버와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.'
            : '서버와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.',
          true,
        );
      }
    } finally {
      setBusy(null);
    }
  }

  async function requestException() {
    if (qaMode || !client || !exceptionTarget || busy) return;
    setBusy(exceptionTarget.eventType);
    try {
      const result = await requestAttendanceException(
        client,
        exceptionTarget.eventType,
        exceptionTarget.failureCode,
        exceptionTarget.position,
      );
      if (!result.ok && result.code !== 'EXCEPTION_PENDING') {
        throw new Error(result.code || 'REQUEST_FAILED');
      }
      show('관리자에게 확인을 요청했습니다.');
      attempts.current[exceptionTarget.eventType] = 0;
      setExceptionTarget(null);
      await refresh();
    } catch {
      show('관리자 확인 요청을 처리하지 못했습니다.', true);
    } finally {
      setBusy(null);
    }
  }

  const qaMode = mode === 'qa' && today?.attendance_required === false;
  const clockIn = today?.clock_in || null;
  const clockOut = today?.clock_out || null;
  const clockedIn = completed(clockIn);
  const clockedOut = completed(clockOut);
  const pending = clockIn?.status === 'exception_pending' || clockOut?.status === 'exception_pending';

  let action: AttendanceEventType | null = 'clock_in';
  let title = '출근했습니다';
  let subtitle = '회사에서 눌러주세요';

  if (qaMode) {
    if (qaClockOutAt) {
      action = null;
      title = '검수 완료';
      subtitle = `${formatTime(qaClockInAt)} – ${formatTime(qaClockOutAt)} · 실제 근태 미반영`;
    } else if (qaClockInAt) {
      action = 'clock_out';
      title = '퇴근했습니다';
      subtitle = `검수 출근 ${formatTime(qaClockInAt)} · 실제 근태 미반영`;
    } else {
      action = 'clock_in';
      title = '출근했습니다';
      subtitle = '검수용 버튼 · 실제 근태에 반영되지 않음';
    }
  } else if (today?.attendance_required === false) {
    action = null;
    title = '근태 기록 제외 대상';
    subtitle = '근태 기록 제외 대상입니다.';
  } else if (pending) {
    action = null;
    title = '관리자 확인 중';
    subtitle = '요청한 출퇴근 기록을 확인하고 있습니다';
  } else if (clockedOut) {
    action = null;
    title = '오늘 근무 완료';
    subtitle = `${formatTime(clockIn?.event_at)} – ${formatTime(clockOut?.event_at)}`;
  } else if (clockedIn) {
    action = 'clock_out';
    title = '퇴근했습니다';
    subtitle = `출근 ${formatTime(clockIn?.event_at)}`;
  } else if (today?.is_workday === false) {
    action = null;
    title = '오늘은 출근일이 아닙니다';
    subtitle = today?.day_reason || '휴일입니다';
  } else if (today?.clock_in_available === false) {
    action = null;
    title = '출근 전입니다';
    subtitle = '오전 6시부터 출근할 수 있습니다';
  } else if (today?.holiday_work_assigned) {
    subtitle = '휴일근무일입니다 · 회사에서 눌러주세요';
  }

  function handleAction() {
    if (!action || busy || loading) return;
    if (action === 'clock_out') {
      Alert.alert(
        qaMode ? '검수 퇴근 확인' : '퇴근 확인',
        qaMode
          ? '검수용 퇴근 흐름을 확인합니다. 실제 근태에는 반영되지 않습니다.'
          : '정말 퇴근하시겠습니까?',
        [
          { text: '취소', style: 'cancel' },
          {
            text: qaMode ? '검수 계속' : '퇴근했습니다',
            style: qaMode ? 'default' : 'destructive',
            onPress: () => void record('clock_out'),
          },
        ],
        { cancelable: true },
      );
      return;
    }
    void record(action);
  }

  function resetQa() {
    if (busy) return;
    setQaClockInAt(null);
    setQaClockOutAt(null);
    setExceptionTarget(null);
    attempts.current = { clock_in: 0, clock_out: 0 };
    show('출퇴근 검수를 다시 시작할 수 있습니다.');
  }

  return (
    <View style={styles.wrap}>
      {qaMode ? (
        <Text style={styles.qaBadge}>검수 모드 · 실제 근태에 반영되지 않음</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        disabled={loading || Boolean(busy) || !action}
        onPress={handleAction}
        style={({ pressed }) => [
          styles.action,
          { minHeight },
          (!action || loading) ? styles.actionInactive : null,
          pressed && action ? styles.actionPressed : null,
        ]}
      >
        <Text style={styles.actionTitle}>
          {busy ? '확인 중…' : loading ? '출퇴근 확인 중…' : title}
        </Text>
        {subtitle ? <Text style={styles.actionSubtitle}>{subtitle}</Text> : null}
      </Pressable>

      {message ? <Text style={messageError ? styles.error : styles.message}>{message}</Text> : null}

      {qaMode && qaClockOutAt ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="출퇴근 검수 다시 시작"
          disabled={Boolean(busy)}
          onPress={resetQa}
          style={styles.qaResetButton}
        >
          <Text style={styles.qaResetText}>다시 검수</Text>
        </Pressable>
      ) : null}

      {!qaMode && exceptionTarget ? (
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(busy)}
          onPress={() => void requestException()}
          style={styles.exceptionButton}
        >
          <Text style={styles.exceptionText}>{busy ? '요청 중…' : '관리자 확인 요청'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  qaBadge: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#fff4d8',
    color: '#795b12',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 28,
    backgroundColor: '#173f31',
  },
  actionInactive: { backgroundColor: '#879b8d' },
  actionPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  actionTitle: { color: '#ffffff', fontSize: 31, fontWeight: '900', letterSpacing: -0.6 },
  actionSubtitle: { color: '#e4efe8', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  message: {
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#e6f0e9',
    color: '#214b35',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  error: {
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#fff0ed',
    color: '#8b2f2f',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  qaResetButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cfb46e',
    backgroundColor: '#fffaf0',
  },
  qaResetText: { color: '#6b5314', fontSize: 16, fontWeight: '900' },
  exceptionButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#eef1ec',
  },
  exceptionText: { color: '#173f31', fontSize: 16, fontWeight: '800' },
});
