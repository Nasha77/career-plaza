import type { ScenarioId, TaskIndex } from '../../types';
import type { Pose } from './actor';
import { castFor, modelOf } from '../cast';

/**
 * Where everything goes in each room. Rooms are shaped like the work that happens in them
 * (an L-shaped office with a pantry nook, a wide mall floor, a library alcove...), built from
 * floor rectangles inside x -8..8, z -6..6. The back wall of the main space is at z = -5 and the
 * left wall at x = -7, where the task's boards hang. The camera looks in from the front, as in
 * Animal Crossing; front walls are left open.
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
  /** Height to stand at (things on a wall shelf). */
  y?: number;
  /** Rugs and mats can be walked over. */
  walk?: boolean;
}

export interface Placement {
  x: number;
  z: number;
  r: number;
  pose?: Pose;
}

/** Floor rectangle [x0, z0, x1, z1], whole units. */
export type Rect = [number, number, number, number];
/** A white glass partition from (x0, z0) to (x1, z1), straight along x or z. */
export type Partition = [number, number, number, number];

export interface Layout {
  floor: Rect[];
  partitions?: Partition[];
  /** Where the player comes in. */
  door: [number, number];
  props: Prop[];
  manager: Placement;
  /** Colleagues by their index in the content file. The one running task B is skipped. */
  people: Record<number, Placement>;
  /** Background people doing their own thing (their names and lines are in the content). */
  extras?: Placement[];
  /** Approach spots (A, B, C) and things to examine, by id. */
  spots: Record<string, { x: number; z: number; y?: number }>;
  /** Wall shelves on the back wall [x, y, width], and framed pictures [x, y, w, h, seed, wall]. */
  shelves?: [number, number, number][];
  frames?: [number, number, number, number, number, ('back' | 'left' | 'right')?][];
}

const PI = Math.PI;
const HALF = Math.PI / 2;

// Shorthands
const desk = (x: number, z: number, r = 0): Prop => ({ m: 'furniture/desk', x, z, r });
const chair = (x: number, z: number, r = PI): Prop => ({ m: 'furniture/chairDesk', x, z, r });
const plant = (x: number, z: number): Prop => ({ m: 'furniture/pottedPlant', x, z });
const onShelf = (m: string, x: number, y: number, s = 1): Prop => ({ m, x, z: -4.7, y: y + 0.06, s });

