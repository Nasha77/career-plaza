/**
 * True when the build can reach the AI routes: under `npm run dev`, and in builds on Vercel.
 * False in every other build (such as GitHub Pages), so those builds contain no AI calls at all.
 * Set in vite.config.ts.
 */
declare const __AI_ROUTES__: boolean;
