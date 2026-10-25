import { defineConfig, loadEnv } from 'vite';
import { aiPlugin } from './server/ai-plugin';

// Relative base so the build can be hosted from any folder or opened as a published page.
export default defineConfig(({ mode }) => {
  // Load every variable from .env.local (no VITE_ prefix), so keys reach only the dev server,
  // never the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    build: { target: 'es2020', chunkSizeWarningLimit: 900 },
    plugins: [aiPlugin(env)],
  };
});