/** Resort, first role: a communications office in an L, with a pantry nook at the back right. */
const resortA: Layout = {
  floor: [
    [-7, -5, 4, 5],
    [4, -5, 7, 0],
  ],
  door: [-1, 4],
  props: [
    desk(-4.6, -4.2), // 0
    { m: 'furniture/laptop', x: -4.6, z: -4.2, on: 0 },
    chair(-4.6, -2.9),
    desk(-1.4, -4.2), // 3
    { m: 'furniture/computerScreen', x: -1.4, z: -4.4, on: 3 },
    { m: 'food/mug', x: -0.6, z: -4.1, on: 3 },
    chair(-1.4, -2.9),
    { m: 'furniture/trashcan', x: 0.5, z: -4.5 },
    // Pantry nook
    { m: 'furniture/kitchenCabinet', x: 4.6, z: -4.55 }, // 8
    { m: 'furniture/kitchenCabinet', x: 5.75, z: -4.55 }, // 9
    { m: 'furniture/kitchenCoffeeMachine', x: 4.6, z: -4.6, on: 8 },
    { m: 'food/cup-tea', x: 5.7, z: -4.5, on: 9 },
    { m: 'furniture/kitchenFridgeSmall', x: 6.5, z: -3.0, r: -HALF },
    { m: 'furniture/stoolBar', x: 5.2, z: -2.8 },
    { m: 'food/donut-sprinkles', x: 5.3, z: -4.5, on: 9 },
    // Lounge with last year's photo album
    { m: 'kaykit/rug_oval_A', s: 1.6, x: -3.8, z: 2.2, walk: true },
    { m: 'kaykit/couch_pillows', x: -6.1, z: 2.2, r: HALF },
    { m: 'kaykit/table_low', x: -3.8, z: 2.2 }, // 17
    { m: 'kaykit/book_set', x: -3.8, z: 2.2, on: 17 },
    { m: 'kaykit/armchair_pillows', x: -1.7, z: 2.2, r: -HALF },
    { m: 'kaykit/lamp_standing', x: -6.3, z: 4.2 },
    // Boxes of volunteer T-shirts by the door
    { m: 'furniture/cardboardBoxClosed', x: 2.6, z: 3.9 },
    { m: 'furniture/cardboardBoxOpen', x: 3.2, z: 2.9, r: 0.4 },
    { m: 'furniture/cardboardBoxClosed', x: 2.6, z: 3.9, on: 21, r: 0.3 },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: 3.4, z: -0.4, r: -HALF },
    { m: 'furniture/coatRackStanding', x: -6.4, z: -1.4 },
    plant(-6.4, -4.3),
    plant(3.4, -4.4),
    // On the wall shelf
    onShelf('furniture/plantSmall1', 1.9, 3.0),
    onShelf('furniture/books', 2.7, 3.0),
    onShelf('furniture/radio', 3.4, 3.0),
  ],
  shelves: [[2.6, 3.0, 2.4]],
  frames: [
    [5.6, 3.5, 1.0, 1.2, 1],
    [-5.0, 3.6, 0.9, 1.1, 0],
    [3.0, 3.2, 1.0, 1.2, 2, 'left'],
  ],
  manager: { x: 0.6, z: -1.8, r: 0.3 },
  people: {
    0: { x: 1.4, z: 2.8, r: 0.9 },
    1: { x: -4.6, z: -2.7, r: PI, pose: 'sit' },
    2: { x: 5.2, z: -3.4, r: PI },
  },
  extras: [{ x: -2.8, z: -0.4, r: 0.4 }, { x: -5.0, z: 4.0, r: 0.6 }],
  spots: {
    A: { x: -1.4, z: -4.2 },
    B: { x: -3.8, z: 2.2 },
    C: { x: -6.9, z: -2.6, y: 3 },
    poster: { x: -1.0, z: -4.9, y: 3.4 },
    boxes: { x: 2.8, z: 3.5 },
    coffee: { x: 4.6, z: -4.5, y: 1.6 },
    bookcase: { x: 3.4, z: -0.4 },
  },
};

/** Resort, second role: a wide mall-floor front with the marketing office behind it. */
const resortB: Layout = {
  floor: [
    [-7, -5, 7, -1],
    [-8, -1, 8, 5],
  ],
  door: [0, 4],
  props: [
    // Festive display, back right
    { m: 'holiday/tree-decorated', x: 5.7, z: -3.9 },
    { m: 'holiday/present-a-cube', x: 4.6, z: -3.5 },
    { m: 'holiday/present-b-round', x: 6.3, z: -2.4 },
    { m: 'holiday/present-a-rectangle', x: 4.9, z: -2.6, r: 0.5 },
    { m: 'holiday/lantern', x: 3.7, z: -4.4 },
    { m: 'holiday/snowman', x: 7.0, z: 3.6, r: -0.6 },
    { m: 'holiday/nutcracker', x: -7.2, z: 3.8, r: 0.6 },
    // Planning table on a rug
    { m: 'kaykit/rug_rectangle_stripes_A', s: 1.6, x: -2.2, z: 1.6, walk: true },
    { m: 'kaykit/table_medium_long', x: -2.2, z: 1.6 }, // 8
    { m: 'furniture/laptop', x: -2.6, z: 1.6, on: 8 },
    { m: 'food/cup-coffee', x: -1.4, z: 1.7, on: 8 },
    { m: 'kaykit/chair_A', x: -2.2, z: 3.0, r: PI },
    { m: 'kaykit/chair_A', x: -3.8, z: 1.6, r: HALF },
    { m: 'kaykit/chair_A', x: -0.6, z: 1.6, r: -HALF },
    // Desk with last year's numbers
    desk(1.4, -4.2), // 14
    { m: 'furniture/computerScreen', x: 1.4, z: -4.4, on: 14 },
    chair(1.4, -2.9),
    // Gift hamper samples
    { m: 'market/display-fruit', x: -6.6, z: 0.6 },
    { m: 'market/display-bread', x: -6.6, z: 2.2 },
    { m: 'furniture/cardboardBoxOpen', x: 6.4, z: 1.2 },
    plant(-6.4, -4.3),
    plant(-7.3, -0.2),
    plant(7.3, -0.2),
    onShelf('holiday/candy-cane-red', 3.9, 3.0),
    onShelf('holiday/gingerbread-man', 4.6, 3.0),
  ],
  shelves: [[4.3, 3.0, 2.0]],
  frames: [[-4.6, 3.6, 0.9, 1.1, 3]],
  manager: { x: 0.4, z: -1.8, r: 0.3 },
  people: {
    1: { x: 3.8, z: -1.6, r: -2.3 },
    2: { x: 1.4, z: -2.7, r: PI, pose: 'sit' },
  },
  extras: [{ x: -5.4, z: -2.6, r: 0.8 }, { x: 5.6, z: 2.8, r: -1.2 }],
  spots: {
    A: { x: 1.4, z: -4.2 },
    B: { x: -2.2, z: 1.6 },
    C: { x: 5.3, z: -3.2 },
    board: { x: -1.2, z: -4.9, y: 3.4 },
    banner: { x: -6.6, z: -4.6, y: 1.6 },
    hamper: { x: -6.6, z: 1.4 },
  },
};

