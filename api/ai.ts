import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiCore } from '../server/ai-core.js';
import type { Content } from '../server/prompts.js';

/**
 * Vercel serverless function for the live site's AI. vercel.json rewrites
 * /api/ai/<route> to /api/ai?route=<route>, and includes scenarios.json in the bundle.
 * The Gemini key comes from the project's Environment Variables, never from the browser.
 */

function loadContent(): Content {
  const candidates = [
    fileURLToPath(new URL('../src/content/scenarios.json', import.meta.url)),
    join(process.cwd(), 'src', 'content', 'scenarios.json'),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error('scenarios.json not found in the function bundle');
  return JSON.parse(readFileSync(path, 'utf8')) as Content;
}

const core = createAiCore({
  apiKey: process.env.GEMINI_API_KEY ?? '',
  model: process.env.GEMINI_MODEL,
  content: loadContent(),
  // Google's free-tier quota is the real cap; these just stop runaway use of one instance.
  maxCalls: 5000,
  maxCallsPerMinute: 40,
});

// Simple per-visitor limit, kept in this instance's memory.
const WINDOW_MS = 10 * 60 * 1000;
const PER_VISITOR = 30;
const visitors = new Map<string, { start: number; count: number }>();

function overLimit(ip: string): boolean {
  const now = Date.now();
  const v = visitors.get(ip);
  if (!v || now - v.start > WINDOW_MS) {
    visitors.set(ip, { start: now, count: 1 });
    if (visitors.size > 5000) visitors.clear();
    return false;
  }
  v.count++;
  return v.count > PER_VISITOR;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = (url.searchParams.get('route') ?? '').replace(/[^a-z]/g, '');

    if (request.method === 'POST') {
      // Only the game itself may call the AI: the browser's Origin must match this site.
      const origin = request.headers.get('origin');
      const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
      if (!origin || new URL(origin).host !== host) return json(403, { error: 'Not allowed' });

      const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
      if (overLimit(ip)) return json(429, { error: 'Too many requests, try again later' });
    }

    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > 20000) return json(413, { error: 'Too large' });
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return json(400, { error: 'Bad JSON' });
      }
    }

    const reply = await core.handle(route, request.method, body);
    return json(reply.status, reply.body);
  },
};
