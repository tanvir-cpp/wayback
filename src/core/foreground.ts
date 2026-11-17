import { PermissionsAndroid, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

/**
 * Android foreground service: keeps the app (and its sensor listeners) alive with the screen off or the app in
 * the background, and shows the required "Recording your route" notification. iOS has no equivalent for these sensors.
 */
export async function startForeground(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    if (Number(Platform.Version) >= 33) await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    await BackgroundService.start(() => new Promise<void>(() => {}), {
      taskName: 'wayback',
      taskTitle: 'Recording your route',
      taskDesc: 'Wayback is tracking your steps so it can guide you back.',
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      color: '#0A0A0B',
      foregroundServiceType: ['health'],
    });
    return true;
  } catch {
    return false; // e.g. motion permission refused: we still work while the app is open
  }
}

export async function stopForeground() {
  if (Platform.OS === 'android') await BackgroundService.stop().catch(() => {});
}
