export type SkillName = 'Research' | 'Communication' | 'Organisation' | 'Analysis';
export type ScenarioId = 'consulting' | 'classroom' | 'data' | 'research';
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

export interface Scenario {
  id: ScenarioId;
  building: string;
  npc: { name: string; role: string };
  setting: string;
  intro: string;
  question: string;
  twist: string;
  writePrompt: string;
  likePhrase: string;
  invite: string;
  options: ScenarioOption[];
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
  scenarios: Scenario[];
}

export type Attempt = {
  id: string;
  scenarioId: ScenarioId;
  startedAt: string;
  choiceId: ChoiceId;
  writtenResponse?: string;
  reflectionNote?: string;
  enjoyment: Rating;
  confidence: Rating;
  wantsMore: boolean;
  isRevisit: boolean;
  skills: { skill: string; weight: number }[];
};

export type SaveState = { attempts: Attempt[]; version: 1 };
