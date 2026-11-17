import { Platform } from 'react-native';
import { Accelerometer, Barometer, Magnetometer, Pedometer } from 'expo-sensors';
import { FloorDetector, computeHeading, smoothHeading } from './path';

export interface SensorHandlers {
  onSteps: (count: number) => void;
  onHeading: (deg: number) => void;
  onFloor: (delta: number) => void;
}
export interface SensorStatus { steps: 'pedometer' | 'motion' | 'none'; compass: boolean; floors: boolean }

type Sub = { remove: () => void };

/** Starts step counting, compass and barometer. Returns what is actually available plus a stop function. */
export async function startSensors(h: SensorHandlers): Promise<{ status: SensorStatus; stop: () => void }> {
  const subs: Sub[] = [];
  const status: SensorStatus = { steps: 'none', compass: false, floors: false };
  if (Platform.OS === 'web') return { status, stop: () => {} };

  const safe = async <T,>(fn: () => Promise<T>, fallback: T) => {
    try { return await fn(); } catch { return fallback; }
  };

  // --- Steps: hardware pedometer when permitted, otherwise detect steps from accelerometer peaks
  const pedometerOk =
    (await safe(() => Pedometer.isAvailableAsync(), false)) &&
    (await safe(async () => (await Pedometer.requestPermissionsAsync()).granted, false));
  if (pedometerOk) {
    let last = 0;
    subs.push(Pedometer.watchStepCount(({ steps }) => {
      const delta = steps - last; // updates can arrive in batches, so count the difference
      last = steps;
      if (delta > 0) h.onSteps(delta);
    }));
    status.steps = 'pedometer';
  }

  // --- Accelerometer: gravity for tilt-compensated heading, and step fallback
  const accelOk = await safe(() => Accelerometer.isAvailableAsync(), false);
  let acc = { x: 0, y: 0, z: 1 };
  let smooth = 1;
  let wasAbove = false;
  let lastStepAt = 0;
  if (accelOk) {
    Accelerometer.setUpdateInterval(40);
    subs.push(Accelerometer.addListener((a) => {
      acc = a;
      if (status.steps === 'pedometer') return;
      const mag = Math.hypot(a.x, a.y, a.z);
      smooth += 0.3 * (mag - smooth);
      const above = smooth > 1.12;
      const now = Date.now();
      if (above && !wasAbove && now - lastStepAt > 300) {
        lastStepAt = now;
        h.onSteps(1);
      }
      wasAbove = above;
    }));
    if (status.steps === 'none') status.steps = 'motion';
  }

  // --- Compass
  if (accelOk && (await safe(() => Magnetometer.isAvailableAsync(), false))) {
    Magnetometer.setUpdateInterval(100);
    let heading: number | null = null;
    let sent = -999;
    subs.push(Magnetometer.addListener((m) => {
      heading = smoothHeading(heading, computeHeading(acc, m));
      if (Math.abs(heading - sent) > 2) {
        sent = heading;
        h.onHeading(heading);
      }
    }));
    status.compass = true;
  }

  // --- Floors from air pressure
  if (await safe(() => Barometer.isAvailableAsync(), false)) {
    const detector = new FloorDetector();
    Barometer.setUpdateInterval(500);
    subs.push(Barometer.addListener(({ pressure }) => {
      const delta = detector.feed(pressure, Date.now());
      if (delta) h.onFloor(delta);
    }));
    status.floors = true;
  }

  return { status, stop: () => subs.forEach((s) => s.remove()) };
}
