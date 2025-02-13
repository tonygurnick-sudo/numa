import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { default as base } from '../../../eslint.config.base.mjs';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  ...base,
];