/** Policy, first role: an open office with cubicle dividers and a glass-walled meeting room. */
const policyA: Layout = {
  floor: [[-7, -5, 7, 4]],
  partitions: [
    [-7, 0.6, -3.4, 0.6],
    [-1.9, 0.6, -1.9, 2.6],
    [1.2, -5, 1.2, -3.0],
  ],
  door: [1, 3.4],
  props: [
    desk(-1.6, -4.2), // 0
    { m: 'furniture/computerScreen', x: -2.2, z: -4.4, on: 0 },
    { m: 'furniture/computerScreen', x: -1.0, z: -4.4, on: 0 },
    chair(-1.6, -2.9),
    desk(3.6, -4.2), // 4
    { m: 'furniture/computerScreen', x: 3.6, z: -4.4, on: 4 },
    { m: 'food/mug', x: 4.4, z: -4.1, on: 4 },
    chair(3.6, -2.9),
    { m: 'furniture/sideTable', x: 6.2, z: -4.4 }, // 8
    { m: 'furniture/kitchenCoffeeMachine', x: 6.2, z: -4.4, on: 8 },
    // Meeting room
    { m: 'kaykit/table_round_A', s: 0.85, x: -4.6, z: 2.4 }, // 10
    { m: 'kaykit/book_set', x: -4.6, z: 2.4, on: 10 },
    { m: 'kaykit/chair_A', x: -6.0, z: 2.4, r: HALF },
    { m: 'kaykit/chair_A', x: -3.2, z: 2.4, r: -HALF },
    { m: 'kaykit/chair_A', x: -4.6, z: 3.6, r: PI },
    { m: 'kaykit/rug_rectangle_stripes_A', s: 1.6, x: -4.6, z: 2.4, walk: true },
    // Reports along the right wall
    { m: 'kaykit/cabinet_medium_decorated', x: 6.4, z: -2.4, r: -HALF },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: 6.4, z: 2.8, r: -HALF },
    { m: 'furniture/trashcan', x: 0.2, z: -4.5 },
    plant(-6.4, -4.3),
    plant(-6.4, 0.0),
    onShelf('furniture/books', -5.4, 3.0),
    onShelf('furniture/plantSmall2', -4.6, 3.0),
  ],
  shelves: [[-5.0, 3.0, 2.0]],
  frames: [
    [4.6, 3.6, 1.0, 1.2, 2],
    [-3.0, 3.2, 1.0, 1.2, 1, 'left'],
  ],
  manager: { x: 0.8, z: -1.6, r: 0.3 },
  people: {
    0: { x: 3.6, z: -2.7, r: PI, pose: 'sit' },
    1: { x: 5.2, z: -0.6, r: HALF },
    2: { x: -5.4, z: -2.6, r: 0.6 },
  },
  extras: [{ x: -6.2, z: 1.6, r: HALF }, { x: 4.8, z: 1.4, r: -HALF }],
  spots: {
    A: { x: -1.6, z: -4.2 },
    B: { x: 3.6, z: -4.2 },
    C: { x: -4.6, z: 2.4 },
    reports: { x: -3.4, z: -4.9, y: 3.4 },
    registry: { x: -0.2, z: -4.9, y: 3.4 },
    shelves: { x: 6.4, z: -2.4 },
    coffee: { x: 6.2, z: -4.4, y: 1.6 },
  },
};

