import { generateJson, type GeminiConfig } from './gemini.js';
import { clean, coachPrompt, feedbackPrompt, findScenario, followupPrompt, summaryPrompt, useContent, type Content } from './prompts.js';

/**
 * The AI routes, shared by the local dev server (server/ai-plugin.ts) and the
 * Vercel function (api/ai.ts).
 *
 * Guardrails: short capped inputs, student text fenced as data, schema-shaped JSON
 * replies, output checks below, and call caps. Anything that fails returns an error,
 * and the game uses its scripted line.
 */

export interface AiCoreOptions {
  apiKey: string;
  model?: string;
  content: Content;
  /** Total calls allowed for the lifetime of this process (a dev-server run or a function instance). */
  maxCalls?: number;
  maxCallsPerMinute?: number;
  log?: (line: string) => void;
}

export interface AiReply {
  status: number;
  body: unknown;
}

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/** Skip the retry if the first try was already slow, so the student isn't left waiting. */
const RETRY_ONLY_IF_FASTER_THAN_MS = 8000;

const BANNED = [/\bscore\b/i, /\bgrade[ds]?\b/i, /\bmarks?\b(?! of)/i, /\b\d+\s*\/\s*10\b/, /\bout of (5|10|100)\b/i, /best (match|fit)/i, /correct answer/i, /\bwrong answer\b/i, /```/, /https?:\/\//i, /<\/?[a-z_]+>/i];

function ok(text: unknown, max: number, mustAsk = false): text is string {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || t.length > max) return false;
  if (mustAsk && !t.endsWith('?')) return false;
  return !BANNED.some((re) => re.test(t));
}
const optional = (text: unknown, max: number) => text === '' || ok(text, max);

export function createAiCore(opts: AiCoreOptions) {
  const apiKey = opts.apiKey.trim();
  const cfg: GeminiConfig = { apiKey, model: opts.model?.trim() || DEFAULT_MODEL };
  const maxCalls = opts.maxCalls ?? 120;
  const perMinute = opts.maxCallsPerMinute ?? 20;
  const log = opts.log ?? ((line: string) => console.log(line));
  useContent(opts.content);

  let calls = 0;
  let minuteStart = Date.now();
  let minuteCalls = 0;

  async function call(label: string, prompt: { system: string; user: string; schema: Record<string, unknown> }, maxOutputTokens: number) {
    if (calls >= maxCalls) throw new Error('AI call limit reached for this run.');
    if (Date.now() - minuteStart > 60000) {
      minuteStart = Date.now();
      minuteCalls = 0;
    }
    if (minuteCalls >= perMinute) throw new Error('Too many AI calls this minute.');
    calls++;
    minuteCalls++;
    const { data, tokens } = await generateJson(cfg, { ...prompt, maxOutputTokens });
    log(`[ai] ${label} · ${cfg.model} · ${tokens} · call ${calls}/${maxCalls}`);
    return data as Record<string, unknown>;
  }

  /** `route` is the path after /api/ai/, for example "coach". */
  async function handle(route: string, method: string, body: Record<string, unknown>): Promise<AiReply> {
    if (route === 'status') return { status: 200, body: { on: !!apiKey, model: apiKey ? cfg.model : null } };
    if (!apiKey) return { status: 503, body: { error: 'AI is off' } };
    if (method !== 'POST') return { status: 405, body: { error: 'POST only' } };

    const attempt = async (): Promise<AiReply> => {
      if (route === 'coach') {
        const s = findScenario(body.scenarioId);
        const text = clean(body.text);
        if (!s || !text) return { status: 400, body: { error: 'Missing scenario or text' } };
        const out = await call('coach', coachPrompt(s, body.choiceId, text), 250);
        const solid = out.status === 'solid';
        if (out.status !== 'solid' && out.status !== 'could_strengthen') throw new Error('Bad status');
        if (!optional(out.whatWorks, 220) || (!solid && !ok(out.tip, 300))) throw new Error('Coach reply failed checks');
        return { status: 200, body: { status: out.status, whatWorks: out.whatWorks || undefined, tip: solid ? '' : out.tip } };
      }
      if (route === 'followup') {
        const s = findScenario(body.scenarioId);
        const text = clean(body.text);
        if (!s || !text) return { status: 400, body: { error: 'Missing scenario or text' } };
        const out = await call('followup', followupPrompt(s, body.choiceId, text), 120);
        if (!ok(out.question, 220, true)) throw new Error('Follow-up failed checks');
        return { status: 200, body: { question: out.question } };
      }
      if (route === 'feedback') {
        const s = findScenario(body.scenarioId);
        if (!s) return { status: 400, body: { error: 'Missing scenario' } };
        const out = await call('feedback', feedbackPrompt(s, body), 400);
        if (!ok(out.npcReaction, 480) || !optional(out.acknowledgement, 260) || !ok(out.reflectiveQuestion, 200, true)) {
          throw new Error('Feedback failed checks');
        }
        return {
          status: 200,
          body: { npcReaction: out.npcReaction, acknowledgement: out.acknowledgement || undefined, reflectiveQuestion: out.reflectiveQuestion },
        };
      }
      if (route === 'summary') {
        const out = await call('summary', summaryPrompt(body), 700);
        const paras = Array.isArray(out.paragraphs) ? out.paragraphs : [];
        if (paras.length < 1 || paras.length > 4 || !paras.every((p) => ok(p, 600))) throw new Error('Summary failed checks');
        return { status: 200, body: { paragraphs: paras } };
      }
      return { status: 404, body: { error: 'Unknown AI route' } };
    };

    // One automatic retry for hiccups: a timeout, a server error, an empty reply or a reply that
    // fails the checks. Never for a rejected key, the free-tier limit or our own call caps.
    const started = Date.now();
    for (let n = 1; ; n++) {
      try {
        return await attempt();
      } catch (err) {
        const msg = (err as Error).message;
        const retryable = !/HTTP (400|401|403|404|429)|limit reached|Too many/.test(msg);
        if (n >= 2 || !retryable || Date.now() - started > RETRY_ONLY_IF_FASTER_THAN_MS) {
          log(`[ai] ${route} fell back to scripted: ${msg}`);
          return { status: 502, body: { error: 'AI unavailable' } };
        }
        log(`[ai] ${route} hiccup, retrying once: ${msg}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  return { handle, model: cfg.model, on: !!apiKey };
}
