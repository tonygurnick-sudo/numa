import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  server: {
    https: true,
  },
  plugins: [react(), mkcert()],
  resolve: {
    alias: {
      'node_modules/@popperjs/core': '@popperjs/core/dist/umd/popper.min.js',
    },
    extensions: ['.js', '.jsx'],
  },
  optimizeDeps: {
    exclude: ['fs', 'path', 'os'],
  },
});
