import type { CoachResult } from '../feedback/coach';
import type { Attempt, ChoiceId, ScenarioId, SelfCheck } from '../types';

/**
 * Talks to the AI routes: the local dev server under `npm run dev`, or the Vercel function on the live site.
 * Builds without AI routes (anything but `npm run dev` and Vercel) set __AI_ROUTES__ to false, so none of this runs.
 * Every call returns null on any problem, and the caller uses the scripted line instead.
 */

const TIMEOUT_MS = 22000;

async function post<T>(route: string, body: unknown): Promise<T | null> {
  if (!__AI_ROUTES__) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`/api/ai/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function aiAvailable(): Promise<boolean> {
  if (!__AI_ROUTES__) return false;
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) return false;
    const json = (await res.json()) as { on?: boolean };
    return json.on === true;
  } catch {
    return false;
  }
}

export function aiCoach(scenarioId: ScenarioId, choiceId: ChoiceId, text: string) {
  return post<CoachResult>('coach', { scenarioId, choiceId, text });
}

export async function aiFollowup(scenarioId: ScenarioId, choiceId: ChoiceId, text: string): Promise<string | null> {
  const r = await post<{ question: string }>('followup', { scenarioId, choiceId, text });
  return r?.question ?? null;
}

export interface AiFeedbackInput {
  scenarioId: string;
  choiceId: ChoiceId;
  text?: string;
  followupQuestion?: string;
  followupAnswer?: string;
  isRevisit: boolean;
  earlier?: { building: string; choice: string }[];
}

export function aiFeedback(input: AiFeedbackInput) {
  return post<{ npcReaction: string; acknowledgement?: string; reflectiveQuestion: string }>('feedback', input);
}

export async function aiSummary(attempts: Attempt[], selfCheck: SelfCheck | null): Promise<string[] | null> {
  const r = await post<{ paragraphs: string[] }>('summary', { attempts, selfCheck });
  return r?.paragraphs ?? null;
}
