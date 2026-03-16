// eslint.config.js
import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import i18nextPlugin from 'eslint-plugin-i18next';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
// Remove eslintBase to avoid prettier conflicts - root prettier is source of truth

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
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // TypeScript/TSX files — only lint app code (excluding tests)
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/__tests__/**', 'src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    ...sharedConfig,
    languageOptions: {
      ...sharedConfig.languageOptions,
      parser: tsParser,
    },
    plugins: {
      ...sharedConfig.plugins,
      '@typescript-eslint': tsPlugin,
      i18next: i18nextPlugin,
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
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // i18n: detect hardcoded strings that should use t()
      'i18next/no-literal-string': [
        'error',
        {
          // JSX attributes that typically don't need translation
          ignoreAttribute: [
            'className',
            'class',
            'testId',
            'data-testid',
            'key',
            'id',
            'name',
            'type',
            'variant',
            'size',
            'as',
            'href',
            'src',
            'alt',
            'role',
            'position',
            'placement',
            'eventKey',
            'animation',
            'htmlFor',
            'target',
            'rel',
            'autoComplete',
            'inputMode',
            'pattern',
            'xmlns',
            'viewBox',
            'd',
            'fill',
            'stroke',
            'strokeWidth',
            'strokeLinecap',
            'strokeLinejoin',
          ],
          // Object properties that typically don't need translation
          ignoreProperty: [
            'className',
            'testId',
            'key',
            'id',
            'auth_type',
            'name',
            'type',
            'variant',
            'size',
            'color',
            'icon',
            'fallback_icon',
            'fallback_color',
            'path',
            'method',
            'status',
            'contentType',
          ],
          // Function calls where string arguments don't need translation
          ignoreCallee: [
            'console.log',
            'console.error',
            'console.warn',
            'console.info',
            'console.debug',
            't',
            'i18n.t',
            'connectionText',
            'require',
            'import',
          ],
          // Regex patterns to ignore (e.g., strings without letters, technical patterns)
          ignore: [
            '^[^a-zA-Z]*$', // No letters (numbers, symbols only)
            '^[A-Z][A-Z0-9_]*$', // CONSTANT_CASE
            '^[a-z]+[A-Z]', // camelCase identifiers
            '^bi bi-', // Bootstrap icon classes
            '^#(?:[0-9a-fA-F]{3}){1,2}$', // Hex colors
            '^(primary|secondary|success|danger|warning|info|light|dark)$', // Bootstrap variants
            '^(https?://|mailto:|tel:)', // URLs
            '\\.(png|jpg|jpeg|gif|svg|ico|webp|css|scss|js|ts|tsx|json)$', // File extensions
          ],
        },
      ],
    },
  },

  // Test files — TypeScript rules without i18n checking
  {
    files: ['src/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
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
      'no-undef': 'off',
      'react/display-name': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  // Standard ignores (from @arcanumai/style but without prettier conflicts)
  {
    ignores: ['build/**', 'dist/**', '**/*.d.ts', '**/.venv/**', '.vite', 'cdktf.out', '.gen'],
  },
];
