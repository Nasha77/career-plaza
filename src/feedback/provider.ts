import type { ChoiceId, SkillName } from '../types';

export interface FeedbackInput {
  scenarioId: string;
  choiceId: ChoiceId;
  writtenResponse?: string;
  isRevisit: boolean;
  twist?: string;
}

export interface FeedbackResult {
  npcReaction: string; // 1-3 sentences
  acknowledgement?: string; // about the written response
  reflectiveQuestion: string;
  skills: { skill: SkillName; weight: 1 | 2 }[];
}

export interface FeedbackProvider {
  getFeedback(input: FeedbackInput): Promise<FeedbackResult>;
}
