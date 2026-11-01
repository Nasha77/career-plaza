import type { ScenarioId, TaskIndex } from '../../types';
import type { Pose } from './actor';
import type { Look } from './models';

/**
 * Where everything goes in each room. The room is 16 wide (x from -8 to 8) and 12 deep
 * (z from -6 at the back wall to 6 at the open front). The camera looks in from the front right.
 * Yaw: 0 faces the front, PI faces the back wall, -PI/2 faces the left wall.
 */

export interface Prop {
  /** Model path under public/models, without .glb. */
  m: string;
  x: number;
  z: number;
  r?: number;
  s?: number;
  /** Index of an earlier prop to sit on top of (a laptop on a desk). */
  on?: number;
  /** Rugs and mats can be walked over. */
  walk?: boolean;
}

export interface Placement {
  x: number;
  z: number;
  r: number;
  pose?: Pose;
}

export interface Layout {
  props: Prop[];
  manager: Placement;
  /** Colleagues by their index in the content file. The one running task B is skipped. */
  people: Record<number, Placement>;
  /** Approach spots (A, B, C) and things to examine, by id. `r` is how far to stand from it. */
  spots: Record<string, { x: number; z: number; y?: number; r?: number }>;
}

/** Who looks like whom: the first task's manager, then the colleagues in content order. */
export const CAST: Record<ScenarioId, { manager: Look; colleagues: Look[] }> = {
  resort: { manager: 'character-female-a', colleagues: ['character-female-f', 'character-male-f', 'character-female-b'] },
  policy: { manager: 'character-male-d', colleagues: ['character-female-c', 'character-male-a', 'character-female-e'] },
  foundation: { manager: 'character-female-d', colleagues: ['character-male-f', 'character-female-b', 'character-female-a'] },
  workforce: { manager: 'character-male-b', colleagues: ['character-female-e', 'character-male-a', 'character-female-c'] },
};

const PI = Math.PI;
const HALF = Math.PI / 2;

// Shorthands for common furniture
const desk = (x: number, z: number, r = 0): Prop => ({ m: 'furniture/desk', x, z, r });
const chair = (x: number, z: number, r = PI): Prop => ({ m: 'furniture/chairDesk', x, z, r });
const plant = (x: number, z: number): Prop => ({ m: 'furniture/pottedPlant', x, z });

const resortA: Layout = {
  props: [
    desk(-5.2, -4.9), // 0
    { m: 'furniture/laptop', x: -5.2, z: -4.9, on: 0 },
    chair(-5.2, -3.6),
    desk(-1.9, -4.9), // 3
    { m: 'furniture/computerScreen', x: -1.9, z: -5.1, on: 3 },
    { m: 'food/mug', x: -1.0, z: -4.8, on: 3 },
    chair(-1.9, -3.6),
    // Pantry corner
    { m: 'furniture/kitchenCabinet', x: 4.6, z: -5.45 }, // 7
    { m: 'furniture/kitchenCabinet', x: 5.75, z: -5.45 },
    { m: 'furniture/kitchenCoffeeMachine', x: 4.6, z: -5.5, on: 7 },
    { m: 'furniture/kitchenFridgeSmall', x: 7.1, z: -5.3 },
    { m: 'food/cup-tea', x: 5.6, z: -5.4, on: 8 },
    // Boxes of volunteer T-shirts
    { m: 'furniture/cardboardBoxClosed', x: 1.9, z: -5.3 },
    { m: 'furniture/cardboardBoxOpen', x: 2.7, z: -4.9, r: 0.4 },
    // Lounge with last year's photo album
    { m: 'furniture/rugRounded', x: -4.6, z: 2.8, walk: true },
    { m: 'furniture/loungeSofa', x: -6.7, z: 2.8, r: HALF },
    { m: 'furniture/tableCoffee', x: -4.4, z: 2.8 }, // 16
    { m: 'furniture/books', x: -4.4, z: 2.8, on: 16 },
    { m: 'furniture/loungeChair', x: -2.4, z: 2.8, r: -HALF },
    { m: 'furniture/bookcaseOpen', x: 7.4, z: -2.4, r: -HALF },
    plant(-7.3, -5.3),
    plant(7.3, 1.2),
  ],
  manager: { x: 0.6, z: -2.2, r: 0.5 },
  people: {
    0: { x: 3.4, z: -3.6, r: -2.4 },
    1: { x: -5.2, z: -3.4, r: PI, pose: 'sit' },
    2: { x: 5.2, z: -4.2, r: PI },
  },
  spots: {
    A: { x: -1.9, z: -4.9 },
    B: { x: -4.4, z: 2.8 },
    C: { x: -7.8, z: -2.6, y: 3 },
    poster: { x: -1.0, z: -5.9, y: 3.4 },
    boxes: { x: 2.3, z: -5.1 },
    coffee: { x: 4.6, z: -5.4, y: 1.6 },
    bookcase: { x: 7.4, z: -2.4 },
  },
};

