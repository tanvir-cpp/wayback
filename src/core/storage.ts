import { Saved, State } from './path';

const KEY = 'wayback.visit.v1';

// Loaded lazily: if the native storage module is missing on a device, the app must still open (just without saving).
type Store = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
let store: Store | null | undefined;
const getStore = (): Store | null => {
  if (store === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      store = require('@react-native-async-storage/async-storage').default as Store;
    } catch {
      store = null;
    }
  }
  return store;
};

export const saveVisit = async (s: State) => {
  const saved: Saved = { mode: s.mode, path: s.path, ghost: s.ghost, floor: s.floor, steps: s.steps, returnTotalM: s.returnTotalM, startedAt: s.startedAt, savedAt: Date.now() };
  try { await getStore()?.setItem(KEY, JSON.stringify(saved)); } catch { /* saving is best effort */ }
};

export const clearVisit = async () => {
  try { await getStore()?.removeItem(KEY); } catch { /* best effort */ }
};

export async function loadVisit(): Promise<Saved | null> {
  try {
    const raw = await getStore()?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    return (v.mode === 'tracking' || v.mode === 'returning') && Array.isArray(v.path) && v.path.length > 0 ? v : null;
  } catch {
    return null;
  }
}
