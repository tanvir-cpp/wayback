import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { guidance, initialState, pathLength, reducer, Saved, STEP_M } from './path';
import { startSensors, SensorStatus } from './sensors';
import { startForeground, stopForeground } from './foreground';
import { clearVisit, loadVisit, saveVisit } from './storage';

const buzz = (kind: 'success' | 'medium') =>
  (kind === 'success'
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  ).catch(() => {});

export function useSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sensors, setSensors] = useState<SensorStatus | null>(null);
  const [background, setBackground] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef<(() => void) | null>(null);
  const latest = useRef(state);
  const lastSave = useRef(0);
  const active = state.mode === 'tracking' || state.mode === 'returning';

  const stopSensors = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    stopForeground();
  }, []);

  /** Start the sensors and the background service for a visit (new or resumed). */
  const begin = useCallback(async () => {
    stopSensors();
    setBackground(await startForeground());
    const { status, stop } = await startSensors({
      onSteps: (count) => dispatch({ type: 'step', count }),
      onHeading: (deg) => dispatch({ type: 'heading', deg }),
      onFloor: (delta) => { dispatch({ type: 'floor', delta }); buzz('medium'); },
    });
    stopRef.current = stop;
    setSensors(status);
  }, [stopSensors]);

  const start = useCallback(() => {
    dispatch({ type: 'start', at: Date.now() });
    buzz('success');
    return begin();
  }, [begin]);

  const reset = useCallback(() => {
    stopSensors();
    setSensors(null);
    clearVisit();
    dispatch({ type: 'reset' });
  }, [stopSensors]);

  const resume = useCallback(() => {
    if (!saved) return;
    dispatch({ type: 'restore', saved });
    setSaved(null);
    return begin();
  }, [saved, begin]);

  const discard = useCallback(() => {
    clearVisit();
    setSaved(null);
  }, []);

  // On launch, offer to continue a visit that was interrupted
  useEffect(() => {
    loadVisit().then(setSaved);
  }, []);

  // Persist the visit: at most every 3 s while it changes, and immediately when the app is backgrounded
  useEffect(() => {
    latest.current = state;
    if (!active) return;
    const t = Date.now();
    if (t - lastSave.current > 3000) {
      lastSave.current = t;
      saveVisit(state);
    }
  }, [state, active]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const cur = latest.current;
      if (s !== 'active' && (cur.mode === 'tracking' || cur.mode === 'returning')) saveVisit(cur);
    });
    return () => sub.remove();
  }, []);

  // Keep the screen on while recording (the foreground service covers the screen-off case)
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
    if (state.mode === 'arrived') {
      dispatch({ type: 'finish', at: Date.now() });
      buzz('success');
      stopSensors();
      clearVisit();
    }
  }, [state.mode, stopSensors]);

  useEffect(() => stopSensors, [stopSensors]);

  const remainingM = pathLength(state.path);
  const end = state.endedAt || now;
  return {
    state,
    dispatch,
    sensors,
    background,
    saved,
    start,
    reset,
    resume,
    discard,
    guide: guidance(state),
    stats: {
      distanceM: Math.round(state.steps * STEP_M),
      seconds: state.startedAt ? Math.max(0, Math.round((end - state.startedAt) / 1000)) : 0,
      remainingM: Math.round(remainingM),
      percentBack: state.returnTotalM > 0 ? Math.round((1 - remainingM / state.returnTotalM) * 100) : 0,
    },
  };
}