const resortB: Layout = {
  props: [
    { m: 'holiday/tree-decorated', x: 6.4, z: -4.6 },
    { m: 'holiday/present-a-cube', x: 5.2, z: -4.4 },
    { m: 'holiday/present-b-round', x: 7.2, z: -3.4 },
    { m: 'holiday/present-a-rectangle', x: 5.6, z: -3.5, r: 0.5 },
    { m: 'holiday/lantern', x: 4.4, z: -5.2 },
    // The planning table with the run-sheet
    { m: 'furniture/table', x: -2.0, z: 1.2 }, // 5
    { m: 'furniture/laptop', x: -2.4, z: 1.2, on: 5 },
    { m: 'food/cup-coffee', x: -1.2, z: 1.3, on: 5 },
    { m: 'furniture/chair', x: -2.0, z: 2.6, r: PI },
    { m: 'furniture/chair', x: -3.6, z: 1.2, r: HALF },
    // Desk with last year's numbers
    desk(2.0, -4.9), // 10
    { m: 'furniture/computerScreen', x: 2.0, z: -5.1, on: 10 },
    chair(2.0, -3.6),
    // Gift hamper samples
    { m: 'market/display-fruit', x: -6.6, z: 2.4 },
    { m: 'market/display-bread', x: -6.6, z: 4.0 },
    plant(-7.3, -5.3),
    plant(7.3, 1.6),
  ],
  manager: { x: 0.2, z: -1.6, r: 0.5 },
  people: {
    1: { x: 4.8, z: -2.4, r: -2.2 },
    2: { x: 2.0, z: -3.4, r: PI, pose: 'sit' },
  },
  spots: {
    A: { x: 2.0, z: -4.9 },
    B: { x: -2.0, z: 1.2 },
    C: { x: 6.0, z: -3.8 },
    board: { x: -1.2, z: -5.9, y: 3.4 },
    banner: { x: -6.6, z: -4.6, y: 1.6 },
    hamper: { x: -6.6, z: 3.2 },
  },
};

const policyA: Layout = {
  props: [
    desk(-1.8, -4.9), // 0
    { m: 'furniture/computerScreen', x: -2.4, z: -5.1, on: 0 },
    { m: 'furniture/computerScreen', x: -1.2, z: -5.1, on: 0 },
    chair(-1.8, -3.6),
    desk(4.4, -4.9), // 4
    { m: 'furniture/computerScreen', x: 4.4, z: -5.1, on: 4 },
    { m: 'food/mug', x: 5.2, z: -4.8, on: 4 },
    chair(4.4, -3.6),
    // Meeting table with the deal files
    { m: 'furniture/tableRound', x: -3.8, z: 2.6 }, // 8
    { m: 'furniture/books', x: -3.8, z: 2.6, on: 8 },
    { m: 'furniture/chair', x: -5.2, z: 2.6, r: HALF },
    { m: 'furniture/chair', x: -2.4, z: 2.6, r: -HALF },
    { m: 'furniture/bookcaseClosedWide', x: 7.4, z: -2.6, r: -HALF },
    { m: 'furniture/bookcaseOpen', x: 7.4, z: -0.6, r: -HALF },
    { m: 'furniture/kitchenCoffeeMachine', x: 7.2, z: 2.2 },
    plant(-7.3, -5.3),
    plant(7.3, 4.0),
  ],
  manager: { x: 1.4, z: -1.8, r: 0.4 },
  people: {
    0: { x: 4.4, z: -3.4, r: PI, pose: 'sit' },
    1: { x: 6.2, z: -1.6, r: HALF },
    2: { x: -6.6, z: 0.0, r: -HALF },
  },
  spots: {
    A: { x: -1.8, z: -4.9 },
    B: { x: 4.4, z: -4.9 },
    C: { x: -3.8, z: 2.6 },
    reports: { x: -3.4, z: -5.9, y: 3.4 },
    registry: { x: -0.2, z: -5.9, y: 3.4 },
    shelves: { x: 7.4, z: -1.6 },
    coffee: { x: 7.2, z: 2.2 },
  },
};

