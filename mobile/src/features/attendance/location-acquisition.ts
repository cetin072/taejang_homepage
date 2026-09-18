import * as Location from 'expo-location';

export type AttendanceLocationFailureCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT';

export type AttendancePosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export class AttendanceLocationError extends Error {
  readonly code: AttendanceLocationFailureCode;

  constructor(code: AttendanceLocationFailureCode) {
    super(code);
    this.code = code;
  }
}

const MAX_ACCEPTABLE_ACCURACY_M = 80;
const ACQUISITION_TIMEOUT_MS = 14_000;

export async function getBestAttendancePosition(
  onStage?: (stage: 'requesting' | 'improving', accuracy?: number) => void,
): Promise<AttendancePosition> {
  onStage?.('requesting');

  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new AttendanceLocationError('PERMISSION_DENIED');

  return new Promise<AttendancePosition>((resolve, reject) => {
    let finished = false;
    let best: AttendancePosition | null = null;
    let subscription: Location.LocationSubscription | null = null;

    const cleanup = () => {
      if (subscription) {
        subscription.remove();
        subscription = null;
      }
      clearTimeout(timeout);
    };

    const finish = (position?: AttendancePosition, error?: AttendanceLocationError) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (position) resolve(position);
      else reject(error || new AttendanceLocationError('POSITION_UNAVAILABLE'));
    };

    const timeout = setTimeout(() => {
      if (best) finish(best);
      else finish(undefined, new AttendanceLocationError('TIMEOUT'));
    }, ACQUISITION_TIMEOUT_MS);

    void Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        timeInterval: 750,
        distanceInterval: 0,
      },
      sample => {
        const accuracy = sample.coords.accuracy;
        if (
          typeof accuracy !== 'number'
          || !Number.isFinite(accuracy)
          || accuracy < 0
          || accuracy > 5000
        ) {
          return;
        }

        const candidate: AttendancePosition = {
          latitude: sample.coords.latitude,
          longitude: sample.coords.longitude,
          accuracy,
        };

        if (!best || candidate.accuracy < best.accuracy) best = candidate;
        if (best.accuracy <= MAX_ACCEPTABLE_ACCURACY_M) {
          finish(best);
          return;
        }
        onStage?.('improving', best.accuracy);
      },
    )
      .then(nextSubscription => {
        if (finished) {
          nextSubscription.remove();
          return;
        }
        subscription = nextSubscription;
      })
      .catch(() => finish(undefined, new AttendanceLocationError('POSITION_UNAVAILABLE')));
  });
}

export const attendanceLocationPolicy = {
  serverAccuracyThresholdMeters: MAX_ACCEPTABLE_ACCURACY_M,
  acquisitionTimeoutMs: ACQUISITION_TIMEOUT_MS,
  backgroundTrackingEnabled: false,
  clientGeofenceDecisionEnabled: false,
} as const;
