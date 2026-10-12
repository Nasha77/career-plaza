import raw from './scenarios.json';
import type { ContentFile, Scenario, ScenarioId, SkillName } from '../types';

export const CONTENT = raw as ContentFile;

/** Plaza order, also the order of the original camera tour. */
export const SCENARIO_IDS: ScenarioId[] = ['consulting', 'classroom', 'data', 'research'];
export const SKILL_NAMES: SkillName[] = CONTENT.skills.map((s) => s.name);

export function getScenario(id: ScenarioId): Scenario {
  const s = CONTENT.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario: ${id}`);
  return s;
}

export function skillHint(skill: SkillName): string {
  return CONTENT.skills.find((s) => s.name === skill)?.hint ?? '';
}
