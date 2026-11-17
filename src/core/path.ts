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
  | { type: 'reset' };

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