/** Policy, second role: a quiet research corner with a library alcove off to the left. */
const policyB: Layout = {
  floor: [
    [-5, -5, 7, 5],
    [-8, -5, -5, 1],
  ],
  door: [1, 4],
  props: [
    desk(3.2, -4.2), // 0
    { m: 'furniture/computerScreen', x: 3.2, z: -4.4, on: 0 },
    { m: 'furniture/laptop', x: 2.3, z: -4.1, on: 0 },
    chair(3.2, -2.9),
    { m: 'furniture/sideTable', x: 6.2, z: -4.4 }, // 4
    { m: 'food/mug', x: 6.2, z: -4.4, on: 4 },
    // Library alcove
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: -7.4, z: -3.6, r: HALF },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: -7.4, z: -1.8, r: HALF },
    { m: 'kaykit/rug_oval_B', s: 1.4, x: -6.4, z: -0.6, walk: true },
    { m: 'kaykit/armchair', x: -6.6, z: -0.2, r: 2.4 },
    { m: 'kaykit/lamp_standing', x: -7.4, z: 0.4 },
    // Table for the one-page brief
    { m: 'kaykit/table_medium_long', x: 0.6, z: 1.8 }, // 11
    { m: 'furniture/laptop', x: 0.6, z: 1.8, on: 11 },
    { m: 'kaykit/chair_A', x: 0.6, z: 3.2, r: PI },
    { m: 'kaykit/chair_A', x: -1.0, z: 1.8, r: HALF },
    { m: 'kaykit/couch_pillows', x: 6.1, z: 2.2, r: -HALF },
    plant(6.4, -1.6),
    plant(-4.4, 4.3),
    onShelf('furniture/books', -3.4, 3.0),
    onShelf('furniture/plantSmall3', -2.6, 3.0),
  ],
  shelves: [[0.8, 3.6, 1.8]],
  frames: [[5.4, 3.6, 1.0, 1.2, 0]],
  manager: { x: 0.4, z: -1.6, r: 0.3 },
  people: {
    0: { x: 3.2, z: -2.7, r: PI, pose: 'sit' },
    2: { x: -5.6, z: -2.6, r: -HALF },
  },
  extras: [{ x: 4.4, z: 3.8, r: -0.8 }, { x: -3.6, z: -3.4, r: PI }],
  spots: {
    A: { x: 3.2, z: -4.2 },
    B: { x: -2.6, z: -4.9, y: 3.3 },
    C: { x: 0.6, z: 1.8 },
    shelves: { x: -7.4, z: -2.7 },
    nook: { x: -6.6, z: -0.2 },
  },
};

/** Foundation, first role: a meeting room, with an interview corner behind a glass partition. */
const foundationA: Layout = {
  floor: [[-7, -5, 7, 5]],
  partitions: [[-7, 1.6, -3.2, 1.6]],
  door: [1.5, 4],
  props: [
    // Long meeting table with the report
    { m: 'kaykit/rug_rectangle_stripes_A', s: 1.6, x: -0.8, z: -0.6, walk: true },
    { m: 'kaykit/table_medium_long', x: -0.8, z: -0.6, s: 1.15 }, // 1
    { m: 'kaykit/book_set', x: -1.2, z: -0.6, on: 1 },
    { m: 'food/cup-tea', x: 0.2, z: -0.7, on: 1 },
    { m: 'kaykit/chair_A', x: -2.6, z: -0.6, r: HALF },
    { m: 'kaykit/chair_A', x: -0.8, z: 1.0, r: PI },
    { m: 'kaykit/chair_A', x: 1.0, z: -0.6, r: -HALF },
    // Data desk
    desk(4.2, -4.2), // 7
    { m: 'furniture/computerScreen', x: 4.2, z: -4.4, on: 7 },
    chair(4.2, -2.9),
    // Interview corner
    { m: 'kaykit/rug_oval_A', s: 1.6, x: -5.0, z: 3.4, walk: true },
    { m: 'kaykit/armchair_pillows', x: -6.2, z: 3.4, r: HALF },
    { m: 'kaykit/armchair_pillows', x: -3.8, z: 3.4, r: -HALF },
    { m: 'furniture/sideTable', x: -5.0, z: 4.5 }, // 13
    { m: 'food/cup-tea', x: -5.0, z: 4.5, on: 13 },
    { m: 'kaykit/cabinet_medium_decorated', x: 6.4, z: -2.4, r: -HALF },
    { m: 'furniture/kitchenCabinet', x: 6.4, z: 3.4, r: -HALF }, // 16
    { m: 'furniture/kitchenCoffeeMachine', x: 6.4, z: 3.4, r: -HALF, on: 16 },
    plant(-6.4, -0.4),
    plant(2.2, -4.4),
    onShelf('furniture/plantSmall1', 3.6, 3.6),
    onShelf('furniture/books', 4.4, 3.6),
    onShelf('food/cookie', 5.0, 3.6),
  ],
  shelves: [[4.3, 3.6, 2.2]],
  frames: [
    [-5.4, 3.5, 1.0, 1.2, 3],
    [3.4, 3.3, 1.0, 1.2, 1, 'right'],
  ],
  manager: { x: 1.4, z: -2.0, r: 0.3 },
  people: {
    0: { x: -5.4, z: -2.0, r: 0.8 },
    1: { x: 4.2, z: -2.7, r: PI, pose: 'sit' },
    2: { x: 5.2, z: -0.6, r: HALF },
  },
  extras: [{ x: 2.6, z: 1.8, r: -0.8 }, { x: 5.0, z: 2.0, r: -HALF }],
  spots: {
    A: { x: 4.2, z: -4.2 },
    B: { x: -5.0, z: 3.4 },
    C: { x: -0.8, z: -0.6 },
    board: { x: -1.6, z: -4.9, y: 3.4 },
    shelves: { x: 6.4, z: -2.4 },
  },
};

