import { SCENARIO_IDS } from './content';
import type { Attempt, SaveState, SelfCheck } from './types';

const KEY = 'careerPlaza.v2';
/** Saves from the first version refer to jobs that no longer exist, so they're cleared. */
const OLD_KEYS = ['careerPlaza.v1'];

const empty = (): SaveState => ({ attempts: [], selfChecks: [], version: 2 });
let memory: SaveState = empty();

function isAttempt(a: unknown): a is Attempt {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    SCENARIO_IDS.includes(x.scenarioId as never) &&
    ['A', 'B', 'C'].includes(x.choiceId as string) &&
    typeof x.enjoyment === 'number' &&
    typeof x.confidence === 'number' &&
    Array.isArray(x.skills)
  );
}

function isSelfCheck(c: unknown): c is SelfCheck {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  return typeof x.takenAt === 'string' && typeof x.confidence === 'object' && Array.isArray(x.skillPicks);
}

export function loadState(): SaveState {
  try {
    for (const k of OLD_KEYS) window.localStorage.removeItem(k);
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveState>;
      if (parsed && parsed.version === 2) {
        memory = {
          version: 2,
          attempts: Array.isArray(parsed.attempts) ? parsed.attempts.filter(isAttempt) : [],
          selfChecks: Array.isArray(parsed.selfChecks) ? parsed.selfChecks.filter(isSelfCheck) : [],
        };
      }
    }
  } catch {
    // Storage blocked or corrupt: keep playing from memory.
  }
  return memory;
}

export function saveState(state: SaveState): void {
  memory = state;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: progress lives for this session only.
  }
}

export function clearState(): SaveState {
  memory = empty();
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return memory;
}
