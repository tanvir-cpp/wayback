// Pure dead-reckoning core: no React, no sensors. Everything here is unit-testable.
// Coordinates: metres, x = east, y = north, relative to where the user pressed Start.
// Heading: degrees, 0 = north, 90 = east. Floors: integers relative to the start floor (0).

export const STEP_M = 0.72; // average walking stride
export const FLOOR_HEIGHT_M = 4.5; // typical mall storey
const HPA_TO_M = 8.43; // ~metres of altitude per hPa near sea level
const TURN_TOLERANCE_DEG = 80;

export interface Pt { x: number; y: number; floor: number; transition?: boolean }
export type Mode = 'idle' | 'tracking' | 'returning' | 'arrived';

export interface State {
  mode: Mode;
  path: Pt[]; // one point per step; the last point is where the user is
  ghost: Pt[]; // snapshot of the full route when the return began (for the fading trail)
  floor: number;
  heading: number | null;
  steps: number; // every step ever counted
  returnTotalM: number;
  startedAt: number;
  endedAt: number;
}

export type Action =
  | { type: 'start'; at: number }
  | { type: 'step'; count?: number }
  | { type: 'heading'; deg: number }
  | { type: 'floor'; delta: number }
  | { type: 'return' }
  | { type: 'resume' }
  | { type: 'finish'; at: number }
  | { type: 'restore'; saved: Saved }
  | { type: 'reset' };

/** What is written to disk so a visit survives the app being closed or killed. */
export type Saved = Pick<State, 'mode' | 'path' | 'ghost' | 'floor' | 'steps' | 'returnTotalM' | 'startedAt'> & { savedAt: number };

export const initialState: State = {
  mode: 'idle', path: [], ghost: [], floor: 0, heading: null, steps: 0, returnTotalM: 0, startedAt: 0, endedAt: 0,
};

const rad = (d: number) => (d * Math.PI) / 180;
export const norm = (d: number) => ((d % 360) + 360) % 360;
/** Signed shortest rotation from a to b, in (-180, 180]. Positive = turn right (clockwise). */
export const angleDiff = (a: number, b: number) => {
  const d = norm(b - a);
  return d > 180 ? d - 360 : d;
};
export const bearing = (a: Pt, b: Pt) => norm((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI);
export const advance = (p: Pt, headingDeg: number, len = STEP_M): Pt => ({
  x: p.x + Math.sin(rad(headingDeg)) * len,
  y: p.y + Math.cos(rad(headingDeg)) * len,
  floor: p.floor,
});

export function pathLength(path: Pt[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i].floor === path[i - 1].floor) m += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return m;
}

export type Guidance =
  | { kind: 'none' }
  | { kind: 'arrived' }
  | { kind: 'floor'; target: number; up: boolean }
  | { kind: 'turn' | 'walk'; diff: number | null };

/** What should the user do next to retrace the route? */
export function guidance(s: State): Guidance {
  if (s.mode !== 'returning') return { kind: 'none' };
  const n = s.path.length;
  if (n <= 1) return { kind: 'arrived' };
  const last = s.path[n - 1];
  const prev = s.path[n - 2];
  if (last.floor !== prev.floor) return { kind: 'floor', target: prev.floor, up: prev.floor > s.floor };
  if (s.heading === null) return { kind: 'walk', diff: null };
  const diff = angleDiff(s.heading, bearing(last, prev));
  return { kind: Math.abs(diff) > TURN_TOLERANCE_DEG ? 'turn' : 'walk', diff };
}

/** Pop floor-transition nodes once the user is physically on the right floor. */
function settle(s: State): State {
  const path = s.path.slice();
  while (path.length > 1 && path[path.length - 1].floor !== path[path.length - 2].floor && s.floor === path[path.length - 2].floor) {
    path.pop();
  }
  return path.length === s.path.length ? s : { ...s, path };
}

