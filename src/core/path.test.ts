import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorDetector, GravityFilter, HeadingFilter, StepDetector, computeHeading, guidance, initialState, pathLength, reducer } from './path.ts';

// Deterministic pseudo-noise
let seed = 7;
const noise = (amp: number) => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2 * amp; };

/** Simulate `seconds` of walking at `hz` steps/s: vertical bounce `amp` g on top of gravity, sampled at 50 Hz. */
function countSteps(seconds: number, hz: number, amp: number, jitter: number, tilt: 'flat' | 'upright') {
  const d = new StepDetector();
  let n = 0;
  for (let t = 0; t < seconds * 1000; t += 20) {
    const bounce = amp * Math.sin(2 * Math.PI * hz * (t / 1000)) + noise(jitter);
    const a = tilt === 'flat' ? { x: noise(jitter), y: noise(jitter), z: 1 + bounce } : { x: noise(jitter), y: 1 + bounce, z: noise(jitter) };
    n += d.feed(a, t);
  }
  return n;
}

test('counts steps with the phone held in the hand (gentle motion)', () => {
  const n = countSteps(30, 1.8, 0.12, 0.02, 'flat'); // expected ~54
  assert.ok(n >= 48 && n <= 60, `got ${n}`);
});

test('counts steps with the phone upright in the hand and in a pocket (strong motion)', () => {
  const hand = countSteps(30, 1.8, 0.12, 0.02, 'upright');
  const pocket = countSteps(30, 1.8, 0.45, 0.05, 'flat');
  assert.ok(hand >= 48 && hand <= 60, `hand ${hand}`);
  assert.ok(pocket >= 48 && pocket <= 62, `pocket ${pocket}`);
});

test('does not count steps while standing still or fidgeting', () => {
  assert.equal(countSteps(30, 1.8, 0, 0.02, 'flat'), 0);
});

test('gyro heading follows turns with the phone at any tilt, and the compass pulls drift back', () => {
  // Phone tilted 45 degrees (screen facing the user): up in device coords = (0, sin45, cos45)
  const up = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };
  const f = new HeadingFilter();
  f.compass(90, 45); // start facing east
  // Turn right (clockwise from above) by 90 degrees over 1 s: angular velocity along -up
  for (let i = 0; i < 50; i++) f.gyro({ x: -up.x * (Math.PI / 2), y: -up.y * (Math.PI / 2), z: -up.z * (Math.PI / 2) }, up, 0.02);
  assert.ok(Math.abs(f.h! - 180) < 1, `expected ~180 (south), got ${f.h}`);
  // A disturbed compass (field strength out of range) is ignored
  f.compass(10, 120);
  assert.ok(Math.abs(f.h! - 180) < 1);
  // A good compass reading nudges, not jumps
  f.compass(190, 45);
  assert.ok(f.h! > 180 && f.h! < 182);
});

test('gravity filter ignores step oscillations', () => {
  const g = new GravityFilter();
  let u = { x: 0, y: 0, z: 1 };
  for (let t = 0; t < 5000; t += 20) u = g.feed({ x: 0, y: 0.3 * Math.sin(t / 100), z: 1 + 0.3 * Math.sin(t / 80) }, t);
  assert.ok(u.z > 0.95, `up.z ${u.z}`);
});

test('compass heading matches for phone flat and rotated', () => {
  for (const h of [0, 45, 90, 180, 270]) {
    const r = (h * Math.PI) / 180;
    const got = computeHeading({ x: 0, y: 0, z: 1 }, { x: -30 * Math.sin(r), y: 30 * Math.cos(r), z: -40 });
    assert.ok(Math.abs(got - h) < 1e-6, `${h} -> ${got}`);
  }
});

test('barometer detects two floors and ignores noise', () => {
  const d = new FloorDetector();
  let t = 0, got = 0;
  for (let i = 0; i < 10; i++) d.feed(1013, (t += 1000));
  for (let i = 0; i < 30; i++) got += d.feed(1013 - 0.534 * Math.min(1, i / 8), (t += 1000));
  for (let i = 0; i < 20; i++) got += d.feed(1013 - 0.534 - 0.534 * Math.min(1, i / 8), (t += 1000));
  assert.equal(got, 2);
  const q = new FloorDetector();
  let n = 0;
  for (let i = 0; i < 300; i++) n += q.feed(1013 + 0.05 * Math.sin(i), i * 1000);
  assert.equal(n, 0);
});

test('a recorded route is retraced exactly back to the start, across a floor change', () => {
  let s = reducer(initialState, { type: 'start', at: 1 });
  const walk = (h: number, n: number) => { s = reducer(s, { type: 'heading', deg: h }); s = reducer(s, { type: 'step', count: n }); };
  walk(90, 20); walk(0, 10);
  s = reducer(s, { type: 'floor', delta: 1 });
  walk(0, 10); walk(270, 5);
  s = reducer(s, { type: 'return' });
  s = reducer(s, { type: 'heading', deg: 0 });
  const before = s.path.length;
  s = reducer(s, { type: 'step' });
  assert.equal(s.path.length, before, 'wrong-way step must not erase the route');
  assert.equal(guidance(s).kind, 'turn');
  walk(90, 5); walk(180, 10);
  assert.deepEqual(guidance(s), { kind: 'floor', target: 0, up: false });
  s = reducer(s, { type: 'step', count: 3 });
  assert.equal(guidance(s).kind, 'floor');
  s = reducer(s, { type: 'floor', delta: -1 });
  walk(180, 10); walk(270, 20);
  assert.equal(s.mode, 'arrived');
  assert.ok(Math.hypot(s.path[0].x, s.path[0].y) < 1e-9);
  assert.equal(pathLength(s.path), 0);
});

test('a saved visit restores and can still be retraced', () => {
  let s = reducer(initialState, { type: 'start', at: 1 });
  s = reducer(s, { type: 'heading', deg: 0 });
  s = reducer(s, { type: 'step', count: 12 });
  const saved = JSON.parse(JSON.stringify({ mode: s.mode, path: s.path, ghost: s.ghost, floor: s.floor, steps: s.steps, returnTotalM: s.returnTotalM, startedAt: s.startedAt, savedAt: 5 }));
  let r = reducer(initialState, { type: 'restore', saved });
  assert.equal(r.steps, 12);
  r = reducer(r, { type: 'return' });
  r = reducer(r, { type: 'heading', deg: 180 });
  r = reducer(r, { type: 'step', count: 12 });
  assert.equal(r.mode, 'arrived');
});
