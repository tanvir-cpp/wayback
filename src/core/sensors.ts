import { Platform } from 'react-native';
import { Accelerometer, Barometer, Gyroscope, Magnetometer, Pedometer } from 'expo-sensors';
import { FloorDetector, GravityFilter, HeadingFilter, StepDetector, computeHeading } from './path';

export interface SensorHandlers {
  onSteps: (count: number) => void;
  onHeading: (deg: number) => void;
  onFloor: (delta: number) => void;
}
export interface SensorStatus { steps: 'motion' | 'none'; pedometer: boolean; compass: boolean; gyro: boolean; floors: boolean }
type Sub = { remove: () => void };

const safe = async <T,>(fn: () => Promise<T>, fallback: T) => {
  try { return await fn(); } catch { return fallback; }
};

/**
 * Starts step counting, heading and floor detection.
 * - Steps: our own detector (works in hand/pocket/bag) merged with the hardware pedometer; we never count fewer
 *   steps than either source saw.
 * - Heading: gyroscope for smooth turns, gently corrected by the compass.
 * - Floors: barometric pressure.
 */
export async function startSensors(h: SensorHandlers): Promise<{ status: SensorStatus; stop: () => void }> {
  const subs: Sub[] = [];
  const status: SensorStatus = { steps: 'none', pedometer: false, compass: false, gyro: false, floors: false };

  // Merge two step sources by taking the larger running total, so nothing is lost or double counted
  let own = 0, hw = 0, emitted = 0;
  const emit = () => {
    const total = Math.max(own, hw);
    if (total > emitted) { h.onSteps(total - emitted); emitted = total; }
  };

  if (await safe(async () => (await Pedometer.isAvailableAsync()) && (await Pedometer.requestPermissionsAsync()).granted, false)) {
    subs.push(Pedometer.watchStepCount(({ steps }) => { hw = steps; emit(); }));
    status.pedometer = true;
  }

  // iOS reports acceleration with the opposite sign to Android; normalise to "flat on a table = +1 g up"
  const sign = Platform.OS === 'ios' ? -1 : 1;
  const gravity = new GravityFilter();
  const stepper = new StepDetector();
  let up = { x: 0, y: 0, z: 1 };
  let accel = { x: 0, y: 0, z: 1 };

  if (await safe(() => Accelerometer.isAvailableAsync(), false)) {
    Accelerometer.setUpdateInterval(20);
    subs.push(Accelerometer.addListener((a) => {
      accel = { x: a.x * sign, y: a.y * sign, z: a.z * sign };
      const now = Date.now();
      up = gravity.feed(accel, now);
      const n = stepper.feed(accel, now);
      if (n) { own += n; emit(); }
    }));
    status.steps = 'motion';
  }

  // Heading: gyro integration + compass correction
  const heading = new HeadingFilter();
  let sent = -999;
  const publish = (deg: number | null) => {
    if (deg !== null && Math.abs(deg - sent) > 1.5) { sent = deg; h.onHeading(deg); }
  };
  const haveMag = status.steps === 'motion' && (await safe(() => Magnetometer.isAvailableAsync(), false));
  if (haveMag) {
    Magnetometer.setUpdateInterval(100);
    subs.push(Magnetometer.addListener((m) => {
      publish(heading.compass(computeHeading(accel, m), Math.hypot(m.x, m.y, m.z)));
    }));
    status.compass = true;
  }
  if (status.steps === 'motion' && (await safe(() => Gyroscope.isAvailableAsync(), false))) {
    Gyroscope.setUpdateInterval(20);
    let last = 0;
    subs.push(Gyroscope.addListener((w) => {
      const now = Date.now();
      if (last) heading.gyro(w, up, Math.min(now - last, 100) / 1000);
      last = now;
      publish(heading.h);
    }));
    status.gyro = true;
  }

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
