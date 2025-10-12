import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import fsExtra from 'fs-extra';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import config from './public/config.json' with { type: 'json' };
const { CLIENT_NAME } = config as { CLIENT_NAME: string };

// Custom plugin to copy build output to @numa-frontend
const copyBuildPlugin = () => ({
  name: 'copy-build',
  closeBundle: async () => {
    const sourceDir = 'dist';
    const targetDir = '../infra/build/numa-frontend';
    const excludeFiles = ['config.json', 'manifest.json'];

    fsExtra.removeSync(targetDir);
    mkdirSync(targetDir, { recursive: true });

    const copyDir = (src, dest) => {
      if (!existsSync(src)) return;
      const entries = readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = resolve(src, entry.name);
        const destPath = resolve(dest, entry.name);
        if (entry.isDirectory()) {
          mkdirSync(destPath, { recursive: true });
          copyDir(srcPath, destPath);
        } else if (!excludeFiles.includes(entry.name)) {
          copyFileSync(srcPath, destPath);
        }
      }
    };

    try {
      copyDir(sourceDir, targetDir);
      console.log('Successfully copied build files to /infra/build/numa-frontend');
    } catch (error) {
      console.error('Error copying build files:', error);
    }
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), copyBuildPlugin()],
  build: {
    sourcemap: false,
    // Enable content-based hashing for cache busting
    rollupOptions: {
      output: {
        // Hash filenames based on content
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',

        // Let Vite handle chunking automatically with route-based lazy loading
        manualChunks: undefined,
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: `https://${CLIENT_NAME}.numa.arcanum.ai/`,
        changeOrigin: true,
        secure: false,
        headers: { Origin: `https://${CLIENT_NAME}.numa.arcanum.ai/` },
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
      '/manifest.json': {
        target: `https://${CLIENT_NAME}.numa.arcanum.ai/`,
        changeOrigin: true,
        secure: false,
        headers: { Origin: `https://${CLIENT_NAME}.numa.arcanum.ai/` },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'node_modules/@popperjs/core': '@popperjs/core/dist/umd/popper.min.js',
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  assetsInclude: ['**/*.md'],
  define: { 'process.env': {} },
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
      'e2e-tests/**',
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
        'e2e-tests/**',
      ],
    },
  },
});
