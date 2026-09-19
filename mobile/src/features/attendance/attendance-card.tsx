import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

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
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul',
  }).format(date);
}

function completed(event: AttendanceEvent | null) {
  return Boolean(event?.event_at && ['recorded', 'exception_approved', 'corrected'].includes(event.status));
}

export function AttendanceCard() {
  const { client, session } = usePlatform();
  const [today, setToday] = useState<AttendanceToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<AttendanceEventType | null>(null);
  const busyRef = useRef(false);
  const requestVersion = useRef(0);
  const activeUser = useRef(session?.user.id);
  activeUser.current = session?.user.id;
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [exceptionTarget, setExceptionTarget] = useState<{
    eventType: AttendanceEventType;
    failureCode: ExceptionFailureCode;
    position: AttendancePosition | null;
  } | null>(null);
  const attempts = useRef<Record<AttendanceEventType, number>>({ clock_in: 0, clock_out: 0 });

  const refresh = useCallback(async () => {
    if (!client || !session) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError(false);
    try {
      const value = await loadMyAttendanceToday(client);
      if (version === requestVersion.current) setToday(value);
    } catch {
      if (version !== requestVersion.current) return;
      setLoadError(true);
      setMessage('출퇴근 정보를 불러오지 못했습니다. 아래 다시 확인을 눌러주세요.');
      setMessageError(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  function show(text: string, error = false) {
    setMessage(text);
    setMessageError(error);
  }

  function allowException(eventType: AttendanceEventType, failureCode: ExceptionFailureCode, position: AttendancePosition | null) {
    if (attempts.current[eventType] < 2) return;
    setExceptionTarget({ eventType, failureCode, position });
  }

  async function record(eventType: AttendanceEventType) {
    if (!client || busyRef.current || loading || loadError || !today || today.attendance_required === false) return;
    const userId = session?.user.id;
    busyRef.current = true;
    setBusy(eventType);
    setExceptionTarget(null);
    attempts.current[eventType] += 1;
    let position: AttendancePosition | null = null;
    try {
      position = await getBestAttendancePosition({
        onStage: stage => show(stage === 'improving' ? '위치 정확도를 확인하고 있습니다.' : '현재 위치를 확인하고 있습니다.'),
      });
      if (!userId || activeUser.current !== userId) return;
      show('서버에 출근·퇴근 기록을 확인하고 있습니다.');
      const result = await recordAttendanceEvent(client, eventType, position);
      if (result.ok || ['ALREADY_RECORDED', 'EXCEPTION_APPROVED'].includes(result.code || '')) {
        attempts.current[eventType] = 0;
        show(eventType === 'clock_in' ? '출근 기록을 확인했습니다.' : '퇴근 기록을 확인했습니다.');
        await refresh();
        return;
      }
      if (result.code === 'LOCATION_UNCERTAIN') {
        show(attempts.current[eventType] < 2
          ? '위치가 정확하지 않습니다. 잠시 후 다시 눌러주세요.'
          : '위치를 두 번 확인했지만 정확하지 않습니다.', true);
        allowException(eventType, 'LOCATION_UNCERTAIN', position);
      } else if (result.code === 'OUTSIDE_GEOFENCE') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('회사 출근 장소 안에서만 출퇴근할 수 있습니다.', true);
      } else if (result.code === 'CLOCK_IN_REQUIRED') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('먼저 출근 처리가 완료되어야 합니다.', true);
        await refresh();
      } else if (result.code === 'NON_WORKDAY') {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('오늘은 휴일이라 출퇴근을 등록할 수 없습니다.', true);
      } else if (result.code === 'FORBIDDEN') {
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
          show(attempts.current[eventType] < 2
            ? '위치를 확인하지 못했습니다. 다시 한 번 눌러주세요.'
            : '위치를 두 번 확인하지 못했습니다.', true);
          allowException(eventType, error.code, position);
        }
      } else {
        attempts.current[eventType] = Math.max(0, attempts.current[eventType] - 1);
        show('서버와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.', true);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function requestException() {
    if (!client || !exceptionTarget || busyRef.current || loadError) return;
    busyRef.current = true;
    setBusy(exceptionTarget.eventType);
    try {
      const result = await requestAttendanceException(client, exceptionTarget.eventType, exceptionTarget.failureCode, exceptionTarget.position);
      if (!result.ok && result.code !== 'EXCEPTION_PENDING') throw new Error(result.code || 'REQUEST_FAILED');
      show('관리자에게 한 번만 확인을 요청했습니다.');
      attempts.current[exceptionTarget.eventType] = 0;
      setExceptionTarget(null);
      await refresh();
    } catch {
      show('관리자 확인 요청을 처리하지 못했습니다.', true);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const clockIn = today?.clock_in || null;
  const clockOut = today?.clock_out || null;
  const clockedIn = completed(clockIn);
  const clockedOut = completed(clockOut);
  const ready = !loading && !loadError && today !== null;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>오늘 출퇴근</Text>
      {loading ? <Text style={styles.help}>출퇴근 상태를 확인하고 있습니다.</Text> : null}
      {loadError ? <Button title="다시 확인" disabled={Boolean(busy)} onPress={() => void refresh()} /> : null}
      {ready && today?.attendance_required === false ? <Text style={styles.help}>근태 기록 대상이 아닙니다.</Text> : null}
      {ready && today?.attendance_required !== false && today?.is_workday === false ? (
        <Text style={styles.state}>오늘은 휴일입니다.{today.day_reason ? ` (${today.day_reason})` : ''}</Text>
      ) : null}
      {ready && today?.attendance_required !== false && today?.is_workday !== false ? (
        <>
          {!clockedIn && clockIn?.status !== 'exception_pending' ? (
            <>
              <Text style={styles.state}>{clockIn?.status === 'exception_rejected'
                ? '관리자 확인이 반려되었습니다. 회사에서 다시 출근해주세요.'
                : clockIn?.status === 'correction_invalidated'
                  ? '기존 출근 기록이 무효 처리되었습니다. 운영팀장에게 확인해주세요.'
                  : '아직 출근 전입니다.'}</Text>
              <Button title={busy === 'clock_in' ? '확인 중…' : '출근하기'}
                disabled={Boolean(busy) || clockIn?.status === 'correction_invalidated'} onPress={() => void record('clock_in')} />
            </>
          ) : null}
          {clockIn?.status === 'exception_pending' ? <Text style={styles.pending}>출근 확인을 관리자에게 요청했습니다. 확인 중입니다.</Text> : null}
          {clockedIn ? (
            <View style={styles.timeBlock}>
              <Text style={styles.state}>출근 완료</Text>
              <Text style={styles.time}>{formatTime(clockIn?.event_at)}</Text>
              {clockIn?.status === 'corrected' ? <Text style={styles.help}>운영팀장 확인·수기 보정 기록</Text> : null}
            </View>
          ) : null}
          {clockedIn && !clockedOut && clockOut?.status !== 'exception_pending' && clockOut?.status !== 'correction_invalidated' ? (
            <Button title={busy === 'clock_out' ? '확인 중…' : '퇴근하기'} disabled={Boolean(busy)} onPress={() => void record('clock_out')} />
          ) : null}
          {clockOut?.status === 'correction_invalidated' ? <Text style={styles.help}>기존 퇴근 기록이 무효 처리되었습니다. 운영팀장에게 확인해주세요.</Text> : null}
          {clockOut?.status === 'exception_pending' ? <Text style={styles.pending}>퇴근 확인을 관리자에게 요청했습니다. 확인 중입니다.</Text> : null}
          {clockedOut ? (
            <View style={styles.timeBlock}>
              <Text style={styles.state}>퇴근 완료</Text>
              <Text style={styles.time}>{formatTime(clockOut?.event_at)}</Text>
              {clockOut?.status === 'corrected' ? <Text style={styles.help}>운영팀장 확인·수기 보정 기록</Text> : null}
              <Text style={styles.help}>오늘도 수고하셨습니다.</Text>
            </View>
          ) : null}
        </>
      ) : null}
      {message ? <Text style={messageError ? styles.error : styles.message}>{message}</Text> : null}
      {exceptionTarget && !loadError ? <Button title={busy ? '요청 중…' : '관리자 확인 요청'} disabled={Boolean(busy)} onPress={() => void requestException()} /> : null}
      <Text style={styles.footer}>위치는 출근·퇴근 버튼을 누르는 순간에만 확인합니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 18, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: StyleSheet.hairlineWidth, borderColor: '#d4e0d7' },
  eyebrow: { color: '#35624d', fontSize: 13, fontWeight: '700' },
  state: { color: '#173f31', fontSize: 19, fontWeight: '800', lineHeight: 27 },
  timeBlock: { gap: 4 },
  time: { color: '#173f31', fontSize: 30, fontWeight: '900' },
  pending: { padding: 12, borderRadius: 10, backgroundColor: '#fff5df', color: '#85520b', fontSize: 15, fontWeight: '700', lineHeight: 22 },
  message: { padding: 12, borderRadius: 10, backgroundColor: '#e6f0e9', color: '#214b35', fontSize: 14, lineHeight: 20 },
  error: { padding: 12, borderRadius: 10, backgroundColor: '#fdeaea', color: '#8b2f2f', fontSize: 14, lineHeight: 20 },
  help: { color: '#60746a', fontSize: 14, lineHeight: 21 },
  footer: { color: '#6d7e75', fontSize: 12, textAlign: 'center' },
});
