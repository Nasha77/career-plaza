import raw from './scenarios.json';
import type { ContentFile, Scenario, ScenarioId, SkillName, TaskIndex } from '../types';

export const CONTENT = raw as ContentFile;

/** Plaza order, also the order of the original camera tour. */
export const SCENARIO_IDS: ScenarioId[] = ['resort', 'policy', 'foundation', 'workforce'];
export const SKILL_NAMES: SkillName[] = CONTENT.skills.map((s) => s.name);

export function getScenario(id: ScenarioId): Scenario {
  const s = CONTENT.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario: ${id}`);
  return s;
}

/** A building's task as one Scenario: task B's fields laid over the building's. */
export function getTask(id: ScenarioId, taskIndex: TaskIndex = 0): Scenario {
  const s = getScenario(id);
  if (taskIndex === 0 || !s.taskB) return s;
  const { managerColleague: _, ...task } = s.taskB;
  return { ...s, ...task };
}

/** The colleague who runs task B, if any (they leave the room's crowd for that task). */
export function taskManagerIndex(id: ScenarioId, taskIndex: TaskIndex): number | null {
  const b = getScenario(id).taskB;
  return taskIndex === 1 && b ? b.managerColleague : null;
}

export const taskCount = (id: ScenarioId) => (getScenario(id).taskB ? 2 : 1);

export function skillHint(skill: SkillName): string {
  return CONTENT.skills.find((s) => s.name === skill)?.hint ?? '';
}
