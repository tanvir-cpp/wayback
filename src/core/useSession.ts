import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { guidance, initialState, pathLength, reducer, STEP_M } from './path';
import { startSensors, SensorStatus } from './sensors';

const buzz = (kind: 'success' | 'medium') =>
  (kind === 'success'
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  ).catch(() => {});

export function useSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sensors, setSensors] = useState<SensorStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef<(() => void) | null>(null);
  const active = state.mode === 'tracking' || state.mode === 'returning';

  const stopSensors = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stopSensors();
    dispatch({ type: 'start', at: Date.now() });
    buzz('success');
    const { status, stop } = await startSensors({
      onSteps: (count) => dispatch({ type: 'step', count }),
      onHeading: (deg) => dispatch({ type: 'heading', deg }),
      onFloor: (delta) => { dispatch({ type: 'floor', delta }); buzz('medium'); },
    });
    stopRef.current = stop;
    setSensors(status);
  }, [stopSensors]);

  const reset = useCallback(() => {
    stopSensors();
    setSensors(null);
    dispatch({ type: 'reset' });
  }, [stopSensors]);

  // Keep the screen on while recording: sensors stop delivering when the phone sleeps.
  useEffect(() => {
    if (active) activateKeepAwakeAsync('route').catch(() => {});
    else deactivateKeepAwake('route').catch(() => {});
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (state.mode === 'arrived') { dispatch({ type: 'finish', at: Date.now() }); buzz('success'); stopSensors(); }
  }, [state.mode, stopSensors]);

  useEffect(() => stopSensors, [stopSensors]);

  const remainingM = pathLength(state.path);
  const end = state.endedAt || now;
  return {
    state,
    dispatch,
    sensors,
    start,
    reset,
    guide: guidance(state),
    stats: {
      distanceM: Math.round(state.steps * STEP_M),
      seconds: state.startedAt ? Math.max(0, Math.round((end - state.startedAt) / 1000)) : 0,
      remainingM: Math.round(remainingM),
      percentBack: state.returnTotalM > 0 ? Math.round((1 - remainingM / state.returnTotalM) * 100) : 0,
    },
  };
}
