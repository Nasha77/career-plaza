import { aiFeedback } from '../ai/client';
import type { FeedbackInput, FeedbackProvider, FeedbackResult } from './provider';
import { ScriptedProvider } from './scripted';

/**
 * Asks the local AI for the manager's words, keeping the skill tags from the content
 * file so the growth record stays consistent. Falls back to the scripted lines.
 */
export class AiProvider implements FeedbackProvider {
  private scripted = new ScriptedProvider();

  async getFeedback(input: FeedbackInput): Promise<FeedbackResult> {
    const base = await this.scripted.getFeedback(input);
    const ai = await aiFeedback({
      scenarioId: input.scenarioId,
      choiceId: input.choiceId,
      text: input.writtenResponse,
      followupQuestion: input.followupQuestion,
      followupAnswer: input.followupAnswer,
      isRevisit: input.isRevisit,
      earlier: input.earlier,
    });
    if (!ai) return base;
    return {
      npcReaction: ai.npcReaction,
      acknowledgement: ai.acknowledgement,
      reflectiveQuestion: ai.reflectiveQuestion,
      skills: base.skills,
    };
  }
}
