import AsyncStorage from '@react-native-async-storage/async-storage';
import { Saved, State } from './path';

const KEY = 'wayback.visit.v1';

export const saveVisit = (s: State) => {
  const saved: Saved = { mode: s.mode, path: s.path, ghost: s.ghost, floor: s.floor, steps: s.steps, returnTotalM: s.returnTotalM, startedAt: s.startedAt, savedAt: Date.now() };
  return AsyncStorage.setItem(KEY, JSON.stringify(saved)).catch(() => {});
};

export const clearVisit = () => AsyncStorage.removeItem(KEY).catch(() => {});

export async function loadVisit(): Promise<Saved | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    return (v.mode === 'tracking' || v.mode === 'returning') && Array.isArray(v.path) && v.path.length > 0 ? v : null;
  } catch {
    return null;
  }
}