/** Foundation, second role: a cosy L-shaped library corner, with chairs set out for an evening. */
const foundationB: Layout = {
  floor: [
    [-7, -5, 7, 1],
    [-7, 1, 3, 5],
  ],
  door: [-1, 4],
  props: [
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: 4.6, z: -4.5 },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: 6.1, z: -4.5 },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: 6.4, z: -1.8, r: -HALF },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: -6.4, z: -2.6, r: HALF },
    // Armchair and tea
    { m: 'kaykit/rug_oval_B', s: 1.4, x: -4.4, z: -1.8, walk: true },
    { m: 'kaykit/armchair', x: -4.8, z: -3.2, r: 0.4 },
    { m: 'kaykit/table_low', x: -3.8, z: -1.4 }, // 6
    { m: 'food/cup-tea', x: -3.8, z: -1.4, on: 6 },
    { m: 'kaykit/lamp_standing', x: -6.2, z: -4.3 },
    // Grant records desk
    desk(1.6, -4.2), // 9
    { m: 'furniture/computerScreen', x: 1.6, z: -4.4, on: 9 },
    chair(1.6, -2.9),
    // Chairs set out for the evening, facing a small table
    { m: 'kaykit/chair_A', x: -3.4, z: 2.0, r: PI },
    { m: 'kaykit/chair_A', x: -2.0, z: 2.0, r: PI },
    { m: 'kaykit/chair_A', x: -0.6, z: 2.0, r: PI },
    { m: 'kaykit/chair_A', x: -3.4, z: 3.4, r: PI },
    { m: 'kaykit/chair_A', x: -2.0, z: 3.4, r: PI },
    { m: 'furniture/cardboardBoxOpen', x: 1.6, z: 3.8 },
    { m: 'kaykit/couch_pillows', x: 6.1, z: 0.0, r: -HALF },
    plant(-6.4, 4.3),
    plant(2.4, 0.6),
    onShelf('furniture/plantSmall2', -0.4, 3.6),
    onShelf('food/mug', 0.4, 3.6),
  ],
  shelves: [[0.0, 3.6, 1.8]],
  frames: [
    [-5.0, 3.6, 0.9, 1.1, 0],
    [-3.6, 3.1, 1.0, 1.2, 1, 'left'],
  ],
  manager: { x: 0.4, z: -1.6, r: 0.3 },
  people: {
    0: { x: 0.8, z: 3.2, r: -2.4 },
    1: { x: 1.6, z: -2.7, r: PI, pose: 'sit' },
  },
  extras: [{ x: -2.4, z: -0.4, r: -0.6 }, { x: 4.4, z: -2.6, r: PI }],
  spots: {
    A: { x: 5.3, z: -4.5 },
    B: { x: 1.6, z: -4.2 },
    C: { x: -2.0, z: 2.7 },
    board: { x: -1.4, z: -4.9, y: 3.3 },
    tea: { x: -3.8, z: -1.4 },
  },
};

