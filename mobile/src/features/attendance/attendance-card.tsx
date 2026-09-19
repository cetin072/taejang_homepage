import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  loadMyAttendanceToday,
  recordAttendanceEvent,
  requestAttendanceException,
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

export function AttendanceCard() {
  const { client, session } = usePlatform();
  const [today, setToday] = useState<AttendanceToday | null>(null);
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

  function show(text: string, error = false) {
    setMessage(text);
    setMessageError(error);
  }

  function allowException(
    eventType: AttendanceEventType,
    failureCode: ExceptionFailureCode,
    position: AttendancePosition | null,
  ) {
    if (attempts.current[eventType] < 2) return;
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

      if (latest.attendance_required === false) {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('현재 계정은 근태 기록 대상이 아닙니다.', true);
        return;
      }
      if (latest.is_workday === false) {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('오늘은 휴일입니다. 휴일근무가 지정된 직원만 출퇴근할 수 있습니다.', true);
        return;
      }

      position = await getBestAttendancePosition({
        onStage: stage => {
          show(stage === 'improving'
            ? '위치 정확도를 확인하고 있습니다.'
            : '현재 위치를 확인하고 있습니다.');
        },
      });

      show('출퇴근 기록을 확인하고 있습니다.');
      const result = await recordAttendanceEvent(client, eventType, position);

      if (result.ok || ['ALREADY_RECORDED', 'EXCEPTION_APPROVED'].includes(result.code || '')) {
        attempts.current[eventType] = 0;
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
        show('먼저 출근 처리가 완료되어야 합니다.', true);
      } else if (result.code === 'NON_WORKDAY') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('오늘은 휴일입니다. 휴일근무가 지정된 직원만 출퇴근할 수 있습니다.', true);
      } else if (result.code === 'ATTENDANCE_NOT_REQUIRED' || result.code === 'FORBIDDEN') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('현재 계정으로는 출퇴근을 등록할 수 없습니다.', true);
      } else {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('출퇴근 기록을 처리하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.', true);
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
      } else {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('서버와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.', true);
      }
    } finally {
      setBusy(null);
    }
  }

  async function requestException() {
    if (!client || !exceptionTarget || busy) return;
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

  const clockIn = today?.clock_in || null;
  const clockOut = today?.clock_out || null;
  const clockedIn = completed(clockIn);
  const clockedOut = completed(clockOut);
  const pending = clockIn?.status === 'exception_pending' || clockOut?.status === 'exception_pending';

  let action: AttendanceEventType | null = 'clock_in';
  let title = '출근하기';
  let subtitle = today?.is_workday === false ? '오늘은 휴일입니다' : '회사에서 눌러주세요';

  if (today?.attendance_required === false) {
    action = null;
    title = '근태 기록 대상 아님';
    subtitle = '';
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
    title = '퇴근하기';
    subtitle = `출근 ${formatTime(clockIn?.event_at)}`;
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        disabled={loading || Boolean(busy) || !action}
        onPress={() => action && void record(action)}
        style={({ pressed }) => [
          styles.action,
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

      {exceptionTarget ? (
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(busy)}
          onPress={() => void requestException()}
          style={styles.exceptionButton}
        >
          <Text style={styles.exceptionText}>{busy ? '요청 중…' : '관리자 확인 요청'}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.footer}>위치는 출근·퇴근 버튼을 누르는 순간에만 확인합니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  action: {
    minHeight: 118,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: 20,
    borderRadius: 24,
    backgroundColor: '#173f31',
  },
  actionInactive: { backgroundColor: '#82978a' },
  actionPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  actionTitle: { color: '#ffffff', fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  actionSubtitle: { color: '#dcebe2', fontSize: 14, fontWeight: '700' },
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
  exceptionButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#eef1ec',
  },
  exceptionText: { color: '#173f31', fontSize: 16, fontWeight: '800' },
  footer: { color: '#708077', fontSize: 11, textAlign: 'center' },
});
