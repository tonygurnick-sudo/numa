import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export const eslintBase = [
  {
    ignores: ['build/**', 'dist/**', '**/*.d.ts', '**/.venv/**', '.vite'],
  },
  eslintPluginPrettierRecommended,
];
