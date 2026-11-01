const alias = { '^@/(.*)$': '<rootDir>/$1' };

module.exports = {
  projects: [
    {
      displayName: 'core',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/**/*.test.ts'],
      transform: { '^.+\\.[jt]sx?$': 'babel-jest' },
      transformIgnorePatterns: ['/node_modules/(?!(diff|@octokit|universal-user-agent|before-after-hook|content-type|json-with-bigint)/)'],
      moduleNameMapper: alias,
      setupFiles: ['<rootDir>/tests/setup/node.ts'],
    },
    {
      displayName: 'ui',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/tests/**/*.test.tsx'],
      moduleNameMapper: { ...alias, '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js' },
      setupFiles: ['<rootDir>/tests/setup/node.ts', '<rootDir>/tests/setup/ui.ts'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|lucide-react-native|diff|moti|zustand|@octokit|universal-user-agent|before-after-hook|content-type|json-with-bigint|@shopify/flash-list|@sentry/react-native|standard-navigation)',
      ],
    },
  ],
};
