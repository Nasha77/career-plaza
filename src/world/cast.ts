import type { ScenarioId } from '../types';

/**
 * Who looks like whom. There are 12 Kenney Mini Characters; each also comes in recoloured
 * versions (hair and clothes swapped, skin kept), so every person in the game has their own look.
 * The model the player picked is never given to anyone else, in any colour.
 *
 * A look is "<model>" or "<model>#<variant>", for example "character-male-a#2".
 */

export const MODELS = [
  'character-female-a',
  'character-female-b',
  'character-female-c',
  'character-female-d',
  'character-female-e',
  'character-female-f',
  'character-male-a',
  'character-male-b',
  'character-male-c',
  'character-male-d',
  'character-male-e',
  'character-male-f',
] as const;

/** The characters a player can pick on the title screen (original colours). */
export const PLAYER_LOOKS = [
  'character-female-f',
  'character-male-f',
  'character-female-b',
  'character-male-a',
  'character-female-c',
  'character-male-d',
  'character-female-a',
  'character-male-e',
];

export const VARIANTS = 3;

export const modelOf = (look: string) => look.split('#')[0];
export const variantOf = (look: string) => Number(look.split('#')[1] ?? 0);

/** Preferred models for each building's people, in order: first-task manager, then colleagues. */
const PREFERRED: Record<ScenarioId, string[]> = {
  resort: ['character-female-a', 'character-female-f', 'character-male-f', 'character-female-b'],
  policy: ['character-male-d', 'character-female-c', 'character-male-a', 'character-female-e'],
  foundation: ['character-female-d', 'character-male-c', 'character-female-b', 'character-female-a'],
  workforce: ['character-male-b', 'character-female-e', 'character-male-e', 'character-female-c'],
};
const BUILDINGS: ScenarioId[] = ['resort', 'policy', 'foundation', 'workforce'];
/** The plaza guide, then the people strolling on the plaza. */
const PLAZA_PREFERRED = ['character-male-c', 'character-female-e', 'character-male-e', 'character-female-c', 'character-male-a'];

export interface Cast {
  rooms: Record<ScenarioId, { manager: string; colleagues: string[] }>;
  /** The guide first, then the passers-by. */
  plaza: string[];
}

const cache = new Map<string, Cast>();

/** Give everyone a different look, never using the player's model. Same answer every time. */
export function castFor(playerLook: string): Cast {
  const hit = cache.get(playerLook);
  if (hit) return hit;
  const banned = modelOf(playerLook);
  const used = new Set<string>();
  const take = (preferred: string): string => {
    const models = [preferred, ...MODELS.filter((m) => m !== preferred)].filter((m) => m !== banned);
    for (let v = 0; v < VARIANTS; v++)
      for (const m of models) {
        const look = v ? `${m}#${v}` : m;
        if (!used.has(look)) {
          used.add(look);
          return look;
        }
      }
    throw new Error('Ran out of character looks');
  };
  const rooms = {} as Cast['rooms'];
  for (const id of BUILDINGS) {
    const [manager, ...colleagues] = PREFERRED[id].map(take);
    rooms[id] = { manager, colleagues };
  }
  const plaza = PLAZA_PREFERRED.map(take);
  const cast = { rooms, plaza };
  cache.set(playerLook, cast);
  return cast;
}

// ---- Recolouring ---------------------------------------------------------------------------
//
// The colormap is a grid of colour swatches. Hair and clothes use the bright swatches; skin uses
// the three swatches at the bottom right (and the cream one), which are never touched.
// A variant swaps the warm swatches among themselves (orange, red, yellow) and the cool ones
// among themselves (green, blue, light blue, purple, pink), so hair stays a plausible colour.

/** Top-left corners of the swatch blocks in the 512 px colormap; each block is 64 x 128. */
const WARM: [number, number][] = [
  [192, 256],
  [256, 256],
  [128, 256],
];
const COOL: [number, number][] = [
  [64, 256],
  [320, 256],
  [384, 256],
  [448, 256],
  [0, 128],
];

/** Which source block each block takes its colours from in a variant. */
function mapping(variant: number): Map<string, [number, number]> {
  const m = new Map<string, [number, number]>();
  const rotate = (group: [number, number][], by: number) =>
    group.forEach((b, i) => m.set(b.join(','), group[(i + by) % group.length]));
  rotate(WARM, variant);
  rotate(COOL, variant * 2);
  return m;
}

/** A recoloured copy of the colormap, as a canvas. */
export function recolourMap(img: CanvasImageSource & { width: number; height: number }, variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  if (!variant) return c;
  const k = img.width / 512;
  for (const [to, from] of mapping(variant)) {
    const [tx, ty] = to.split(',').map(Number);
    ctx.drawImage(img, from[0] * k, from[1] * k, 64 * k, 128 * k, tx * k, ty * k, 64 * k, 128 * k);
  }
  return c;
}

// Portraits: the small preview pictures are shaded renders, so instead of copying swatches,
// shift the hue of bright pixels to match the swap (skin-coloured pixels are left alone).

const rgb2hsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hsl2rgb = (h: number, s: number, l: number): [number, number, number] => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
};

/** Average hue of each swatch block, read from the colormap once. */
let swatchHues: Map<string, number> | null = null;
export function learnSwatches(img: CanvasImageSource & { width: number; height: number }) {
  if (swatchHues) return;
  const c = recolourMap(img, 0);
  const ctx = c.getContext('2d')!;
  const k = img.width / 512;
  swatchHues = new Map();
  for (const b of [...WARM, ...COOL]) {
    const [r, g, bl] = ctx.getImageData((b[0] + 16) * k, (b[1] + 40) * k, 1, 1).data;
    swatchHues.set(b.join(','), rgb2hsl(r, g, bl)[0]);
  }
}

const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Recolour a portrait image to match a variant. Returns a data URL. */
export function recolourPortrait(img: HTMLImageElement, variant: number): string {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  if (!variant || !swatchHues) return c.toDataURL();
  const hues = swatchHues;
  const shifts = [...mapping(variant)].map(([to, from]) => ({ from: hues.get(to)!, to: hues.get(from.join(','))! }));
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] < 10) continue;
    const [h, s, l] = rgb2hsl(p[i], p[i + 1], p[i + 2]);
    // Leave skin (soft oranges and browns) and greys alone.
    if (s < 0.4 || (h > 10 && h < 45 && s < 0.75 && l > 0.45)) continue;
    let best = shifts[0];
    for (const sh of shifts) if (hueDist(h, sh.from) < hueDist(h, best.from)) best = sh;
    if (hueDist(h, best.from) > 30) continue;
    const [r, g, b] = hsl2rgb((h + best.to - best.from + 360) % 360, s, l);
    p[i] = r;
    p[i + 1] = g;
    p[i + 2] = b;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL();
}
