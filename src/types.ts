export type SkillName = 'Research' | 'Communication' | 'Organisation' | 'Analysis';
export type ScenarioId = 'resort' | 'policy' | 'foundation' | 'workforce';
export type ChoiceId = 'A' | 'B' | 'C';
export type Rating = 1 | 2 | 3 | 4 | 5;

export interface SkillAward {
  skill: SkillName;
  weight: 1 | 2;
}

/** Made-up practice findings for one option: a small table, notes, or a list. */
export interface Finding {
  title: string;
  kind: 'table' | 'notes' | 'list';
  rows?: [string, string][];
  items?: string[];
  /** The one takeaway worth noticing. */
  note?: string;
}

export interface ScenarioOption {
  id: ChoiceId;
  text: string;
  skills: SkillAward[];
  /** What the manager says right after this option is picked. */
  chooseLine: string;
  /** What the student's action turned up: shown while they write, and given to the AI. */
  result: Finding;
  /** How this way of working shows up in humanities coursework. */
  studyLink: string;
  /** Short label for the place in the room where this approach happens. */
  spot: string;
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

/** Each manager's lines for the smaller actions, in their own voice. */
export interface Reactions {
  skipWrite: string;
  revise: string;
  keep: string;
  reflected: string;
  skippedReflect: string;
  rateHigh: string;
  rateMid: string;
  rateLow: string;
  wantsMore: string;
  studied: string;
  skippedStudies: string;
}

/**
 * A background person. Most ask a quick multiple-choice question, some an open one, and a few
 * are busy. Anyone not busy can also be asked what they're working on (`line`).
 */
export interface Extra {
  name: string;
  role: string;
  /** So their character model matches their name. */
  gender: 'f' | 'm';
  line: string;
  /** What they're busy with, if they'd rather not be disturbed. */
  busy?: string;
  /** The question they ask the player. */
  ask?: string;
  /** Answers to pick from, each with their reply (a multiple-choice question). */
  choices?: { text: string; reply: string }[];
  /** Their reply to an open question. */
  reply?: string;
}

/** One line in the conversational intro: either the manager or the student's reply chip. */
export type ChatLine = { npc: string } | { you: string };

/** A colleague in the building the student can talk to. */
export interface Colleague {
  name: string;
  role: string;
  team: string;
  lines: string[];
  openRole?: string;
}

export interface Scenario {
  id: ScenarioId;
  building: string;
  internRole: string;
  npc: { name: string; role: string };
  /** Personality, used for the scripted lines and as the AI's character brief. */
  persona: { personality: string; voice: string };
  reactions: Reactions;
  colleagues: Colleague[];
  setting: string;
  intro: string;
  /** The intro as a short exchange: manager bubbles and the student's reply chips. */
  chat: ChatLine[];
  /** The revisit twist, as the manager says it in the chat. */
  twistLine: string;
  /** One neutral line restating the task, shown while the student writes. */
  brief: string;
  question: string;
  twist: string;
  writePrompt: string;
  writeGuide: WriteGuide;
  likePhrase: string;
  invite: string;
  resources: Resource[];
  options: ScenarioOption[];
  /** Background people in the room (positions in layouts.ts). */
  extras: Extra[];
  /** Things in the room you can look at, by spot id (see src/world/three/layouts.ts). */
  examine: Record<string, { label: string; lines: string[] }>;
  /** The second task, offered on the next visit: a different role with one of the colleagues. */
  taskB?: TaskB;
  /** The front desk: who welcomes you, what they say about the company, and the sign behind them. */
  reception: { name: string; role: string; lines: string[]; sign: string[] };
}

/** Everything that changes between a building's two tasks. The building and its people stay. */
export type TaskB = Omit<Scenario, 'id' | 'building' | 'colleagues' | 'taskB' | 'reception'> & {
  /** Which colleague runs this task (their index in `colleagues`). */
  managerColleague: number;
};

/** 0 is the building's first task, 1 its second. */
export type TaskIndex = 0 | 1;

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
  /** The optional coursework question after each task. */
  studies: { question: string; placeholder: string };
  commonResources: Resource[];
  scenarios: Scenario[];
}

export type Attempt = {
  id: string;
  scenarioId: ScenarioId;
  /** Which of the building's tasks this was. Missing on older saves, which means 0. */
  taskIndex?: TaskIndex;
  startedAt: string;
  choiceId: ChoiceId;
  writtenResponse?: string;
  /** The first draft, kept when the student chose to revise after coaching. */
  firstDraft?: string;
  revisions?: number;
  reflectionNote?: string;
  /** Where the student says they've used this way of working in their studies. */
  studyNote?: string;
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