function arriveIfDone(s: State): State {
  return s.mode === 'returning' && s.path.length <= 1 ? { ...s, mode: 'arrived' } : s;
}

function stepOnce(s: State): State {
  const steps = s.steps + 1;
  if (s.mode === 'tracking') {
    const last = s.path[s.path.length - 1];
    return { ...s, steps, path: [...s.path, advance(last, s.heading ?? 0)] };
  }
  if (s.mode === 'returning') {
    // Only retrace when the phone points along the way back; otherwise the step is counted but the route stays.
    if (guidance(s).kind !== 'walk') return { ...s, steps };
    return arriveIfDone(settle({ ...s, steps, path: s.path.slice(0, -1) }));
  }
  return s;
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'start':
      return { ...initialState, mode: 'tracking', path: [{ x: 0, y: 0, floor: 0 }], heading: s.heading, startedAt: a.at };
    case 'heading':
      return { ...s, heading: a.deg };
    case 'step': {
      let next = s;
      for (let i = 0; i < (a.count ?? 1); i++) next = stepOnce(next);
      return next;
    }
    case 'floor': {
      if (s.mode !== 'tracking' && s.mode !== 'returning') return s;
      const floor = s.floor + a.delta;
      if (s.mode === 'tracking') {
        const last = s.path[s.path.length - 1];
        return { ...s, floor, path: [...s.path, { x: last.x, y: last.y, floor, transition: true }] };
      }
      return arriveIfDone(settle({ ...s, floor }));
    }
    case 'return':
      return s.mode === 'tracking'
        ? { ...s, mode: 'returning', ghost: s.path, returnTotalM: pathLength(s.path) }
        : s;
    case 'resume':
      return s.mode === 'returning' ? { ...s, mode: 'tracking', ghost: [] } : s;
    case 'finish':
      return { ...s, endedAt: a.at };
    case 'restore':
      return { ...initialState, ...a.saved, heading: s.heading };
    case 'reset':
      return { ...initialState, heading: s.heading };
  }
}

// ---------- Heading: tilt-compensated compass ----------
type V3 = { x: number; y: number; z: number };
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * Compass heading of the direction the user is facing.
 * acc: accelerometer incl. gravity (Android convention: flat on a table => z = +1).
 * mag: magnetometer. Phone flat => top edge is "forward"; phone upright => camera side is "forward".
 */
export function computeHeading(acc: V3, mag: V3): number {
  const g = unit(acc);
  const east = unit(cross(mag, g));
  const north = cross(g, east);
  const fwd: V3 = Math.abs(g.z) > 0.75 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: -1 };
  return norm((Math.atan2(dot(east, fwd), dot(north, fwd)) * 180) / Math.PI);
}

/** Circular low-pass filter for headings. */
export const smoothHeading = (prev: number | null, next: number, k = 0.25) =>
  prev === null ? next : norm(prev + angleDiff(prev, next) * k);

// ---------- Floor detection from barometric pressure ----------
export class FloorDetector {
  private ema: number | null = null;
  private base: number | null = null;
  private n = 0;
  private candidate = 0;
  private since = 0;

  /** Feed one pressure sample (hPa). Returns a non-zero floor delta when a floor change is confirmed. */
  feed(hpa: number, now: number): number {
    this.ema = this.ema === null ? hpa : this.ema + 0.2 * (hpa - this.ema);
    if (++this.n < 5) return 0; // let the filter settle before calibrating
    if (this.base === null) this.base = this.ema;
    const alt = (this.base - this.ema) * HPA_TO_M; // positive = went up
    const delta = Math.abs(alt) >= FLOOR_HEIGHT_M * 0.6 ? Math.round(alt / FLOOR_HEIGHT_M) : 0;
    if (delta === 0) {
      this.candidate = 0;
      if (Math.abs(alt) < 0.5) this.base += (this.ema - this.base) * 0.002; // slow weather drift
      return 0;
    }
    if (delta !== this.candidate) {
      this.candidate = delta;
      this.since = now;
      return 0;
    }
    if (now - this.since < 2500) return 0; // must hold steady: ignores lifts of the phone / doors
    this.base -= (delta * FLOOR_HEIGHT_M) / HPA_TO_M; // keep any leftover so consecutive floors stay accurate
    this.candidate = 0;
    return delta;
  }
}

