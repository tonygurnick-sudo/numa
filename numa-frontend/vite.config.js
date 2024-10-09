import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@popperjs/core": "@popperjs/core/dist/umd/popper.min.js",
    },
    extensions: ['.js', '.jsx'],
  },
});
