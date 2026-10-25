import type { ChoiceId, SkillName } from '../types';

export interface FeedbackInput {
  scenarioId: string;
  choiceId: ChoiceId;
  writtenResponse?: string;
  isRevisit: boolean;
  twist?: string;
  /** The manager's follow-up question and the student's reply, when the AI asked one. */
  followupQuestion?: string;
  followupAnswer?: string;
  /** Earlier internships, so a manager can mention a skill carrying over. */
  earlier?: { building: string; choice: string }[];
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
