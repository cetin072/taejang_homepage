import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

type Face = { title: string; subtitle: string };

// Presentation only. The card calls this after a confirmed successful action,
// never from a render, refresh or attendance-state observer.
export function useAttendanceFeedback() {
  const angle = useRef(new Animated.Value(0)).current;
  const locked = useRef(false);
  const reduced = useRef(true); // No motion until OS preference is known.
  const generation = useRef(0);
  const mounted = useRef(true);
  const [turning, setTurning] = useState(false);
  const [face, setFace] = useState<Face | null>(null);

  function cancel() {
    generation.current++;
    angle.stopAnimation();
    angle.setValue(0);
    locked.current = false;
    if (mounted.current) { setTurning(false); setFace(null); }
  }

  useEffect(() => {
    mounted.current = true;
    let preferenceChanged = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      preferenceChanged = true;
      reduced.current = value;
      if (value) cancel();
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted.current && !preferenceChanged) reduced.current = value;
    }).catch(() => { /* Safe default: no rotation. */ });
    const state = AppState.addEventListener('change', value => {
      if (value !== 'active') cancel();
    });
    return () => { mounted.current = false; cancel(); motion.remove(); state.remove(); };
  }, []);

  function success(eventType: 'clock_in' | 'clock_out', outgoing: Face) {
    if (!mounted.current || locked.current || AppState.currentState !== 'active') return;
    // Never force vibration or ignore the OS setting. Unsupported devices and
    // native failures must not turn successful attendance into an error.
    try {
      const haptic = Platform.OS === 'android'
        ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
        : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void haptic.catch(() => {});
    } catch { /* Completion text remains the primary feedback. */ }
    if (eventType !== 'clock_in' || reduced.current) return;
    locked.current = true;
    setTurning(true);
    setFace(outgoing);
    const token = ++generation.current;
    Animated.timing(angle, { toValue: 90, duration: 130, useNativeDriver: true }).start(({ finished }) => {
      if (!finished || token !== generation.current || !mounted.current) return;
      // Change copy edge-on, then return from -90 to 0. Text is never mirrored.
      setFace(null);
      angle.setValue(-90);
      Animated.timing(angle, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
        if (token === generation.current && mounted.current) cancel();
      });
    });
  }

  return { angle, turning, face, locked, success, cancel };
}
