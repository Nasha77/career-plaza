import type { Scenario } from '../types';

/** Coaching on a written answer. Never a score: either it's fine to move on, or here's one tip. */
export interface CoachResult {
  status: 'solid' | 'could_strengthen';
  whatWorks?: string;
  tip: string;
}

/** How many times a student is offered the chance to revise before the scenario moves on. */
export const MAX_REVISIONS = 2;

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Offline check used when no AI is available. It only catches clearly weak answers
 * (very short, or not about the task); anything reasonable counts as solid.
 */
export function coachWriting(scenario: Scenario, text: string): CoachResult {
  const guide = scenario.writeGuide;
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const words = clean.split(/\s+/).filter(Boolean).length;
  const onTask = guide.keywords.some((k) => lower.includes(k.toLowerCase()));
  const firstPoint = lowerFirst(guide.points[0]);

  if (words < 4) {
    return {
      status: 'could_strengthen',
      tip: `Could you say a bit more? A strong answer here ${firstPoint}.`,
    };
  }
  if (!onTask && words < 15) {
    return {
      status: 'could_strengthen',
      whatWorks: "You've made a start.",
      tip: `I'm not sure this connects to the task yet. A strong answer here ${firstPoint}.`,
    };
  }
  if (onTask && words < 8) {
    return { status: 'could_strengthen', whatWorks: "You're on the right topic.", tip: guide.tip };
  }
  return { status: 'solid', tip: '' };
}
