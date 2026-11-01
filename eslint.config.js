const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'backend/supabase/functions/*', 'public/*', 'coverage/*'],
  },
  {
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'import/no-unresolved': 'off',
    },
  },
]);