const policyB: Layout = {
  props: [
    desk(3.0, -4.9), // 0
    { m: 'furniture/computerScreen', x: 3.0, z: -5.1, on: 0 },
    chair(3.0, -3.6),
    desk(5.9, -4.9), // 3
    { m: 'furniture/laptop', x: 5.9, z: -4.9, on: 3 },
    chair(5.9, -3.6),
    // Reading nook
    { m: 'furniture/rugRound', x: -5.4, z: 2.8, walk: true },
    { m: 'furniture/loungeChairRelax', x: -6.2, z: 3.4, r: 2.4 },
    { m: 'furniture/lampRoundFloor', x: -7.2, z: 1.8 },
    { m: 'furniture/bookcaseOpen', x: -7.4, z: -2.6, r: HALF },
    { m: 'furniture/bookcaseOpen', x: -7.4, z: -1.0, r: HALF },
    // Table for the one-page brief
    { m: 'furniture/table', x: -0.6, z: 2.6 }, // 11
    { m: 'furniture/laptop', x: -0.6, z: 2.6, on: 11 },
    { m: 'furniture/chair', x: -0.6, z: 4.0, r: PI },
    plant(7.3, -1.8),
    plant(-7.3, -5.3),
  ],
  manager: { x: 0.6, z: -1.8, r: 0.5 },
  people: {
    0: { x: 5.9, z: -3.4, r: PI, pose: 'sit' },
    2: { x: -5.2, z: 3.8, r: 2.0 },
  },
  spots: {
    A: { x: 3.0, z: -4.9 },
    B: { x: -2.6, z: -5.9, y: 3.3 },
    C: { x: -0.6, z: 2.6 },
    shelves: { x: -7.4, z: -1.8 },
    nook: { x: -6.2, z: 3.4 },
  },
};

const foundationA: Layout = {
  props: [
    // Long meeting table with the report
    { m: 'furniture/table', x: -1.8, z: 0.8, s: 1.3 }, // 0
    { m: 'furniture/books', x: -1.8, z: 0.8, on: 0 },
    { m: 'food/cup-tea', x: -0.8, z: 0.6, on: 0 },
    { m: 'furniture/chair', x: -3.4, z: 0.8, r: HALF },
    { m: 'furniture/chair', x: -1.8, z: 2.4, r: PI },
    { m: 'furniture/chair', x: -0.2, z: 0.8, r: -HALF },
    // Data desk
    desk(4.6, -4.9), // 6
    { m: 'furniture/computerScreen', x: 4.6, z: -5.1, on: 6 },
    chair(4.6, -3.6),
    // Interview corner
    { m: 'furniture/rugRounded', x: -5.4, z: 3.6, walk: true },
    { m: 'furniture/loungeChair', x: -6.6, z: 3.6, r: HALF },
    { m: 'furniture/loungeChair', x: -4.2, z: 3.6, r: -HALF },
    { m: 'furniture/sideTable', x: -5.4, z: 4.8 },
    { m: 'furniture/bookcaseClosedWide', x: 7.4, z: -1.2, r: -HALF },
    plant(-7.3, -5.3),
    plant(7.3, 2.4),
    plant(1.6, -5.4),
  ],
  manager: { x: 1.4, z: -1.8, r: 0.4 },
  people: {
    0: { x: -6.4, z: -1.6, r: -HALF },
    1: { x: 4.6, z: -3.4, r: PI, pose: 'sit' },
    2: { x: 6.2, z: -1.2, r: HALF },
  },
  spots: {
    A: { x: 4.6, z: -4.9 },
    B: { x: -5.4, z: 3.6 },
    C: { x: -1.8, z: 0.8 },
    board: { x: -1.6, z: -5.9, y: 3.4 },
    shelves: { x: 7.4, z: -1.2 },
  },
};

const foundationB: Layout = {
  props: [
    { m: 'furniture/bookcaseOpen', x: 5.4, z: -5.4 },
    { m: 'furniture/bookcaseOpen', x: 7.0, z: -5.4 },
    { m: 'furniture/bookcaseOpen', x: -7.4, z: -2.2, r: HALF },
    // Armchairs and tea
    { m: 'furniture/rugRound', x: -5.0, z: -2.0, walk: true },
    { m: 'furniture/loungeChairRelax', x: -5.4, z: -3.4, r: 0.4 },
    { m: 'furniture/tableCoffee', x: -4.6, z: -1.8 }, // 5
    { m: 'food/cup-tea', x: -4.6, z: -1.8, on: 5 },
    { m: 'furniture/lampRoundFloor', x: -7.2, z: -4.6 },
    // Grant records desk
    desk(2.6, -4.9), // 8
    { m: 'furniture/computerScreen', x: 2.6, z: -5.1, on: 8 },
    chair(2.6, -3.6),
    // Chairs being set out for the evening
    { m: 'furniture/chair', x: -3.0, z: 2.6, r: PI },
    { m: 'furniture/chair', x: -1.6, z: 2.6, r: PI },
    { m: 'furniture/chair', x: -0.2, z: 2.6, r: PI },
    { m: 'furniture/chair', x: -3.0, z: 4.0, r: PI },
    { m: 'furniture/chair', x: -1.6, z: 4.0, r: PI },
    { m: 'furniture/cardboardBoxOpen', x: 1.4, z: 3.4 },
    plant(7.3, 1.4),
  ],
  manager: { x: 0.6, z: -1.6, r: 0.5 },
  people: {
    0: { x: 0.2, z: 4.2, r: -2.6 },
    1: { x: 2.6, z: -3.4, r: PI, pose: 'sit' },
  },
  spots: {
    A: { x: 6.2, z: -5.4 },
    B: { x: 2.6, z: -4.9 },
    C: { x: -1.6, z: 3.2 },
    board: { x: -1.4, z: -5.9, y: 3.3 },
    tea: { x: -4.6, z: -1.8 },
  },
};

