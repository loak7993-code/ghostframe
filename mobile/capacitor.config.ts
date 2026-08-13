import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ghostframe.app',
  appName: 'GhostFrame',
  webDir: 'www',
  backgroundColor: '#0f1117',
  android: {
    allowMixedContent: true, // local-LAN HTTP API over http://192.168.x.x
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'http', // assets served over http scheme so http API is same-origin
    cleartext: true,
  },
};

export default config;