/** Workforce, first role: a wide briefing room, with the analyst's desk behind glass on the right. */
const workforceA: Layout = {
  floor: [[-8, -5, 8, 4]],
  partitions: [[2.6, -5, 2.6, -1.4]],
  door: [0, 3.4],
  props: [
    // Briefing table with the deck
    { m: 'kaykit/rug_rectangle_stripes_A', s: 1.6, x: -1.2, z: 0.6, walk: true },
    { m: 'kaykit/table_medium_long', x: -1.2, z: 0.6, s: 1.15 }, // 1
    { m: 'furniture/laptop', x: -1.8, z: 0.6, on: 1 },
    { m: 'kaykit/book_set', x: -0.4, z: 0.6, on: 1 },
    { m: 'kaykit/chair_B', x: -3.0, z: 0.6, r: HALF },
    { m: 'kaykit/chair_B', x: 0.6, z: 0.6, r: -HALF },
    { m: 'kaykit/chair_B', x: -1.2, z: 2.2, r: PI },
    // Analyst's desk behind the glass
    desk(5.0, -4.2), // 7
    { m: 'furniture/computerScreen', x: 4.5, z: -4.4, on: 7 },
    { m: 'furniture/computerScreen', x: 5.5, z: -4.4, on: 7 },
    chair(5.0, -2.9),
    { m: 'furniture/trashcan', x: 7.2, z: -4.4 },
    // Reports shelf
    { m: 'kaykit/cabinet_medium_decorated', x: -7.4, z: -3.4, r: HALF },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: -7.4, z: -1.7, r: HALF },
    // Lounge corner
    { m: 'kaykit/couch', x: -6.2, z: 3.0 },
    { m: 'furniture/sideTable', x: 6.8, z: 2.6 }, // 15
    { m: 'furniture/kitchenCoffeeMachine', x: 6.8, z: 2.6, on: 15 },
    plant(7.3, -0.6),
    plant(-4.6, -4.4),
    onShelf('furniture/books', 3.6, 3.6),
    onShelf('furniture/plantSmall1', 4.4, 3.6),
  ],
  shelves: [[4.4, 3.6, 2.0]],
  frames: [[6.6, 3.6, 0.9, 1.1, 2]],
  manager: { x: 0.6, z: -2.8, r: 0.3 },
  people: {
    0: { x: -3.4, z: -2.6, r: 0.6 },
    1: { x: 5.0, z: -2.7, r: PI, pose: 'sit' },
    2: { x: -3.8, z: 3.2, r: -0.9 },
  },
  extras: [{ x: -6.0, z: -0.2, r: -HALF }, { x: 6.0, z: 1.2, r: 0.3 }],
  spots: {
    A: { x: -7.4, z: -2.6 },
    B: { x: 5.0, z: -4.2 },
    C: { x: -1.2, z: 0.6 },
    screen: { x: -1.0, z: -4.9, y: 3.4 },
    coffee: { x: 6.8, z: 2.6, y: 1.6 },
  },
};

const ring = (cx: number, cz: number, n: number, rx: number, rz: number): Prop[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * PI * 2;
    return { m: 'kaykit/chair_A', x: cx + Math.sin(a) * rx, z: cz + Math.cos(a) * rz, r: a + PI };
  });

