import type { Plugin } from 'vite';
import content from '../src/content/scenarios.json';
import { createAiCore } from './ai-core.js';

/**
 * Local AI routes for `npm run dev`, using the key in .env.local.
 * The live Vercel site runs the same core from api/ai.ts.
 */
export function aiPlugin(env: Record<string, string>): Plugin {
  const core = createAiCore({ apiKey: env.GEMINI_API_KEY ?? '', model: env.GEMINI_MODEL, content });

  return {
    name: 'career-plaza-local-ai',
    apply: 'serve',
    configureServer(server) {
      if (!core.on) console.log('[ai] No GEMINI_API_KEY in .env.local: the game uses its scripted lines.');
      else console.log(`[ai] Local AI on (${core.model}). Only this dev server can use it.`);

      server.middlewares.use('/api/ai', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const route = (req.url ?? '').split('?')[0].replace(/^\/+/, '');

        let body: Record<string, unknown> = {};
        if (req.method === 'POST') {
          try {
            let raw = '';
            for await (const chunk of req) {
              raw += chunk;
              if (raw.length > 20000) return send(413, { error: 'Too large' });
            }
            body = raw ? JSON.parse(raw) : {};
          } catch {
            return send(400, { error: 'Bad JSON' });
          }
        }
        const reply = await core.handle(route, req.method ?? 'GET', body);
        send(reply.status, reply.body);
      });
    },
  };
}
