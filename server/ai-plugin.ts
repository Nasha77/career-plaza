import type { Plugin } from 'vite';
import { generateJson, type GeminiConfig } from './gemini';
import { clean, coachPrompt, feedbackPrompt, findScenario, followupPrompt, summaryPrompt } from './prompts';

/**
 * Local-only AI routes for `npm run dev`. They do not exist in `npm run build`,
 * so the public site never calls an AI service.
 *
 * Guardrails: short capped inputs, student text fenced as data, schema-shaped JSON
 * replies, output checks below, a per-run call cap and a per-minute limit.
 * Anything that fails a check returns an error, and the game uses its scripted line.
 */

const MAX_CALLS_PER_RUN = 120;
const MAX_CALLS_PER_MINUTE = 20;

const BANNED = [/\bscore\b/i, /\bgrade[ds]?\b/i, /\bmarks?\b(?! of)/i, /\b\d+\s*\/\s*10\b/, /\bout of (5|10|100)\b/i, /best (match|fit)/i, /correct answer/i, /\bwrong answer\b/i, /```/, /https?:\/\//i, /<\/?[a-z_]+>/i];

function ok(text: unknown, max: number, mustAsk = false): text is string {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || t.length > max) return false;
  if (mustAsk && !t.endsWith('?')) return false;
  return !BANNED.some((re) => re.test(t));
}
const optional = (text: unknown, max: number) => text === '' || ok(text, max);

export function aiPlugin(env: Record<string, string>): Plugin {
  const apiKey = env.GEMINI_API_KEY?.trim() ?? '';
  const cfg: GeminiConfig = { apiKey, model: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite' };
  let calls = 0;
  let minuteStart = Date.now();
  let minuteCalls = 0;

  async function call(label: string, prompt: { system: string; user: string; schema: Record<string, unknown> }, maxOutputTokens = 400) {
    if (calls >= MAX_CALLS_PER_RUN) throw new Error('AI call limit for this dev-server run reached; restart `npm run dev` to reset.');
    if (Date.now() - minuteStart > 60000) {
      minuteStart = Date.now();
      minuteCalls = 0;
    }
    if (minuteCalls >= MAX_CALLS_PER_MINUTE) throw new Error('Too many AI calls this minute.');
    calls++;
    minuteCalls++;
    const { data, tokens } = await generateJson(cfg, { ...prompt, maxOutputTokens });
    console.log(`[ai] ${label} · ${cfg.model} · ${tokens} · call ${calls}/${MAX_CALLS_PER_RUN}`);
    return data as Record<string, unknown>;
  }

  return {
    name: 'career-plaza-local-ai',
    apply: 'serve',
    configureServer(server) {
      if (!apiKey) console.log('[ai] No GEMINI_API_KEY in .env.local: the game uses its scripted lines.');
      else console.log(`[ai] Local AI on (${cfg.model}). Only this dev server can use it.`);

      server.middlewares.use('/api/ai', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const route = (req.url ?? '').split('?')[0];
        if (route === '/status') return send(200, { on: !!apiKey, model: apiKey ? cfg.model : null });
        if (!apiKey) return send(503, { error: 'AI is off' });
        if (req.method !== 'POST') return send(405, { error: 'POST only' });

        let body: Record<string, unknown> = {};
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

        try {
          if (route === '/coach') {
            const s = findScenario(body.scenarioId);
            const text = clean(body.text);
            if (!s || !text) return send(400, { error: 'Missing scenario or text' });
            const out = await call('coach', coachPrompt(s, body.choiceId, text), 250);
            const solid = out.status === 'solid';
            if (out.status !== 'solid' && out.status !== 'could_strengthen') throw new Error('Bad status');
            if (!optional(out.whatWorks, 220) || (!solid && !ok(out.tip, 300))) throw new Error('Coach reply failed checks');
            return send(200, { status: out.status, whatWorks: out.whatWorks || undefined, tip: solid ? '' : out.tip });
          }
          if (route === '/followup') {
            const s = findScenario(body.scenarioId);
            const text = clean(body.text);
            if (!s || !text) return send(400, { error: 'Missing scenario or text' });
            const out = await call('followup', followupPrompt(s, body.choiceId, text), 120);
            if (!ok(out.question, 220, true)) throw new Error('Follow-up failed checks');
            return send(200, { question: out.question });
          }
          if (route === '/feedback') {
            const s = findScenario(body.scenarioId);
            if (!s) return send(400, { error: 'Missing scenario' });
            const out = await call('feedback', feedbackPrompt(s, body), 400);
            if (!ok(out.npcReaction, 480) || !optional(out.acknowledgement, 260) || !ok(out.reflectiveQuestion, 200, true)) {
              throw new Error('Feedback failed checks');
            }
            return send(200, {
              npcReaction: out.npcReaction,
              acknowledgement: out.acknowledgement || undefined,
              reflectiveQuestion: out.reflectiveQuestion,
            });
          }
          if (route === '/summary') {
            const out = await call('summary', summaryPrompt(body), 700);
            const paras = Array.isArray(out.paragraphs) ? out.paragraphs : [];
            if (paras.length < 1 || paras.length > 4 || !paras.every((p) => ok(p, 600))) throw new Error('Summary failed checks');
            return send(200, { paragraphs: paras });
          }
          return send(404, { error: 'Unknown AI route' });
        } catch (err) {
          console.warn(`[ai] ${route} fell back to scripted: ${(err as Error).message}`);
          return send(502, { error: 'AI unavailable' });
        }
      });
    },
  };
}
