// eslint.config.js
import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import tsParser from '@typescript-eslint/parser'; // eslint-disable-line import/no-unresolved
import tsPlugin from '@typescript-eslint/eslint-plugin'; // eslint-disable-line import/no-unresolved
import { eslintBase } from '@arcanumai/style';

// ✅ Keep ESLint out of third-party & generated files
const IGNORES = {
  ignores: [
    '**/node_modules/**',
    '**/*.d.ts',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    'e2e-tests/**',
    'infra/**',
    'public/**',
  ],
};

// Shared configuration
const sharedConfig = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: {
      ...globals.browser,
      ...globals.es2021,
      ...globals.node,
      // Test globals
      vi: 'readonly',
      describe: 'readonly',
      it: 'readonly',
      expect: 'readonly',
      beforeEach: 'readonly',
      afterEach: 'readonly',
    },
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
  plugins: {
    react: reactPlugin,
    'react-hooks': reactHooksPlugin,
    'react-refresh': reactRefreshPlugin,
    import: importPlugin,
  },
  settings: {
    react: { version: 'detect' },
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        moduleDirectory: ['node_modules', '../node_modules'],
      },
    },
  },
  rules: {
    ...reactPlugin.configs.recommended.rules,
    ...reactHooksPlugin.configs.recommended.rules,
    'react-hooks/exhaustive-deps': 'off',
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',
    'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
  },
};

export default [
  IGNORES, // ✅ must come first

  js.configs.recommended,

  // JavaScript/JSX files — only lint app code
  {
    files: ['src/**/*.{js,jsx}'],
    ...sharedConfig,
    rules: {
      ...sharedConfig.rules,
      ...importPlugin.configs.recommended.rules,
      'no-undef': 'error',
      'react/jsx-filename-extension': [1, { extensions: ['.js', '.jsx'] }],
      'import/no-unresolved': 'error',
      'import/named': 'error',
      'import/default': 'error',
      'import/namespace': 'error',
    },
  },

  // TypeScript/TSX files — only lint app code
  {
    files: ['src/**/*.{ts,tsx}'],
    ...sharedConfig,
    languageOptions: {
      ...sharedConfig.languageOptions,
      parser: tsParser,
    },
    plugins: {
      ...sharedConfig.plugins,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...sharedConfig.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      'no-undef': 'off', // TS does this
      'react/display-name': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  ...eslintBase,
];
