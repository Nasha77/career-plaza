import { defineConfig } from 'vite';

// Relative base so the build can be hosted from any folder or opened as a published page.
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
