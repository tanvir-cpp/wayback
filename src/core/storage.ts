import { File, Paths } from 'expo-file-system';
import { Saved, State } from './path';

// One small JSON file in the app's private documents folder. Every call is best effort and can never crash the app.
const file = () => new File(Paths.document, 'wayback-visit.json');

export const saveVisit = async (s: State) => {
  const saved: Saved = { mode: s.mode, path: s.path, ghost: s.ghost, floor: s.floor, steps: s.steps, returnTotalM: s.returnTotalM, startedAt: s.startedAt, savedAt: Date.now() };
  try {
    const f = file();
    if (!f.exists) f.create();
    await f.write(JSON.stringify(saved));
  } catch { /* saving is best effort */ }
};

export const clearVisit = async () => {
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch { /* best effort */ }
};

export async function loadVisit(): Promise<Saved | null> {
  try {
    const f = file();
    if (!f.exists) return null;
    const v = JSON.parse(await f.text()) as Saved;
    return (v.mode === 'tracking' || v.mode === 'returning') && Array.isArray(v.path) && v.path.length > 0 ? v : null;
  } catch {
    return null;
  }
}
