import { CONTENT, getScenario } from '../content';
import type { ScenarioId } from '../types';
import type { FeedbackInput, FeedbackProvider, FeedbackResult } from './provider';

/** Picks one acknowledging line for a written response. Never grades the writing. */
export function acknowledge(written?: string): string | undefined {
  const text = written?.trim() ?? '';
  const a = CONTENT.acknowledgements;
  if (text.length < a.minLength) return undefined;
  if (/\d|%/.test(text)) return a.number;
  if (/\b(because|since)\b/i.test(text)) return a.reason;
  if (text.includes('?')) return a.question;
  return a.otherwise;
}

/** Reads everything from the content file. Resolves instantly and works offline. */
export class ScriptedProvider implements FeedbackProvider {
  getFeedback(input: FeedbackInput): Promise<FeedbackResult> {
    const scenario = getScenario(input.scenarioId as ScenarioId);
    const option = scenario.options.find((o) => o.id === input.choiceId);
    if (!option) return Promise.reject(new Error(`Unknown choice ${input.choiceId}`));
    const npcReaction = input.isRevisit ? `${option.feedback} ${option.twistFeedback}` : option.feedback;
    return Promise.resolve({
      npcReaction,
      acknowledgement: acknowledge(input.writtenResponse),
      reflectiveQuestion: option.reflectiveQuestion,
      skills: option.skills.map((s) => ({ ...s })),
    });
  }
}