// ---------- Heading: gyroscope-led, compass-corrected ----------
/**
 * Tracks which way the user faces. The gyroscope gives smooth turns that ignore magnetic interference
 * (indoors the raw compass is noisy); the compass only gently pulls the estimate back so it can't drift away.
 * `up` is the unit vector pointing up, in device coordinates, so yaw works whatever way the phone is held.
 */
export class HeadingFilter {
  h: number | null = null;

  gyro(w: V3, up: V3, dtSec: number) {
    if (this.h === null) return;
    const yawRate = w.x * up.x + w.y * up.y + w.z * up.z; // rad/s, counter-clockwise positive
    this.h = norm(this.h - (yawRate * dtSec * 180) / Math.PI);
  }

  /** compassDeg from computeHeading; fieldUT is |magnetometer| in microtesla, used to ignore disturbed readings. */
  compass(compassDeg: number, fieldUT: number): number | null {
    if (this.h === null) this.h = compassDeg;
    else if (fieldUT >= 20 && fieldUT <= 70) this.h = norm(this.h + angleDiff(this.h, compassDeg) * 0.012);
    return this.h;
  }
}

/** Slowly tracks gravity (the "up" direction) so arm swing and steps don't tilt the heading. */
export class GravityFilter {
  private g: V3 = { x: 0, y: 0, z: 1 };
  private t = 0;

  feed(a: V3, tMs: number): V3 {
    const dt = this.t ? Math.min(tMs - this.t, 100) : 100;
    this.t = tMs;
    const k = 1 - Math.exp(-dt / 600);
    this.g = { x: this.g.x + k * (a.x - this.g.x), y: this.g.y + k * (a.y - this.g.y), z: this.g.z + k * (a.z - this.g.z) };
    return unit(this.g);
  }
}

// ---------- Steps: works with the phone in a hand, pocket or bag ----------
/**
 * Orientation-independent step detector: removes gravity from the acceleration magnitude, smooths it,
 * and picks peaks against an adaptive threshold so gentle hand-held walking counts as well as pocket bounce.
 * Needs two rhythmic peaks before counting, which rejects one-off hand movements.
 */
export class StepDetector {
  private mean = 1;
  private s = 0;
  private p1 = 0;
  private p2 = 0;
  private env = 0.15;
  private t = 0;
  private lastPeak = 0;
  private streak = 0;

  /** Returns how many steps to count for this sample (usually 0 or 1; 2 when walking is first recognised). */
  feed(a: V3, tMs: number): number {
    const dt = this.t ? Math.min(Math.max(tMs - this.t, 5), 100) : 20;
    this.t = tMs;
    const m = Math.hypot(a.x, a.y, a.z);
    this.mean += (1 - Math.exp(-dt / 1000)) * (m - this.mean);
    this.s += (1 - Math.exp(-dt / 40)) * (m - this.mean - this.s);
    let steps = 0;
    const isPeak = this.p1 > this.p2 && this.p1 >= this.s;
    if (isPeak && this.p1 > Math.max(0.05, this.env * 0.5) && tMs - this.lastPeak > 280) {
      this.env += 0.25 * (this.p1 - this.env);
      if (tMs - this.lastPeak < 1100) {
        this.streak++;
        steps = this.streak === 2 ? 2 : this.streak > 2 ? 1 : 0;
      } else {
        this.streak = 1;
      }
      this.lastPeak = tMs;
    }
    this.p2 = this.p1;
    this.p1 = this.s;
    this.env = Math.max(0.1, this.env * Math.pow(0.9997, dt / 20)); // threshold relaxes when the phone is held steadier
    return steps;
  }
}
