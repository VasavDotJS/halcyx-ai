/* Jest stubs for native-only modules used by the UI components under test. */
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: {}, useReducedMotion: () => false }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
