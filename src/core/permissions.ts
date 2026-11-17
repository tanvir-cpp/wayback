import { Barometer, Pedometer } from 'expo-sensors';

export type Perm = 'granted' | 'denied' | 'blocked';

/** Asks for the motion / fitness permission that step counting needs. `blocked` means the system won't ask again. */
export async function requestMotion(): Promise<Perm> {
  try {
    if (!(await Pedometer.isAvailableAsync())) return 'denied';
    const r = await Pedometer.requestPermissionsAsync();
    // The barometer shares the same motion permission on iOS; ask so floor detection can start
    await Barometer.requestPermissionsAsync().catch(() => undefined);
    return r.granted ? 'granted' : r.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'denied';
  }
}
