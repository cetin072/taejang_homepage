import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

import {
  attendanceEventPending,
  attendanceEventRecorded,
  loadMyAttendanceToday,
  recordMyAttendance,
  requestMyAttendanceException,
  type AttendanceEventType,
  type AttendanceToday,
} from '@/src/features/attendance/attendance-api';
import {
  AttendanceLocationError,
  getBestAttendancePosition,
  type AttendancePosition,
} from '@/src/features/attendance/location-acquisition';
import { usePlatform } from '@/src/providers/platform-provider';

type ExceptionCandidate = {
  eventType: AttendanceEventType;
  code: 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'LOCATION_UNCERTAIN';
  position: AttendancePosition | null;
};

function timeLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function eventLabel(eventType: AttendanceEventType) {
  return eventType === 'clock_in' ? '출근' : '퇴근';
}

export function AttendanceCard() {
  const { client, session } = usePlatform();
  const [today, setToday] = useState<AttendanceToday | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<AttendanceEventType | 'exception' | null>(null);
  const [message, setMessage] = useState('');
  const [failureCounts, setFailureCounts] = useState<Record<AttendanceEventType, number>>({
    clock_in: 0,
    clock_out: 0,
  });
  const [exceptionCandidate, setExceptionCandidate] = useState<ExceptionCandidate | null>(null);

  async function reload() {
    if (!client || !session) return;
    setLoading(true);
    try {
      setToday(await loadMyAttendanceToday(client));
    } catch {
      setMessage('출퇴근 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!client || !session) {
      setToday(null);
      return;
    }
    void reload();
  }, [client, session?.access_token]);

  function clearFailure(eventType: AttendanceEventType) {
    setFailureCounts(current => ({ ...current, [eventType]: 0 }));
    setExceptionCandidate(current => current?.eventType === eventType ? null : current);
  }

  function registerLocationFailure(
    eventType: AttendanceEventType,
    code: ExceptionCandidate['code'],
    position: AttendancePosition | null,
    allowException = true,
  ) {
    setFailureCounts(current => {
      const nextCount = current[eventType] + 1;
      if (allowException && nextCount >= 2) {
        setExceptionCandidate({ eventType, code, position });
      }
      return { ...current, [eventType]: nextCount };
    });

    if (code === 'LOCATION_UNCERTAIN') {
      setMessage('위치 정확도가 충분하지 않습니다. 잠시 후 한 번 더 시도해 주세요.');
    } else if (code === 'TIMEOUT') {
      setMessage('현재 위치 확인이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.');
    } else {
      setMessage('현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  async function attempt(eventType: AttendanceEventType) {
    if (!client || !session || busy) return;
    setBusy(eventType);
    setMessage('현재 위치를 확인하고 있습니다.');
    setExceptionCandidate(null);

    let position: AttendancePosition;
    try {
      position = await getBestAttendancePosition((stage, accuracy) => {
        if (stage === 'improving' && typeof accuracy === 'number') {
          setMessage('GPS 정확도를 높이고 있습니다. 잠시만 기다려 주세요.');
        }
      });
    } catch (error) {
      if (error instanceof AttendanceLocationError) {
        if (error.code === 'PERMISSION_DENIED') {
          setMessage('출퇴근 기록에는 위치 권한이 필요합니다. 휴대폰 설정에서 위치 권한을 허용해 주세요. 관리자 요청으로 대신할 수 없습니다.');
        } else {
          registerLocationFailure(eventType, error.code, null);
        }
      } else {
        setMessage('위치 확인 중 오류가 발생했습니다. 다시 시도해 주세요.');
      }
      setBusy(null);
      return;
    }

    try {
      const result = await recordMyAttendance(client, eventType, position);
      const code = result.code || '';

      if (result.ok || code === 'ATTENDANCE_RECORDED' || code === 'ALREADY_RECORDED' || code === 'EXCEPTION_APPROVED') {
        clearFailure(eventType);
        setMessage(code === 'ALREADY_RECORDED'
          ? eventLabel(eventType) + ' 기록이 이미 저장되어 있습니다.'
          : eventLabel(eventType) + '했습니다.');
        await reload();
        return;
      }

      if (code === 'LOCATION_UNCERTAIN') {
        registerLocationFailure(eventType, 'LOCATION_UNCERTAIN', position, result.can_request_exception !== false);
      } else if (code === 'OUTSIDE_GEOFENCE' || code === 'OUTSIDE_GEOFENCE_NO_EXCEPTION') {
        clearFailure(eventType);
        setMessage('회사 출퇴근 가능 위치 밖입니다. 회사에 도착한 뒤 다시 시도해 주세요.');
      } else if (code === 'CLOCK_IN_REQUIRED') {
        setMessage('먼저 출근 기록을 완료해 주세요.');
      } else if (code === 'NON_WORKDAY') {
        setMessage('오늘은 출퇴근 기록 대상 근무일이 아닙니다.');
        await reload();
      } else if (code === 'EXCEPTION_PENDING') {
        setMessage('관리자 확인 요청이 이미 접수되어 있습니다.');
        await reload();
      } else if (code === 'EXCEPTION_REJECTED') {
        setMessage('관리자 확인 요청이 반려되었습니다. 회사에서 GPS로 다시 시도해 주세요.');
        await reload();
      } else if (code === 'FORBIDDEN' || code === 'ATTENDANCE_NOT_REQUIRED') {
        setMessage('이 계정은 현재 출퇴근 기록 대상이 아닙니다.');
        await reload();
      } else {
        setMessage('출퇴근 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } catch {
      setMessage('네트워크 또는 서버 연결을 확인해 주세요. 위치 실패 횟수에는 포함하지 않습니다.');
    } finally {
      setBusy(null);
    }
  }

  async function requestException() {
    if (!client || !session || !exceptionCandidate || busy) return;
    setBusy('exception');
    setMessage('관리자 확인을 요청하고 있습니다.');
    try {
      const result = await requestMyAttendanceException(
        client,
        exceptionCandidate.eventType,
        exceptionCandidate.code,
        exceptionCandidate.position,
      );
      if (result.ok || result.code === 'EXCEPTION_REQUESTED' || result.code === 'EXCEPTION_PENDING') {
        setMessage('관리자에게 한 번만 확인을 요청했습니다.');
        clearFailure(exceptionCandidate.eventType);
        setExceptionCandidate(null);
        await reload();
      } else if (result.code === 'OUTSIDE_GEOFENCE_NO_EXCEPTION') {
        setExceptionCandidate(null);
        setMessage('회사 밖으로 확인된 위치에서는 관리자 요청으로 대신할 수 없습니다.');
      } else {
        setMessage('관리자 확인 요청을 저장하지 못했습니다. 다시 시도해 주세요.');
      }
    } catch {
      setMessage('관리자 확인 요청 중 네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(null);
    }
  }

  if (!session) return null;

  const clockIn = today?.clock_in;
  const clockOut = today?.clock_out;
  const clockInDone = attendanceEventRecorded(clockIn);
  const clockOutDone = attendanceEventRecorded(clockOut);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>출퇴근</Text>
          <Text style={styles.help}>버튼을 누르는 순간에만 위치를 확인합니다.</Text>
        </View>
        {loading ? <ActivityIndicator /> : null}
      </View>

      {today?.attendance_required === false ? (
        <Text style={styles.state}>근태 기록 대상이 아닙니다.</Text>
      ) : today?.is_workday === false ? (
        <Text style={styles.state}>오늘은 휴일입니다. {today.day_reason || ''}</Text>
      ) : (
        <>
          <View style={styles.times}>
            <View style={styles.timeBox}>
              <Text style={styles.timeLabel}>출근</Text>
              <Text style={styles.timeValue}>{clockInDone ? timeLabel(clockIn?.event_at) : '미기록'}</Text>
            </View>
            <View style={styles.timeBox}>
              <Text style={styles.timeLabel}>퇴근</Text>
              <Text style={styles.timeValue}>{clockOutDone ? timeLabel(clockOut?.event_at) : '미기록'}</Text>
            </View>
          </View>

          {attendanceEventPending(clockIn) ? (
            <Text style={styles.pending}>출근 확인을 관리자에게 요청했습니다.</Text>
          ) : !clockInDone ? (
            <Button
              title={busy === 'clock_in' ? '위치 확인 중…' : '출근하기'}
              disabled={busy !== null}
              onPress={() => void attempt('clock_in')}
            />
          ) : attendanceEventPending(clockOut) ? (
            <Text style={styles.pending}>퇴근 확인을 관리자에게 요청했습니다.</Text>
          ) : !clockOutDone ? (
            <Button
              title={busy === 'clock_out' ? '위치 확인 중…' : '퇴근하기'}
              disabled={busy !== null}
              onPress={() => void attempt('clock_out')}
            />
          ) : (
            <Text style={styles.complete}>오늘 출퇴근 기록을 완료했습니다.</Text>
          )}
        </>
      )}

      {exceptionCandidate ? (
        <View style={styles.exception}>
          <Text style={styles.help}>위치 확인이 반복해서 실패했습니다. 같은 요청은 한 번만 보낼 수 있습니다.</Text>
          <Button
            title={busy === 'exception' ? '요청 중…' : '관리자 확인 요청'}
            disabled={busy !== null}
            onPress={() => void requestException()}
          />
        </View>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Button title="출퇴근 상태 새로고침" disabled={loading || busy !== null} onPress={() => void reload()} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { color: '#173f31', fontSize: 20, fontWeight: '800' },
  help: { color: '#60746a', fontSize: 14, lineHeight: 21 },
  state: { color: '#42574c', fontSize: 16, lineHeight: 24, fontWeight: '700' },
  times: { flexDirection: 'row', gap: 10 },
  timeBox: { flex: 1, gap: 5, padding: 13, borderRadius: 12, backgroundColor: '#f4f7f4' },
  timeLabel: { color: '#60746a', fontSize: 13, fontWeight: '700' },
  timeValue: { color: '#173f31', fontSize: 21, fontWeight: '800' },
  pending: { color: '#8a5b00', fontSize: 15, lineHeight: 22, fontWeight: '700' },
  complete: { color: '#1f6940', fontSize: 16, lineHeight: 23, fontWeight: '800' },
  exception: { gap: 9, padding: 12, borderRadius: 12, backgroundColor: '#fff7e8' },
  message: { color: '#42574c', fontSize: 14, lineHeight: 21 },
});
