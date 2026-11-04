const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions are Deno code: checked by `deno check` / `deno lint` (see .github/workflows/ci.yml).
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'backend/supabase/functions/*', 'coverage/*'],
  },
  {
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'import/no-unresolved': 'off',
    },
  },
  {
    // Layering: domain code in core/ stays free of UI, state and app wiring (testable on Node).
    // core/app/ is the composition root that wires settings, services and the runtime together.
    files: ['core/**/*.ts'],
    ignores: ['core/app/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/ui/*', '@/state/*', '@/hooks/*', '@/app/*', '@/core/app/*'],
              message: 'core/ must not depend on UI, state or app wiring.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    files: ['public/register-sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
]);