const workforceA: Layout = {
  props: [
    // Briefing table with the deck
    { m: 'furniture/table', x: -1.2, z: 0.8, s: 1.3 }, // 0
    { m: 'furniture/laptop', x: -1.8, z: 0.8, on: 0 },
    { m: 'furniture/books', x: -0.4, z: 0.8, on: 0 },
    { m: 'furniture/chairModernCushion', x: -2.8, z: 0.8, r: HALF },
    { m: 'furniture/chairModernCushion', x: 0.4, z: 0.8, r: -HALF },
    { m: 'furniture/chairModernCushion', x: -1.2, z: 2.4, r: PI },
    // Analyst's desk
    desk(4.6, -4.9), // 6
    { m: 'furniture/computerScreen', x: 4.2, z: -5.1, on: 6 },
    { m: 'furniture/computerScreen', x: 5.1, z: -5.1, on: 6 },
    chair(4.6, -3.6),
    // Reports shelf
    { m: 'furniture/bookcaseClosedWide', x: -7.4, z: -3.8, r: HALF },
    { m: 'furniture/bookcaseOpen', x: -7.4, z: -1.8, r: HALF },
    // Lounge
    { m: 'furniture/loungeDesignSofa', x: -5.6, z: 4.4 },
    { m: 'furniture/kitchenCoffeeMachine', x: 7.2, z: -1.0 },
    plant(7.3, 2.4),
    plant(-7.3, 2.0),
  ],
  manager: { x: 1.6, z: -1.8, r: 0.4 },
  people: {
    0: { x: -2.6, z: -2.0, r: 0.6 },
    1: { x: 4.6, z: -3.4, r: PI, pose: 'sit' },
    2: { x: -3.4, z: 3.8, r: -0.9 },
  },
  spots: {
    A: { x: -7.4, z: -2.8 },
    B: { x: 4.6, z: -4.9 },
    C: { x: -1.2, z: 0.8 },
    screen: { x: -1.0, z: -5.9, y: 3.4 },
    coffee: { x: 7.2, z: -1.0 },
  },
};

const ring = (cx: number, cz: number, n: number, rx: number, rz: number): Prop[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * PI * 2;
    return { m: 'furniture/chair', x: cx + Math.sin(a) * rx, z: cz + Math.cos(a) * rz, r: a + PI };
  });

const workforceB: Layout = {
  props: [
    ...ring(-1.0, 1.4, 6, 2.4, 2.0),
    { m: 'furniture/rugRound', x: -1.0, z: 1.4, walk: true },
    // Sign-up desk
    desk(-4.6, -4.9), // 7
    { m: 'furniture/laptop', x: -4.6, z: -4.9, on: 7 },
    chair(-4.6, -3.6),
    // Last year's notes
    { m: 'furniture/bookcaseOpen', x: 6.0, z: -5.4 },
    { m: 'furniture/cardboardBoxClosed', x: 7.2, z: -5.2 },
    { m: 'furniture/cardboardBoxOpen', x: 7.2, z: -4.0, r: 0.3 },
    plant(-7.3, 4.4),
    plant(7.3, 2.0),
  ],
  manager: { x: 1.8, z: -1.6, r: 0.4 },
  people: {
    1: { x: -6.6, z: 0.6, r: -HALF },
    2: { x: -4.6, z: -3.4, r: PI, pose: 'sit' },
  },
  spots: {
    A: { x: 1.4, z: -4.9, y: 2.4 },
    B: { x: -4.6, z: -4.9 },
    C: { x: 6.6, z: -5.0 },
    circle: { x: -1.0, z: 1.4 },
  },
};

export const LAYOUTS: Record<ScenarioId, [Layout, Layout]> = {
  resort: [resortA, resortB],
  policy: [policyA, policyB],
  foundation: [foundationA, foundationB],
  workforce: [workforceA, workforceB],
};

export const layoutFor = (id: ScenarioId, task: TaskIndex) => LAYOUTS[id][task];

/** Every model a room needs, so they can start loading during the walk to the door. */
export function modelsFor(id: ScenarioId, task: TaskIndex, look: string): string[] {
  const l = layoutFor(id, task);
  const cast = CAST[id];
  return [...new Set([...l.props.map((p) => p.m), `characters/${cast.manager}`, ...cast.colleagues.map((c) => `characters/${c}`), `characters/${look}`])];
}
