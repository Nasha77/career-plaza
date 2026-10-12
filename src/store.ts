import { SCENARIO_IDS } from './content';
import type { Attempt, SaveState } from './types';

const KEY = 'careerPlaza.v1';
let memory: SaveState = { attempts: [], version: 1 };

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

export function loadState(): SaveState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveState>;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.attempts)) {
        memory = { version: 1, attempts: parsed.attempts.filter(isAttempt) };
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
  memory = { attempts: [], version: 1 };
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return memory;
}
