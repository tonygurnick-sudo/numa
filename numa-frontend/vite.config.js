import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import config from './public/config.json';

// Custom plugin to copy build output to @numa-frontend
const copyBuildPlugin = () => ({
  name: 'copy-build',
  closeBundle: async () => {
    const sourceDir = 'dist';
    const targetDir = '../infra/build/numa-frontend';
    const excludeFiles = ['config.json', 'manifest.json'];

    // Create target directory if it doesn't exist
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Function to copy directory recursively
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
      // Copy the build output
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
  },
  server: {
    proxy: {
      '/api': {
        target: `https://${config.CLIENT_NAME}.numa.arcanum.ai/`,
        changeOrigin: true,
        secure: false,
        headers: {
          Origin: `https://${config.CLIENT_NAME}.numa.arcanum.ai/`,
        },
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
      '/manifest.json': {
        target: `https://${config.CLIENT_NAME}.numa.arcanum.ai/`,
        changeOrigin: true,
        secure: false,
        headers: {
          Origin: `https://${config.CLIENT_NAME}.numa.arcanum.ai/`,
        },
      },
    },
  },
  resolve: {
    alias: {
      'node_modules/@popperjs/core': '@popperjs/core/dist/umd/popper.min.js',
    },
    extensions: ['.js', '.jsx'],
  },
  assetsInclude: ['**/*.md'],
  // HTML to DOCX needs a browser environment, so we need to define process.env
  // This is a workaround for MdToDocx.jsx
  define: {
    'process.env': {},
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
