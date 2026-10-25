export type SkillName = 'Research' | 'Communication' | 'Organisation' | 'Analysis';
export type ScenarioId = 'resort' | 'policy' | 'foundation' | 'workforce';
export type ChoiceId = 'A' | 'B' | 'C';
export type Rating = 1 | 2 | 3 | 4 | 5;

export interface SkillAward {
  skill: SkillName;
  weight: 1 | 2;
}

export interface ScenarioOption {
  id: ChoiceId;
  text: string;
  skills: SkillAward[];
  feedback: string;
  twistFeedback: string;
  reflectiveQuestion: string;
}

export interface Resource {
  title: string;
  url: string;
  why: string;
}

/** What a good written answer looks like for a scenario, used for coaching (never grading). */
export interface WriteGuide {
  points: string[];
  tip: string;
  /** Words that suggest the answer is on the task; used by the offline check. */
  keywords: string[];
}

export interface Scenario {
  id: ScenarioId;
  building: string;
  internRole: string;
  npc: { name: string; role: string };
  setting: string;
  intro: string;
  question: string;
  twist: string;
  writePrompt: string;
  writeGuide: WriteGuide;
  likePhrase: string;
  invite: string;
  resources: Resource[];
  options: ScenarioOption[];
}

export interface SelfCheckContent {
  intro: string;
  confidence: { skill: SkillName; statement: string }[];
  skillPicks: { question: string; options: { skill: SkillName; label: string }[] }[];
  fieldPick: { question: string; options: { scenario: ScenarioId; label: string }[] };
}

export interface ContentFile {
  skills: { name: SkillName; hint: string }[];
  guide: {
    name: string;
    welcome: string;
    afterFirst: string;
    afterTwo: string;
    afterAll: string;
  };
  acknowledgements: {
    minLength: number;
    number: string;
    reason: string;
    question: string;
    otherwise: string;
  };
  selfCheck: SelfCheckContent;
  commonResources: Resource[];
  scenarios: Scenario[];
}

export type Attempt = {
  id: string;
  scenarioId: ScenarioId;
  startedAt: string;
  choiceId: ChoiceId;
  writtenResponse?: string;
  /** The first draft, kept when the student chose to revise after coaching. */
  firstDraft?: string;
  revisions?: number;
  reflectionNote?: string;
  enjoyment: Rating;
  confidence: Rating;
  wantsMore: boolean;
  isRevisit: boolean;
  skills: { skill: string; weight: number }[];
};

/** How the student saw themselves at the start (or on a retake). Self-reported, never scored. */
export type SelfCheck = {
  takenAt: string;
  confidence: Partial<Record<SkillName, Rating>>;
  skillPicks: SkillName[];
  field: ScenarioId | null;
};

export type SaveState = { attempts: Attempt[]; selfChecks: SelfCheck[]; version: 2 };
