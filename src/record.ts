import { CONTENT, SCENARIO_IDS, SKILL_NAMES, getScenario, skillHint } from './content';
import type { Attempt, ScenarioId, SkillName } from './types';

export interface BuildingSummary {
  id: ScenarioId;
  name: string;
  attempts: number;
  enjoyment: number; // average of the student's own ratings
  confidence: number;
  wantsMore: boolean;
  skills: SkillName[]; // distinct skills used here, in fixed order
}

export interface SkillSummary {
  skill: SkillName;
  total: number;
  buildings: ScenarioId[];
}

export interface GrowthRecord {
  attempts: Attempt[];
  explored: ScenarioId[];
  buildings: BuildingSummary[];
  skills: SkillSummary[];
  gaps: { skill: SkillName; text: string }[];
  tryNext: string[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function exploredIds(attempts: Attempt[]): ScenarioId[] {
  return SCENARIO_IDS.filter((id) => attempts.some((a) => a.scenarioId === id));
}

/** Buildings where some option makes this skill the main one. */
function buildingsOffering(skill: SkillName): ScenarioId[] {
  return SCENARIO_IDS.filter((id) =>
    getScenario(id).options.some((o) => o.skills.some((s) => s.skill === skill && s.weight === 2)),
  );
}

const nameOf = (id: ScenarioId) => getScenario(id).building;

export function buildRecord(all: Attempt[]): GrowthRecord {
  const attempts = [...all].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const explored = exploredIds(attempts);

  const buildings: BuildingSummary[] = explored.map((id) => {
    const mine = attempts.filter((a) => a.scenarioId === id);
    const used = new Set(mine.flatMap((a) => a.skills.map((s) => s.skill)));
    return {
      id,
      name: nameOf(id),
      attempts: mine.length,
      enjoyment: avg(mine.map((a) => a.enjoyment)),
      confidence: avg(mine.map((a) => a.confidence)),
      wantsMore: mine.some((a) => a.wantsMore),
      skills: SKILL_NAMES.filter((s) => used.has(s)),
    };
  });

  const skills: SkillSummary[] = SKILL_NAMES.map((skill) => {
    let total = 0;
    const where = new Set<ScenarioId>();
    for (const a of attempts) {
      for (const s of a.skills) {
        if (s.skill === skill) {
          total += s.weight;
          where.add(a.scenarioId);
        }
      }
    }
    return { skill, total, buildings: SCENARIO_IDS.filter((id) => where.has(id)) };
  });

  // Two least-used skills; ties keep the fixed skill order.
  const gaps = [...skills]
    .sort((a, b) => a.total - b.total)
    .slice(0, 2)
    .map(({ skill, total }) => {
      const places = buildingsOffering(skill)
        .sort((a, b) => Number(explored.includes(a)) - Number(explored.includes(b)))
        .slice(0, 2)
        .map(nameOf);
      const lead = total === 0 ? `${skill} hasn't come up yet.` : `${skill} hasn't come up much yet.`;
      const where = places.length > 1 ? `the ${places[0]} or ${places[1]}` : `the ${places[0]}`;
      return {
        skill,
        text: `${lead} Try ${where} to practise it. Look for options about ${skillHint(skill)}.`,
      };
    });

  return { attempts, explored, buildings, skills, gaps, tryNext: tryNext(buildings, explored) };
}

function tryNext(buildings: BuildingSummary[], explored: ScenarioId[]): string[] {
  const out: string[] = [];
  const suggested = new Set<ScenarioId>();

  // Enjoyed a building: point to another place that uses the same skills.
  for (const b of buildings) {
    if (out.length >= 2) break;
    if (b.enjoyment < 4) continue;
    const partner = SCENARIO_IDS.filter((id) => id !== b.id && !suggested.has(id))
      .filter((id) => b.skills.some((s) => buildingsOffering(s).includes(id)))
      .sort((x, y) => Number(explored.includes(x)) - Number(explored.includes(y)))[0];
    if (!partner) continue;
    suggested.add(partner);
    out.push(
      `You enjoyed the ${b.name}. If you liked ${getScenario(b.id).likePhrase}, the ${nameOf(partner)} uses the same skills in a different setting.`,
    );
  }

  // Asked for more of something (one invitation is enough).
  for (const b of buildings) {
    if (out.length >= 3 || out.some((t) => t.startsWith("You said you'd like more"))) break;
    if (!b.wantsMore || suggested.has(b.id)) continue;
    suggested.add(b.id);
    out.push(`You said you'd like more like the ${b.name}. Go back in: the situation changes a little each time you return.`);
  }

  // Places not yet visited.
  for (const id of SCENARIO_IDS) {
    if (out.length >= 3) break;
    if (explored.includes(id) || suggested.has(id)) continue;
    suggested.add(id);
    out.push(`You haven't tried the ${nameOf(id)} yet. ${getScenario(id).invite}`);
  }

  const fallbacks = [
    'Revisit any building. Each return brings new information to work with.',
    'Notice which moments felt easy and which took effort. That difference is worth talking through with a career coach.',
  ];
  for (const f of fallbacks) if (out.length < 2) out.push(f);
  return out;
}

const RATING_WORDS = ['', 'not much', 'a little', 'somewhat', 'quite a lot', 'a lot'];
export const ratingWord = (n: number) => RATING_WORDS[Math.max(1, Math.min(5, Math.round(n)))];

export function recordAsText(r: GrowthRecord): string {
  const lines: string[] = ['CAREER PLAZA: MY GROWTH RECORD', ''];
  lines.push(`Career map: ${r.explored.length} of 4 explored`, '');
  lines.push('WHAT I TRIED');
  for (const a of r.attempts) {
    const s = getScenario(a.scenarioId);
    const opt = s.options.find((o) => o.id === a.choiceId);
    lines.push(`- ${s.building}${a.isRevisit ? ' (revisit)' : ''}, ${new Date(a.startedAt).toLocaleString()}`);
    if (opt) lines.push(`  Chose: ${opt.text}`);
    if (a.writtenResponse) lines.push(`  My words: "${a.writtenResponse}"`);
    if (a.reflectionNote) lines.push(`  Reflection: "${a.reflectionNote}"`);
  }
  lines.push('', 'WHAT I ENJOYED');
  for (const b of r.buildings) {
    lines.push(
      `- ${b.name}: enjoyed ${ratingWord(b.enjoyment)}, felt confident ${ratingWord(b.confidence)}${b.wantsMore ? ' (would like more like this)' : ''}`,
    );
  }
  lines.push('', 'SKILLS I USED');
  for (const s of r.skills) {
    lines.push(`- ${s.skill}: ${s.buildings.length ? s.buildings.map(nameOf).join(', ') : 'not yet'}`);
  }
  lines.push('', 'SKILLS TO GROW');
  for (const g of r.gaps) lines.push(`- ${g.text}`);
  lines.push('', 'TRY NEXT');
  for (const t of r.tryNext) lines.push(`- ${t}`);
  lines.push('', "This is a starting point, not a verdict. Real internships and conversations with a career coach add what a game can't.");
  return lines.join('\n');
}

/** "A", "A and B", "A, B and C" */
export function joinList(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export const GUIDE = CONTENT.guide;

/** The guide's line for the plaza, based on how many buildings have been explored. */
export function guideLine(attempts: Attempt[]): string {
  const n = exploredIds(attempts).length;
  if (n >= 4) return GUIDE.afterAll;
  if (n >= 2) return GUIDE.afterTwo;
  if (n === 1) return GUIDE.afterFirst;
  return GUIDE.welcome;
}