/** Workforce, second role: a focus-group room you reach through a short entry hall. */
const workforceB: Layout = {
  floor: [
    [-6, -5, 6, 3],
    [-2, 3, 2, 6],
  ],
  door: [0, 4.8],
  props: [
    { m: 'kaykit/rug_oval_B', s: 1.4, x: -0.4, z: 0.4, walk: true },
    ...ring(-0.4, 0.4, 6, 2.4, 1.9),
    // Sign-up desk
    desk(-3.8, -4.2), // 8
    { m: 'furniture/laptop', x: -3.8, z: -4.2, on: 8 },
    chair(-3.8, -2.9),
    // Last year's notes
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: 4.4, z: -4.5 },
    { m: 'furniture/cardboardBoxClosed', x: 5.4, z: -3.0 },
    { m: 'furniture/cardboardBoxOpen', x: 5.2, z: -1.8, r: 0.3 },
    // Water and snacks for the participants
    { m: 'furniture/sideTable', x: 5.2, z: 2.2 }, // 14
    { m: 'food/cup-coffee', x: 5.0, z: 2.2, on: 14 },
    { m: 'food/cookie', x: 5.4, z: 2.2, on: 14 },
    { m: 'furniture/coatRackStanding', x: -1.4, z: 5.2 },
    plant(-5.4, 2.4),
    plant(1.4, 5.4),
  ],
  frames: [
    [-1.6, 3.6, 0.9, 1.1, 1],
    [-1.0, 3.2, 1.0, 1.2, 3, 'left'],
  ],
  manager: { x: 1.8, z: -2.0, r: 0.3 },
  people: {
    1: { x: -4.4, z: 0.6, r: HALF },
    2: { x: -3.8, z: -2.7, r: PI, pose: 'sit' },
  },
  extras: [{ x: 4.0, z: 1.8, r: HALF }, { x: 3.2, z: -3.0, r: PI }],
  spots: {
    A: { x: 1.4, z: -4.6, y: 2.4 },
    B: { x: -3.8, z: -4.2 },
    C: { x: 4.4, z: -4.4 },
    circle: { x: -0.4, z: 0.4 },
  },
};

/** How much bigger the rooms are than the layouts above are written. */
export const ROOM_SCALE = 1.5;

/** Furniture that other things gather around (a chair at a desk, a lamp by a sofa). */
const ANCHOR = /desk|table|sofa|Sofa|couch|bookcase|cabinet|kitchen|display|tree-decorated|stall/;

/**
 * Spread a layout out to the bigger room. Floors, walls and wall-mounted things scale; each
 * piece of furniture moves out but keeps its size, and whatever belongs with it (a chair at a
 * desk, a laptop on a table, someone at their work) keeps its place beside it. People who were
 * seated stand at their desk instead, and their chair goes.
 */
