/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5500,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    globals: false,
  },
});
