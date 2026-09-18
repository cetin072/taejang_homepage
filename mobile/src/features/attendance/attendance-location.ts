import * as Location from 'expo-location';

export const MAX_ACCEPTABLE_ACCURACY_M = 80;
const IMPROVEMENT_NOTICE_MS = 6000;
const FINAL_TIMEOUT_MS = 14000;

export type AttendanceLocationFailureCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT';

export class AttendanceLocationError extends Error {
  code: AttendanceLocationFailureCode;

  constructor(code: AttendanceLocationFailureCode, message: string) {
    super(message);
    this.name = 'AttendanceLocationError';
    this.code = code;
  }
}

export type AttendancePosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

function normalizePosition(location: Location.LocationObject): AttendancePosition {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: Math.max(0, Number(location.coords.accuracy || 0)),
    timestamp: location.timestamp,
  };
}

export async function getBestAttendancePosition(options: {
  onStage?: (stage: 'locating' | 'improving', accuracy?: number) => void;
} = {}): Promise<AttendancePosition> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new AttendanceLocationError('PERMISSION_DENIED', '출퇴근을 위해 위치 권한이 필요합니다.');
  }

  if (!await Location.hasServicesEnabledAsync()) {
    throw new AttendanceLocationError('POSITION_UNAVAILABLE', '휴대폰 위치 기능이 꺼져 있습니다.');
  }

  options.onStage?.('locating');

  return new Promise<AttendancePosition>((resolve, reject) => {
    let settled = false;
    let best: AttendancePosition | null = null;
    let subscription: Location.LocationSubscription | null = null;

    const cleanup = () => {
      clearTimeout(improvementTimer);
      clearTimeout(finalTimer);
      subscription?.remove();
    };

    const finish = (position: AttendancePosition) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(position);
    };

    const fail = (error: AttendanceLocationError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const improvementTimer = setTimeout(() => {
      if (settled) return;
      options.onStage?.('improving', best?.accuracy);
    }, IMPROVEMENT_NOTICE_MS);

    const finalTimer = setTimeout(() => {
      if (best) finish(best);
      else fail(new AttendanceLocationError('TIMEOUT', '현재 위치를 확인하지 못했습니다.'));
    }, FINAL_TIMEOUT_MS);

    void Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        timeInterval: 800,
        distanceInterval: 0,
        mayShowUserSettingsDialog: true,
      },
      location => {
        const next = normalizePosition(location);
        if (!best || next.accuracy < best.accuracy) best = next;
        if (next.accuracy <= MAX_ACCEPTABLE_ACCURACY_M) finish(next);
        else options.onStage?.('improving', next.accuracy);
      },
      () => {
        if (best) finish(best);
        else fail(new AttendanceLocationError('POSITION_UNAVAILABLE', '현재 위치를 확인하지 못했습니다.'));
      },
    ).then(nextSubscription => {
      subscription = nextSubscription;
      if (settled) subscription.remove();
    }).catch(() => {
      fail(new AttendanceLocationError('POSITION_UNAVAILABLE', '현재 위치를 확인하지 못했습니다.'));
    });
  });
}
