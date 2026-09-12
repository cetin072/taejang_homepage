(() => {
  'use strict';

  const MAX_ACCEPTABLE_ACCURACY_M = 80;
  const SAMPLE_WINDOW_MS = 6000;
  const ACQUISITION_TIMEOUT_MS = 14000;

  const error = code => ({ code });

  async function checkPermission() {
    if (!navigator.geolocation) throw error('GEOLOCATION_UNAVAILABLE');
    if (!navigator.permissions?.query) return 'unknown';
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      if (result?.state === 'denied') throw error('PERMISSION_DENIED');
      return result?.state || 'unknown';
    } catch (reason) {
      if (reason?.code === 'PERMISSION_DENIED') throw reason;
      return 'unknown';
    }
  }

  async function getBestPosition({ onStage } = {}) {
    await checkPermission();
    onStage?.('locating');
    return new Promise((resolve, reject) => {
      let best = null;
      let watchId = null;
      let settled = false;
      const finish = (value, failure) => {
        if (settled) return;
        settled = true;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        clearTimeout(sampleTimer);
        clearTimeout(timeoutTimer);
        if (failure) reject(failure);
        else resolve(value);
      };
      const sampleTimer = setTimeout(() => {
        if (best && best.coords.accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
          onStage?.('improving', best.coords.accuracy);
        }
      }, SAMPLE_WINDOW_MS);
      const timeoutTimer = setTimeout(() => finish(best, best ? null : error('TIMEOUT')), ACQUISITION_TIMEOUT_MS);

      watchId = navigator.geolocation.watchPosition(position => {
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        if (best.coords.accuracy <= MAX_ACCEPTABLE_ACCURACY_M) return finish(best);
        onStage?.('improving', best.coords.accuracy);
      }, reason => {
        if (best && reason?.code !== 1) return finish(best);
        finish(null, error(reason?.code === 1 ? 'PERMISSION_DENIED' : reason?.code === 3 ? 'TIMEOUT' : 'POSITION_UNAVAILABLE'));
      }, {
        enableHighAccuracy: true,
        timeout: ACQUISITION_TIMEOUT_MS,
        maximumAge: 0
      });
    });
  }

  window.TaejangAttendanceLocation = { checkPermission, getBestPosition };
})();