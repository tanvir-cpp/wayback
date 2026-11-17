// Declares the foreground-service type for react-native-background-actions (required on Android 14+).
const { withAndroidManifest } = require('expo/config-plugins');

const NAME = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';

module.exports = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app.service = app.service || [];
    let svc = app.service.find((s) => s.$['android:name'] === NAME);
    if (!svc) {
      svc = { $: { 'android:name': NAME } };
      app.service.push(svc);
    }
    svc.$['android:foregroundServiceType'] = 'health';
    svc.$['tools:node'] = 'merge';
    return cfg;
  });