function spread(l: Layout, k = ROOM_SCALE): Layout {
  const anchors = l.props.filter((p) => p.on === undefined && p.y === undefined && !p.walk && ANCHOR.test(p.m));
  const near = (x: number, z: number): Prop | null => {
    let best: Prop | null = null;
    let bd = 2.4;
    for (const a of anchors) {
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  };
  const follow = (x: number, z: number, around: Prop | null): [number, number] =>
    around ? [around.x * k + (x - around.x), around.z * k + (z - around.z)] : [x * k, z * k];

  // Seated people stand instead; drop the chair they were sitting on.
  const seated = [l.manager, ...Object.values(l.people), ...(l.extras ?? [])].filter((p) => p.pose === 'sit');
  const dropped = new Set<number>();
  seated.forEach((s) => {
    const i = l.props.findIndex((p, j) => !dropped.has(j) && /chair/i.test(p.m) && Math.hypot(p.x - s.x, p.z - s.z) < 0.9);
    if (i >= 0) dropped.add(i);
  });
  const stand = (p: Placement): Placement => {
    const [x, z] = follow(p.x, p.z, near(p.x, p.z));
    return { ...p, x, z, pose: 'idle' };
  };

  const moved: Prop[] = [];
  const newIndex = new Map<number, number>();
  l.props.forEach((p, i) => {
    if (dropped.has(i)) return;
    let x: number;
    let z: number;
    if (p.on !== undefined) {
      const parent = l.props[p.on];
      [x, z] = follow(p.x, p.z, parent);
    } else if (p.y !== undefined || p.walk || anchors.includes(p)) {
      [x, z] = [p.x * k, p.z * k];
    } else {
      [x, z] = follow(p.x, p.z, near(p.x, p.z));
    }
    newIndex.set(i, moved.length);
    moved.push({ ...p, x, z });
  });
  moved.forEach((p) => {
    if (p.on !== undefined) p.on = newIndex.get(p.on);
  });

  const spots: Layout['spots'] = {};
  for (const [key, sp] of Object.entries(l.spots)) {
    const [x, z] = sp.y !== undefined ? [sp.x * k, sp.z * k] : follow(sp.x, sp.z, near(sp.x, sp.z));
    spots[key] = { ...sp, x, z };
  }
  const people: Layout['people'] = {};
  for (const [i, p] of Object.entries(l.people)) people[Number(i)] = stand(p);
  return {
    ...l,
    floor: l.floor.map(([a, b, c, d]) => [a * k, b * k, c * k, d * k] as Rect),
    partitions: l.partitions?.map(([a, b, c, d]) => [a * k, b * k, c * k, d * k] as Partition),
    door: [l.door[0] * k, l.door[1] * k],
    props: moved,
    manager: stand(l.manager),
    people,
    extras: l.extras?.map(stand),
    spots,
    shelves: l.shelves?.map(([x, y, w]) => [x * k, y, w] as [number, number, number]),
    frames: l.frames?.map(([x, y, w, h, seed, wall]) => [x * k, y, w, h, seed, wall] as NonNullable<Layout['frames']>[number]),
  };
}

export const LAYOUTS: Record<ScenarioId, [Layout, Layout]> = {
  resort: [spread(resortA), spread(resortB)],
  policy: [spread(policyA), spread(policyB)],
  foundation: [spread(foundationA), spread(foundationB)],
  workforce: [spread(workforceA), spread(workforceB)],
};

export const layoutFor = (id: ScenarioId, task: TaskIndex) => LAYOUTS[id][task];

/** Every model a room needs, so they can start loading during the walk to the door. */
export function modelsFor(id: ScenarioId, task: TaskIndex, look: string): string[] {
  const l = layoutFor(id, task);
  const cast = castFor(look).rooms[id];
  const people = [cast.manager, ...cast.colleagues, look].map((c) => `characters/${modelOf(c)}`);
  return [...new Set([...l.props.map((p) => p.m), ...people])];
}

/** Whether a floor point is inside the room's floor rectangles. */
export function onFloor(l: Layout, x: number, z: number): boolean {
  return l.floor.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
}

/**
 * The reception lobby every building opens into: a front desk with the receptionist, the
 * company's sign behind them, a waiting area, and a doorway through to the offices.
 */
const lobby: Layout = {
  floor: [[-6, -5, 6, 4]],
  door: [0, 3.4],
  props: [
    // The front desk: two desks joined into one long counter; the screen sits to one side so the
    // receptionist is in view
    desk(-0.75, -2.4, Math.PI), // 0
    desk(1.14, -2.4, Math.PI), // 1 (edge to edge with the first, without overlapping)
    { m: 'furniture/computerScreen', x: 1.2, z: -2.3, r: Math.PI, on: 1 },
    { m: 'furniture/plantSmall1', x: 1.8, z: -2.4, on: 1 },
    { m: 'food/mug', x: -0.2, z: -2.3, on: 0 },
    // Waiting area on the left
    { m: 'kaykit/rug_oval_A', s: 1.6, x: -3.8, z: 1.4, walk: true },
    { m: 'kaykit/couch_pillows', x: -5.4, z: 1.4, r: HALF },
    { m: 'kaykit/table_low', x: -3.6, z: 1.4 }, // 7
    { m: 'kaykit/book_set', x: -3.6, z: 1.4, on: 7 },
    { m: 'kaykit/armchair_pillows', x: -3.6, z: 3.0, r: Math.PI },
    // Water and leaflets on the right
    { m: 'furniture/kitchenFridgeSmall', x: 5.2, z: -0.4, r: -HALF },
    { m: 'kaykit/cabinet_medium_decorated', s: 0.8, x: 5.3, z: 1.6, r: -HALF },
    { m: 'furniture/coatRackStanding', x: 4.9, z: 3.6 },
    plant(-5.4, -4.3),
    plant(5.4, -4.3),
    plant(-1.6, 3.6),
  ],
  frames: [
    [-4.4, 3.4, 1.0, 1.2, 1],
    [1.2, 3.2, 1.0, 1.2, 2, 'left'],
  ],
  manager: { x: -0.75, z: -3.7, r: 0 },
  people: {},
  spots: {
    sign: { x: -0.2, z: -4.9, y: 3.6 },
  },
};

export const LOBBY: Layout = spread(lobby);

/** The models a lobby needs (to start loading early). */
export function lobbyModels(look: string, id: ScenarioId): string[] {
  const cast = castFor(look).rooms[id];
  return [...new Set([...LOBBY.props.map((p) => p.m), `characters/${modelOf(cast.reception)}`, `characters/${modelOf(look)}`])];
}
