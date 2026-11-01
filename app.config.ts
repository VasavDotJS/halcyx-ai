import type { ExpoConfig } from 'expo/config';

const IOS_BUNDLE = process.env.HALCYX_IOS_BUNDLE_ID ?? 'app.halcyx.mobile';
const ANDROID_PACKAGE = process.env.HALCYX_ANDROID_PACKAGE ?? 'app.halcyx.mobile';

const config: ExpoConfig = {
  name: 'HALCYX',
  slug: 'halcyx',
  scheme: 'halcyx',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#0A0A0A',
  ios: {
    bundleIdentifier: IOS_BUNDLE,
    supportsTablet: true,
    usesAppleSignIn: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSFaceIDUsageDescription: 'HALCYX uses Face ID to unlock the app and reveal saved API keys.',
      NSMicrophoneUsageDescription: 'HALCYX uses the microphone for on-device dictation of prompts.',
      NSSpeechRecognitionUsageDescription: 'HALCYX transcribes your voice prompts on this device.',
      NSPhotoLibraryUsageDescription: 'Attach screenshots or UI sketches to an agent task.',
      UIBackgroundModes: ['fetch', 'remote-notification'],
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0A0A0A' },
    permissions: ['USE_BIOMETRIC', 'RECORD_AUDIO', 'POST_NOTIFICATIONS'],
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE'],
    allowBackup: false,
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
    name: 'HALCYX',
    shortName: 'HALCYX',
    themeColor: '#0A0A0A',
    backgroundColor: '#0A0A0A',
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 240, resizeMode: 'contain', backgroundColor: '#0A0A0A' }],
    'expo-secure-store',
    'expo-sqlite',
    'expo-apple-authentication',
    'expo-background-task',
    ['expo-local-authentication', { faceIDPermission: 'Unlock HALCYX and reveal saved API keys.' }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#0A0A0A' }],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Dictate prompts on this device.',
        speechRecognitionPermission: 'Transcribe voice prompts on this device.',
      },
    ],
    ['expo-image-picker', { photosPermission: 'Attach screenshots or sketches to an agent task.' }],
    ['@sentry/react-native/expo', { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }],
    'expo-font',
  ],
  experiments: { typedRoutes: true },
  updates: { url: process.env.EAS_UPDATE_URL, fallbackToCacheTimeout: 0 },
  runtimeVersion: { policy: 'fingerprint' },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    githubAppClientId: process.env.EXPO_PUBLIC_GITHUB_APP_CLIENT_ID,
    githubAppSlug: process.env.EXPO_PUBLIC_GITHUB_APP_SLUG,
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
