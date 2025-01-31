import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import config from './public/config.json';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/manifest.json': {
        target: 'http://localhost:5173',
        rewrite: () => '/src/Data/example-manifest.json'
      },
      '/api': {
        target: `https://${config.CLIENT_NAME}.numa.arcanum.ai`,
        changeOrigin: true,
        secure: false,
        headers: {
          'Origin': `https://${config.CLIENT_NAME}.numa.arcanum.ai`
        },
      },
    }
  },
  resolve: {
    alias: {
      'node_modules/@popperjs/core': '@popperjs/core/dist/umd/popper.min.js',
    },
    extensions: ['.js', '.jsx'],
  },
  assetsInclude: ['**/*.md'],
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
        '**/__tests__/**',
        '**/*.config.{js,ts}',
        '**/eslint.config.js',
        '**/vite.config.js',
        '**/index.{js,jsx}',
        '**/*TestProvider.{jsx,js}',
      ],
    },
  },
});
