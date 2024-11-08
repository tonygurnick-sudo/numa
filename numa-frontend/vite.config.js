import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'node_modules/@popperjs/core': '@popperjs/core/dist/umd/popper.min.js',
    },
    extensions: ['.js', '.jsx'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/Fixtures/**',
      '**/*.config.{js,ts}',
      '**/eslint.config.js',
      '**/vite.config.js',
      '**/*TestProvider.{jsx,js}',
    ],
    coverage: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/Fixtures/**',
        '**/Tests/**',
        '**/*.config.{js,ts}',
        '**/eslint.config.js',
        '**/vite.config.js',
        '**/index.{js,jsx}',
        '**/*TestProvider.{jsx,js}',
      ],
    },
  },
});
