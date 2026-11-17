import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import RouteMap, { COLORS as C } from './src/core/RouteMap';
import { useSession } from './src/core/useSession';
import { Perm, requestMotion } from './src/core/permissions';

const floorName = (f: number) => (f === 0 ? 'Start floor' : f > 0 ? `${f} up` : `${-f} down`);
const floorTag = (f: number) => (f === 0 ? '0' : f > 0 ? `+${f}` : `${f}`);
const ago = (t: number) => {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Btn({ label, onPress, accent, ghost }: { label: string; onPress: () => void; accent?: boolean; ghost?: boolean }) {
  return (
    <TouchableOpacity
      style={[s.btn, ghost ? s.btnGhost : { backgroundColor: accent ? C.accent : C.ink }]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      <Text style={[s.btnText, ghost && { color: C.mute }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Screen() {
  const insets = useSafeAreaInsets();
  const { state, dispatch, sensors, background, saved, start, reset, resume, discard, guide, stats } = useSession();
  const { mode, path, ghost, floor, heading } = state;
  const returning = mode === 'returning';
  const live = mode === 'tracking' || returning;

  // The map follows the user's floor; tapping a floor browses it until the user changes floor again
  const [pick, setPick] = useState({ at: 0, f: 0 });
  const viewFloor = pick.at === floor ? pick.f : floor;
  const floors = Array.from(new Set([...(ghost.length ? ghost : path).map((p) => p.floor), floor])).sort((a, b) => b - a);

  // Ask for motion permission before recording; if refused, explain and let the user choose
  const [perm, setPerm] = useState<Perm | null>(null);
  const begin = async () => {
    const p = await requestMotion();
    if (p === 'granted') { setPerm(null); start(); } else setPerm(p);
  };
  const beginAnyway = () => { setPerm(null); start(); };

  const startOver = () =>
    Alert.alert('Start over?', 'This erases your recorded route. Your new start point will be wherever you are now.', [
      { text: 'Keep route', style: 'cancel' },
      { text: 'Start over', style: 'destructive', onPress: () => { reset(); begin(); } },
    ]);

  const [headH, setHeadH] = useState(0);
  const [bottomH, setBottomH] = useState(0);
  const gutter = Math.max(20, insets.left + 12, insets.right + 12);

  const manual = live && sensors !== null && (sensors.steps === 'none' || !sensors.floors);

  let title = '';
  let detail = '';
  if (mode === 'idle' && saved) {
    title = 'Resume your visit?';
    detail = `${saved.steps} steps recorded ${ago(saved.savedAt)}. Pick up where you left off and we’ll still guide you back to your start.`;
  } else if (mode === 'idle') {
    title = 'Wayback';
    detail = perm
      ? 'Motion access is off, so steps are estimated from movement and may be less accurate.'
      : 'Start where you enter. We’ll guide you back to that exact spot. Uses motion sensors only; nothing leaves your phone.';
  } else if (mode === 'tracking') {
    title = String(state.steps);
    detail = `steps  ·  ${stats.distanceM} m  ·  ${clock(stats.seconds)}`;
  } else if (returning) {
    if (guide.kind === 'floor') {
      title = `Go ${guide.up ? 'up' : 'down'} a floor`;
      detail = `Take the stairs or escalator to ${floorName(guide.target).toLowerCase()}.`;
    } else if (guide.kind === 'turn' && guide.diff !== null) {
      title = `Turn ${guide.diff > 0 ? 'right' : 'left'}`;
      detail = `${Math.round(Math.abs(guide.diff))}° to face the way back.`;
    } else {
      title = 'Keep walking';
      detail = `${stats.remainingM} m to the start  ·  ${stats.percentBack}%`;
    }
  } else {
    title = 'You’re back';
    detail = `${state.steps} steps  ·  ${stats.distanceM} m  ·  ${clock(stats.seconds)}`;
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {live || mode === 'arrived' ? (
        <View style={StyleSheet.absoluteFill}>
          <RouteMap path={path} ghost={ghost} floor={viewFloor} heading={heading} returning={returning} pad={{ top: headH + 8, bottom: bottomH + 8, left: insets.left + 12, right: floors.length > 1 ? insets.right + 56 : insets.right + 12 }} />
        </View>
      ) : null}

      <View style={[s.head, { paddingTop: insets.top + 24, paddingHorizontal: gutter + 8, paddingRight: gutter + 56 }]} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)} pointerEvents="none">
        <Text style={mode === 'tracking' || mode === 'idle' ? s.big : s.mid}>{title}</Text>
        <Text style={s.detail}>{detail}</Text>
      </View>

      {live && floors.length > 1 && (
        <View style={[s.floors, { top: insets.top + 24, right: insets.right + 8 }]}>
          {floors.map((f) => (
            <TouchableOpacity key={f} onPress={() => setPick({ at: floor, f })} style={s.floorHit} accessibilityLabel={`Show ${floorName(f)}`}>
              <Text style={[s.floorText, viewFloor === f && s.floorOn]}>{floorTag(f)}</Text>
              {f === floor && <View style={s.floorDot} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 8, paddingHorizontal: gutter }]} onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}>
        {returning && (
          <View style={s.track}>
            <View style={[s.trackFill, { width: `${stats.percentBack}%` }]} />
          </View>
        )}
        {live && sensors && !background && <Text style={s.note}>Keep Wayback open: background tracking is unavailable.</Text>}
        {mode === 'tracking' && sensors && sensors.steps === 'none' && <Text style={s.note}>No step sensor found. Use manual steps below.</Text>}
        {manual && (
          <View style={s.manual}>
            {sensors?.steps === 'none' && <Text style={s.manualBtn} onPress={() => dispatch({ type: 'step' })}>Step</Text>}
            {sensors?.steps === 'none' && <Text style={s.manualBtn} onPress={() => dispatch({ type: 'heading', deg: ((heading ?? 0) + 315) % 360 })}>Left</Text>}
            {sensors?.steps === 'none' && <Text style={s.manualBtn} onPress={() => dispatch({ type: 'heading', deg: ((heading ?? 0) + 45) % 360 })}>Right</Text>}
            {!sensors?.floors && <Text style={s.manualBtn} onPress={() => dispatch({ type: 'floor', delta: 1 })}>Floor +</Text>}
            {!sensors?.floors && <Text style={s.manualBtn} onPress={() => dispatch({ type: 'floor', delta: -1 })}>Floor −</Text>}
          </View>
        )}

        {mode === 'idle' && saved && <Btn label="Resume visit" onPress={resume} />}
        {mode === 'idle' && saved && <Btn ghost label="Discard it" onPress={discard} />}
        {mode === 'idle' && !saved && !perm && <Btn label="Start" onPress={begin} />}
        {mode === 'idle' && !saved && perm === 'blocked' && <Btn label="Open settings" onPress={() => Linking.openSettings()} />}
        {mode === 'idle' && !saved && perm === 'denied' && <Btn label="Allow motion access" onPress={begin} />}
        {mode === 'idle' && !saved && perm && <Btn ghost label="Start anyway" onPress={beginAnyway} />}
        {mode === 'tracking' && <Btn accent label="Take me back" onPress={() => dispatch({ type: 'return' })} />}
        {returning && <Btn ghost label="Keep exploring" onPress={() => dispatch({ type: 'resume' })} />}
        {live && <Text style={s.startOver} onPress={startOver} accessibilityRole="button">Start over</Text>}
        {mode === 'arrived' && <Btn label="Done" onPress={reset} />}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Screen />
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  head: { paddingHorizontal: 28 },
  big: { color: C.ink, fontSize: 76, fontWeight: '200', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  mid: { color: C.ink, fontSize: 34, fontWeight: '300', letterSpacing: -0.5 },
  detail: { color: C.mute, fontSize: 15, marginTop: 4, lineHeight: 21, maxWidth: 300 },
  floors: { position: 'absolute', right: 8, alignItems: 'center' },
  floorHit: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  floorText: { color: C.mute, fontSize: 15, fontVariant: ['tabular-nums'] },
  floorOn: { color: C.ink, fontWeight: '700' },
  floorDot: { position: 'absolute', right: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, gap: 12 },
  track: { height: 2, backgroundColor: C.rule, marginBottom: 4 },
  trackFill: { height: 2, backgroundColor: C.accent },
  btn: { height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent' },
  btnText: { color: C.paper, fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  startOver: { color: C.mute, fontSize: 15, textAlign: 'center', paddingVertical: 8 },
  note: { color: C.mute, fontSize: 13, textAlign: 'center' },
  manual: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  manualBtn: { color: C.ink, fontSize: 15, paddingVertical: 10 },
});
