import * as THREE from 'three';
import type { ScenarioId, TaskIndex } from '../../types';
import { DISPLAY_FONT, FONT, roundRect, type Kit } from './kit';
import type { Partition, Rect } from './layouts';

/**
 * The room shell (floor, two walls, a window) and the canvas-drawn boards on the walls:
 * the posters, screens and pinboards that show what each task is about. No image files.
 */

export const ROOM_W = 14;
export const ROOM_D = 10;
export const BACK_Z = -ROOM_D / 2;
export const LEFT_X = -ROOM_W / 2;
export const RIGHT_X = ROOM_W / 2;
const WALL_H = 5.4;

interface RoomColors {
  floor: number;
  /** Upper wall, and the panelled lower part of the wall (wainscoting). */
  back: number;
  left: number;
  panel: number;
  trim: number;
}

const COLORS: Record<ScenarioId, RoomColors> = {
  resort: { floor: 0xc9a77e, back: 0xf2e6cf, left: 0xeadcc0, panel: 0x7fb3a3, trim: 0xf7f0e2 },
  policy: { floor: 0xa98a66, back: 0xdfe6dc, left: 0xd4ddd2, panel: 0x6f8c74, trim: 0xf1ede2 },
  foundation: { floor: 0xb98f68, back: 0xf4e1cf, left: 0xebd5c0, panel: 0xb7705f, trim: 0xf8efe3 },
  workforce: { floor: 0xb7a58c, back: 0xe2e7ea, left: 0xd6dde1, panel: 0x5f7c8c, trim: 0xf1f1ec },
};

type FloorStyle = 'carpet' | 'planks' | 'tiles';
const FLOORS: Record<ScenarioId, FloorStyle> = { resort: 'planks', policy: 'planks', foundation: 'planks', workforce: 'tiles' };

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function plane(kit: Kit, tex: THREE.Texture, w: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(kit.geo('plane', () => new THREE.PlaneGeometry(1, 1)), kit.track(new THREE.MeshBasicMaterial({ map: tex })));
  m.scale.set(w, h, 1);
  return m;
}

/** Floor surface drawn in code: planks, tiles or carpet, plus a patch of window light. */
function floorTexture(kit: Kit, style: FloorStyle, base: number) {
  return kit.canvasTexture(1024, 768, (ctx, w, h) => {
    const c = new THREE.Color(base);
    const shade = (k: number) => `#${c.clone().multiplyScalar(k).getHexString()}`;
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, w, h);
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    if (style === 'planks') {
      const pw = 48;
      for (let y = 0, row = 0; y < h; y += pw, row++) {
        for (let x = -((row * 173) % 260); x < w; x += 260) {
          ctx.fillStyle = shade(0.9 + rnd() * 0.18);
          ctx.fillRect(x + 2, y + 2, 256, pw - 4);
        }
      }
    } else if (style === 'tiles') {
      const t = 72;
      for (let y = 0; y < h; y += t)
        for (let x = 0; x < w; x += t) {
          ctx.fillStyle = shade(0.94 + rnd() * 0.1);
          ctx.fillRect(x + 3, y + 3, t - 6, t - 6);
        }
    } else {
      for (let i = 0; i < 12000; i++) {
        ctx.fillStyle = shade(0.86 + rnd() * 0.2);
        ctx.fillRect(rnd() * w, rnd() * h, 3, 3);
      }
      ctx.strokeStyle = shade(0.8);
      ctx.lineWidth = 8;
      ctx.strokeRect(50, 50, w - 100, h - 100);
    }
    // Soft light falling in through the side window
    const g = ctx.createLinearGradient(0, 0, w * 0.45, 0);
    g.addColorStop(0, 'rgba(255,240,205,0.45)');
    g.addColorStop(1, 'rgba(255,240,205,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.25);
    ctx.lineTo(w * 0.38, h * 0.36);
    ctx.lineTo(w * 0.38, h * 0.8);
    ctx.lineTo(0, h * 0.68);
    ctx.closePath();
    ctx.fill();
  });
}

function wallTexture(kit: Kit, base: number) {
  return kit.canvasTexture(16, 256, (ctx, w, h) => {
    const c = new THREE.Color(base);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `#${c.clone().lerp(new THREE.Color(0xffffff), 0.35).getHexString()}`);
    g.addColorStop(1, `#${c.clone().multiplyScalar(0.9).getHexString()}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** A window on a side wall (facing +x for side 1 on a left wall), with frame, bars and sill. */
function sideWindow(kit: Kit, g: THREE.Group, wallX: number, inward: -1 | 1, z: number, trim: THREE.Material) {
  const x = wallX + inward * 0.02;
  g.add(kit.box(0.08, 2.0, 2.6, kit.lambert(0xcfe9f2, { emissive: 0xbfe6f2, emissiveIntensity: 0.55 }), x, 3.1, z));
  const fx = x + inward * 0.05;
  g.add(kit.box(0.14, 0.14, 2.9, trim, fx, 4.15, z), kit.box(0.14, 0.14, 2.9, trim, fx, 2.05, z));
  g.add(kit.box(0.14, 2.2, 0.14, trim, fx, 3.1, z - 1.38), kit.box(0.14, 2.2, 0.14, trim, fx, 3.1, z + 1.38));
  g.add(kit.box(0.12, 2.0, 0.08, trim, fx, 3.1, z));
  g.add(kit.box(0.4, 0.12, 3.0, trim, x + inward * 0.2, 1.98, z));
}

const inRects = (rects: Rect[], x: number, z: number) => rects.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);

/**
 * The room, shaped by its floor rectangles: floor, walls along every back and side edge (the
 * front is left open, as in Animal Crossing and Pokemon), wainscoting, windows, white glass
 * partitions, and a warm lamp light. Returns the floor (for clicking to walk).
 */
export function buildShape(kit: Kit, g: THREE.Group, id: ScenarioId, rects: Rect[], partitions: Partition[], door: [number, number]): THREE.Group {
  const c = COLORS[id];
  const PANEL_H = 1.5;
  const floorTex = floorTexture(kit, FLOORS[id], c.floor);
  const floor = new THREE.Group();
  floor.name = 'floor';
  const plinth = kit.lambert(0x4a3a2c);
  for (const [x0, z0, x1, z1] of rects) {
    const w = x1 - x0;
    const d = z1 - z0;
    // The floor pattern lines up across rectangles: one texture repeat every 8 units.
    const tex = floorTex.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 8, d / 6);
    tex.offset.set(x0 / 8, -z1 / 6);
    tex.needsUpdate = true;
    kit.track(tex);
    floor.add(kit.box(w, 0.12, d, kit.track(new THREE.MeshLambertMaterial({ map: tex })), (x0 + x1) / 2, 0.06, (z0 + z1) / 2));
    g.add(kit.box(w + 0.6, 0.9, d + 0.6, plinth, (x0 + x1) / 2, -0.45, (z0 + z1) / 2));
  }
  g.add(floor);

  const upperBack = kit.track(new THREE.MeshLambertMaterial({ map: wallTexture(kit, c.back) }));
  const upperSide = kit.track(new THREE.MeshLambertMaterial({ map: wallTexture(kit, c.left) }));
  const panel = kit.lambert(c.panel);
  const trim = kit.lambert(c.trim);
  const cap = kit.lambert(0x3b2e22);

  // Walls along the edges of the floor, found on a 1-unit grid and merged into runs.
  const back: [number, number, number][] = []; // [z, x0, x1]
  const sides: [number, number, number, -1 | 1][] = []; // [x, z0, z1, inward]
  for (let z = -6; z < 6; z++) {
    let run: number | null = null;
    for (let x = -8; x <= 8; x++) {
      const edge = x < 8 && inRects(rects, x + 0.5, z + 0.5) && !inRects(rects, x + 0.5, z - 0.5);
      if (edge && run === null) run = x;
      if (!edge && run !== null) {
        back.push([z, run, x]);
        run = null;
      }
    }
  }
  for (const inward of [1, -1] as const) {
    for (let x = -8; x <= 8; x++) {
      let run: number | null = null;
      for (let z = -6; z <= 6; z++) {
        // inward 1: floor to the right of the line x (a left wall); -1: floor to the left (a right wall)
        const cx = inward === 1 ? x + 0.5 : x - 0.5;
        const ox = inward === 1 ? x - 0.5 : x + 0.5;
        const edge = z < 6 && inRects(rects, cx, z + 0.5) && !inRects(rects, ox, z + 0.5);
        if (edge && run === null) run = z;
        if (!edge && run !== null) {
          sides.push([x, run, z, inward]);
          run = null;
        }
      }
    }
  }
  for (const [z, x0, x1] of back) {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    g.add(kit.box(w + 0.3, WALL_H, 0.3, upperBack, cx, WALL_H / 2, z - 0.15));
    g.add(kit.box(w, PANEL_H, 0.06, panel, cx, PANEL_H / 2, z + 0.03));
    g.add(kit.box(w, 0.12, 0.12, trim, cx, PANEL_H, z + 0.06));
    g.add(kit.box(w, 0.14, 0.08, trim, cx, 0.19, z + 0.06));
    g.add(kit.box(w + 0.42, 0.3, 0.42, cap, cx, WALL_H + 0.1, z - 0.15));
  }
  let bestLeft: [number, number, number] | null = null;
  let bestRight: [number, number, number] | null = null;
  for (const [x, z0, z1, inward] of sides) {
    const d = z1 - z0;
    const cz = (z0 + z1) / 2;
    // Walls that start in the front half of the room stay low, so they don't hide the room.
    const h = z0 >= 0 ? PANEL_H + 0.25 : WALL_H;
    g.add(kit.box(0.3, h, d, h < WALL_H ? panel : upperSide, x - inward * 0.15, h / 2, cz));
    if (h === WALL_H) {
      g.add(kit.box(0.06, PANEL_H, d, panel, x + inward * 0.03, PANEL_H / 2, cz));
      g.add(kit.box(0.12, 0.12, d, trim, x + inward * 0.06, PANEL_H, cz));
    }
    g.add(kit.box(0.08, 0.14, d, trim, x + inward * 0.06, 0.19, cz));
    g.add(kit.box(0.42, h === WALL_H ? 0.3 : 0.16, d + 0.42, h === WALL_H ? cap : trim, x - inward * 0.15, h + 0.06, cz));
    if (h < WALL_H) continue;
    if (inward === 1 && d >= 4 && (!bestLeft || d > bestLeft[2] - bestLeft[1])) bestLeft = [x, z0, z1];
    if (inward === -1 && d >= 4 && (!bestRight || d > bestRight[2] - bestRight[1])) bestRight = [x, z0, z1];
  }
  // A window on the longest wall run each side, toward the front where it won't hide boards
  if (bestLeft) sideWindow(kit, g, bestLeft[0], 1, Math.min(bestLeft[2] - 2, (bestLeft[1] + bestLeft[2]) / 2 + 1), trim);
  if (bestRight) sideWindow(kit, g, bestRight[0], -1, Math.min(bestRight[2] - 2, (bestRight[1] + bestRight[2]) / 2 + 1), trim);

  // White glass partitions, as in Pokemon Black and White's offices
  const white = kit.lambert(0xf4f2ec);
  const glass = kit.lambert(0xcfe8ef, { transparent: true, opacity: 0.45 });
  for (const [x0, z0, x1, z1] of partitions) {
    const along = x0 === x1 ? 'z' : 'x';
    const len = along === 'x' ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const [w, d] = along === 'x' ? [len, 0.22] : [0.22, len];
    g.add(kit.box(w, 1.0, d, white, cx, 0.5, cz));
    const pane = kit.box(along === 'x' ? len : 0.06, 1.5, along === 'x' ? 0.06 : len, glass, cx, 1.75, cz);
    pane.castShadow = false;
    g.add(pane);
    g.add(kit.box(along === 'x' ? len : 0.16, 0.12, along === 'x' ? 0.16 : len, white, cx, 2.55, cz));
    for (const t of [0, 1]) {
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      g.add(kit.box(0.24, 2.7, 0.24, white, px, 1.35, pz));
    }
  }

  // Doormat where the player comes in
  g.add(kit.box(2.4, 0.03, 1.1, kit.lambert(c.panel), door[0], 0.13, door[1] + 0.3));
  // A warm lamp-light glow over the middle of the room
  let sx = 0;
  let sz = 0;
  let area = 0;
  for (const [x0, z0, x1, z1] of rects) {
    const a = (x1 - x0) * (z1 - z0);
    sx += ((x0 + x1) / 2) * a;
    sz += ((z0 + z1) / 2) * a;
    area += a;
  }
  const glow = new THREE.PointLight(0xffd59a, 26, 16, 1.4);
  glow.position.set(sx / area, 4.6, sz / area);
  g.add(glow);
  return floor;
}

/** A small wall shelf on the back wall (a plank on two brackets); things on it come from the layout. */
export function wallShelf(kit: Kit, g: THREE.Group, x: number, y: number, w: number) {
  const wood = kit.lambert(0x8a6240);
  g.add(kit.box(w, 0.12, 0.6, wood, x, y, BACK_Z + 0.3));
  for (const dx of [-w / 2 + 0.3, w / 2 - 0.3]) g.add(kit.box(0.08, 0.35, 0.4, wood, x + dx, y - 0.22, BACK_Z + 0.2));
}
/** A framed picture: a little landscape or potted plant painted in code. */
export function frame(kit: Kit, g: THREE.Group, x: number, y: number, w: number, h: number, seed: number, wall: 'back' | 'left' | 'right' = 'back') {
  const palettes = [
    ['#bfe3ef', '#7fb36a', '#4f8a54', '#f6d79a'],
    ['#f7e1c9', '#e07a5f', '#f2c14e', '#3d7ea6'],
    ['#e8f0e0', '#5f9e6e', '#a7c957', '#386641'],
    ['#fbe8d3', '#d9a6c9', '#8c6bb1', '#f2c14e'],
  ];
  const pal = palettes[seed % palettes.length];
  const tex = kit.canvasTexture(128, 160, (ctx, cw, ch) => {
    ctx.fillStyle = pal[0];
    ctx.fillRect(0, 0, cw, ch);
    if (seed % 2) {
      ctx.fillStyle = pal[3];
      ctx.beginPath();
      ctx.arc(90, 45, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal[1];
      ctx.beginPath();
      ctx.ellipse(40, 150, 90, 60, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal[2];
      ctx.beginPath();
      ctx.ellipse(120, 160, 80, 55, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = pal[1];
      ctx.fillRect(48, 110, 32, 34);
      ctx.fillStyle = pal[2];
      for (const [px, py, r] of [[64, 80, 26], [44, 92, 18], [84, 92, 18], [64, 58, 18]]) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  const wood = kit.lambert(0x6b4a30);
  const pic = plane(kit, tex, w, h);
  if (wall === 'back') {
    g.add(kit.box(w + 0.2, h + 0.2, 0.08, wood, x, y, BACK_Z + 0.05));
    pic.position.set(x, y, BACK_Z + 0.1);
  } else {
    const side = wall === 'left' ? 1 : -1;
    const wx = (wall === 'left' ? LEFT_X : RIGHT_X) + side * 0.05;
    g.add(kit.box(0.08, h + 0.2, w + 0.2, wood, wx, y, x));
    pic.position.set(wx + side * 0.05, y, x);
    pic.rotation.y = (side * Math.PI) / 2;
  }
  g.add(pic);
}

function textLines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, n: number, gap: number, color: string) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) ctx.fillRect(x, y + i * gap, w * (i === n - 1 ? 0.6 : 1), 6);
}

/** A board on the back wall: a frame with a canvas-drawn face. */
function backBoard(kit: Kit, g: THREE.Group, tex: THREE.Texture, w: number, h: number, x: number, y: number, frame = 0x26323a) {
  g.add(kit.box(w + 0.3, h + 0.3, 0.14, kit.lambert(frame), x, y, BACK_Z + 0.07));
  const face = plane(kit, tex, w, h);
  face.position.set(x, y, BACK_Z + 0.15);
  g.add(face);
}

/** A sheet on the left wall. */
function sideSheet(kit: Kit, g: THREE.Group, tex: THREE.Texture, w: number, h: number, z: number, y: number) {
  const s = plane(kit, tex, w, h);
  s.position.set(LEFT_X + 0.03, y, z);
  s.rotation.y = Math.PI / 2;
  g.add(s);
}

/** Yellow sticky note for the "new this time" detail on a revisit. */
function stickyNote(kit: Kit, g: THREE.Group, lines: string[], x: number, y: number, tilt: number) {
  const tex = kit.canvasTexture(320, 240, (ctx, cw, ch) => {
    ctx.fillStyle = '#ffd86b';
    roundRect(ctx, 0, 0, cw, ch, 14);
    ctx.fill();
    ctx.fillStyle = '#3a2a00';
    ctx.font = `800 40px ${DISPLAY_FONT}`;
    lines.forEach((t, i) => ctx.fillText(t, 22, 70 + i * 52));
  });
  const n = plane(kit, tex, 1.5, 1.15);
  n.position.set(x, y, BACK_Z + 0.17);
  n.rotation.z = tilt;
  g.add(n);
}

const sheetTex = (kit: Kit, title: string, color: string) =>
  kit.canvasTexture(256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = `800 30px ${DISPLAY_FONT}`;
    ctx.fillText(title, 20, 44);
    textLines(ctx, 20, 80, 210, 8, 28, '#c3cbd3');
  });

// ---- Each room's boards ------------------------------------------------------------

type Boards = (kit: Kit, g: THREE.Group, twist: boolean) => void;

const resortA: Boards = (kit, g, twist) => {
  const poster = kit.canvasTexture(640, 400, (ctx, w) => {
    ctx.fillStyle = '#fff8ef';
    ctx.fillRect(0, 0, w, 400);
    ctx.fillStyle = '#c4462a';
    ctx.fillRect(0, 0, w, 14);
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 52px ${DISPLAY_FONT}`;
    ctx.fillText('Volunteer Day', 36, 92);
    ctx.font = `700 28px ${FONT}`;
    ctx.fillStyle = '#4b615a';
    ctx.fillText('Senior activity centre · in 2 weeks', 38, 140);
    ctx.fillStyle = '#e4ddd2';
    roundRect(ctx, 38, 200, 564, 46, 23);
    ctx.fill();
    ctx.fillStyle = '#2f6f6a';
    roundRect(ctx, 38, 200, 564 * (12 / 40), 46, 23);
    ctx.fill();
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 40px ${DISPLAY_FONT}`;
    ctx.fillText('12 of 40 spots filled', 38, 310);
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = '#c4462a';
    ctx.fillText('Sign up with the comms team', 38, 360);
  });
  backBoard(kit, g, poster, 4.0, 2.5, -1.0, 3.4, 0x2f6f6a);
  sideSheet(kit, g, sheetTex(kit, 'Sign-up', '#1d2b3a'), 1.1, 1.4, -2.6, 3.0);
  if (twist) stickyNote(kit, g, ['Guest visit:', 'local singer'], 1.8, 4.0, 0.05);
};

const resortB: Boards = (kit, g, twist) => {
  const board = kit.canvasTexture(640, 400, (ctx, w) => {
    ctx.fillStyle = '#1d2b3a';
    ctx.fillRect(0, 0, w, 400);
    ctx.fillStyle = '#ffd86b';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.arc(30 + i * 23.5, 22 + (i % 2) * 10, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 54px ${DISPLAY_FONT}`;
    ctx.fillText('Festive Weekend', 36, 112);
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = '#c9d6e2';
    ctx.fillText('At the mall · in 3 weeks', 38, 156);
    const day = (x: number, label: string, items: string[], faint: boolean) => {
      ctx.fillStyle = faint ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.16)';
      roundRect(ctx, x, 190, 270, 180, 16);
      ctx.fill();
      ctx.fillStyle = '#ffd86b';
      ctx.font = `800 30px ${DISPLAY_FONT}`;
      ctx.fillText(label, x + 18, 232);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 22px ${FONT}`;
      items.forEach((t, i) => ctx.fillText(t, x + 18, 272 + i * 32));
    };
    day(36, 'Saturday', ['Lights on', 'Media visit', 'Choir on the plaza'], false);
    day(330, 'Sunday', ['Crafts at 4pm', 'Morning: ?'], true);
  });
  backBoard(kit, g, board, 4.2, 2.6, -1.2, 3.4, 0xc4462a);
  // Roll-up banner stand
  g.add(kit.box(1.0, 0.12, 0.4, kit.lambert(0x3a3f45), -6.6, 0.12, -4.6));
  const banner = kit.canvasTexture(200, 520, (ctx, w, h) => {
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#c4462a');
    grd.addColorStop(1, '#7c2a1a');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd86b';
    ctx.font = `800 40px ${DISPLAY_FONT}`;
    ctx.fillText('Joy', 30, 110);
    ctx.fillText('awaits', 30, 156);
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Festive', 30, 440);
    ctx.fillText('Weekend', 30, 470);
  });
  const b = plane(kit, banner, 0.9, 2.9);
  b.position.set(-6.6, 1.6, -4.55);
  g.add(b);
  if (twist) stickyNote(kit, g, ['Rain Sat 2pm!', 'Choir?'], 1.9, 4.0, 0.05);
};

const docScreen = (kit: Kit, title: string, status: string, ok: boolean) =>
  kit.canvasTexture(400, 300, (ctx, w) => {
    ctx.fillStyle = '#f7f9fb';
    ctx.fillRect(0, 0, w, 300);
    ctx.fillStyle = '#34465e';
    ctx.fillRect(0, 0, w, 54);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 28px ${DISPLAY_FONT}`;
    ctx.fillText(title, 20, 37);
    textLines(ctx, 20, 84, 360, 4, 26, '#c9d1da');
    ctx.fillStyle = ok ? '#2f7d4f' : '#b23a2c';
    roundRect(ctx, 20, 206, 360, 64, 14);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText(status, 38, 248);
  });

const policyA: Boards = (kit, g, twist) => {
  backBoard(kit, g, docScreen(kit, 'Government report', 'Transfer approved', true), 2.7, 2.0, -3.4, 3.4);
  backBoard(kit, g, docScreen(kit, 'Public registry', 'No record yet', false), 2.7, 2.0, -0.2, 3.4);
  if (twist) stickyNote(kit, g, ['News site:', '"Transfer', 'complete"'], 2.3, 4.0, -0.05);
};

const policyB: Boards = (kit, g, twist) => {
  const map = kit.canvasTexture(640, 420, (ctx, w, h) => {
    ctx.fillStyle = '#bfe0ee';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9fc98f';
    const land = (pts: [number, number][]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      pts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.fill();
    };
    land([[60, 20], [250, 20], [230, 120], [180, 170], [200, 260], [160, 300], [140, 200], [90, 140]]);
    land([[260, 230], [380, 210], [420, 250], [330, 290], [270, 280]]);
    land([[440, 120], [520, 90], [560, 150], [500, 200], [450, 180]]);
    land([[300, 330], [460, 320], [600, 350], [590, 380], [320, 370]]);
    land([[560, 40], [600, 30], [610, 90], [575, 100]]);
    ctx.strokeStyle = '#2f7d4f';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(330, 262, 66, 36, -0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(ctx, 300, 40, 240, 80, 12);
    ctx.fill();
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 28px ${DISPLAY_FONT}`;
    ctx.fillText('Mangrove project', 314, 74);
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText('Early view by Thursday', 316, 104);
  });
  backBoard(kit, g, map, 4.4, 2.9, -2.6, 3.3, 0x34465e);
  if (twist) stickyNote(kit, g, ['New rules on', 'selling abroad'], 0.9, 4.2, -0.05);
};

const foundationA: Boards = (kit, g, twist) => {
  const board = kit.canvasTexture(640, 360, (ctx, w) => {
    ctx.fillStyle = '#fbf7ef';
    ctx.fillRect(0, 0, w, 360);
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 36px ${DISPLAY_FONT}`;
    ctx.fillText('Youth Digital Skills', 32, 58);
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = '#4b615a';
    ctx.fillText('Funded programme · renewal next month', 34, 96);
    ctx.fillStyle = '#e3a21a';
    ctx.fillRect(34, 140, 380, 54);
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 30px ${DISPLAY_FONT}`;
    ctx.fillText('300 attended', 50, 178);
    ctx.strokeStyle = '#8c3b4a';
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 4;
    ctx.strokeRect(34, 222, 380, 54);
    ctx.setLineDash([]);
    ctx.fillStyle = '#8c3b4a';
    ctx.fillText('What changed?', 50, 260);
    ctx.font = `800 120px ${DISPLAY_FONT}`;
    ctx.fillText('?', 500, 260);
  });
  backBoard(kit, g, board, 4.6, 2.6, -1.6, 3.4, 0x6e4a32);
  if (twist) {
    const poster = kit.canvasTexture(256, 320, (ctx, w, h) => {
      ctx.fillStyle = '#5e7a52';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 38px ${DISPLAY_FONT}`;
      ctx.fillText('Eldercare', 22, 80);
      ctx.fillText('programme', 22, 124);
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText('also up for', 22, 186);
      ctx.fillText('funding', 22, 220);
    });
    sideSheet(kit, g, poster, 1.3, 1.6, -3.4, 3.0);
  }
};

const foundationB: Boards = (kit, g, twist) => {
  const board = kit.canvasTexture(640, 400, (ctx, w, h) => {
    ctx.fillStyle = '#c9a073';
    ctx.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `rgba(90,60,30,${0.08 + rnd() * 0.1})`;
      ctx.fillRect(rnd() * w, rnd() * h, 3, 3);
    }
    ctx.fillStyle = '#fbf7ef';
    roundRect(ctx, 30, 24, 300, 64, 10);
    ctx.fill();
    ctx.fillStyle = '#8c3b4a';
    ctx.font = `800 36px ${DISPLAY_FONT}`;
    ctx.fillText('Young givers', 46, 68);
    const notes: [string, string, number, number][] = [
      ['#ffd86b', 'Online', 40, 120],
      ['#f2a7a0', 'Time + skills', 230, 110],
      ['#9fd4e6', 'Show change', 430, 130],
      ['#b7e0a5', 'Trust', 60, 260],
      ['#ffd86b', 'Mental health', 250, 270],
      ['#f2a7a0', 'Event idea', 450, 260],
    ];
    notes.forEach(([c, t, x, y], i) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((i % 3) - 1) * 0.05);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 160, 110);
      ctx.fillStyle = '#3a2a00';
      ctx.font = `700 24px ${FONT}`;
      ctx.fillText(t, 12, 48);
      ctx.fillStyle = '#c4462a';
      ctx.beginPath();
      ctx.arc(80, 10, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  });
  backBoard(kit, g, board, 4.6, 2.8, -1.4, 3.3, 0x6e4a32);
  if (twist) stickyNote(kit, g, ['Co-host:', 'family fdn?'], 2.2, 4.1, 0.05);
};

const workforceA: Boards = (kit, g, twist) => {
  const headlines = kit.canvasTexture(640, 360, (ctx, w) => {
    ctx.fillStyle = '#102a30';
    ctx.fillRect(0, 0, w, 360);
    ctx.fillStyle = '#e8f6f4';
    ctx.font = `800 34px ${DISPLAY_FONT}`;
    ctx.fillText('AI and entry-level jobs', 30, 56);
    ['New tools change junior tasks', 'Skills shift faster than training', 'Employers rethink hiring'].forEach((t, i) => {
      const y = 112 + i * 76;
      ctx.fillStyle = 'rgba(126, 224, 210, 0.18)';
      roundRect(ctx, 30, y - 36, 580, 58, 12);
      ctx.fill();
      ctx.fillStyle = '#7ee0d2';
      ctx.fillRect(30, y - 36, 8, 58);
      ctx.fillStyle = '#e8f6f4';
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText(t, 56, y + 2);
    });
  });
  backBoard(kit, g, headlines, 4.8, 2.7, -1.0, 3.4);
  if (twist) stickyNote(kit, g, ['Union asks:', "workers' voices"], 2.3, 4.1, -0.05);
};

const workforceB: Boards = (kit, g, twist) => {
  const sheet = kit.canvasTexture(400, 300, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f4e5a';
    ctx.fillRect(0, 0, w, 50);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 26px ${DISPLAY_FONT}`;
    ctx.fillText('Focus groups: AI at work', 18, 35);
    ctx.fillStyle = '#e4ddd2';
    roundRect(ctx, 20, 84, 360, 40, 20);
    ctx.fill();
    ctx.fillStyle = '#c4462a';
    roundRect(ctx, 20, 84, 360 * (6 / 20), 40, 20);
    ctx.fill();
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 34px ${DISPLAY_FONT}`;
    ctx.fillText('6 of 20 seats', 20, 176);
    textLines(ctx, 20, 210, 340, 3, 26, '#c3cbd3');
  });
  backBoard(kit, g, sheet, 2.8, 2.1, -4.0, 3.4, 0x1f4e5a);
  // Flipchart on an easel
  const easel = kit.lambert(0x7a5a3e);
  for (const dx of [-0.55, 0.55]) {
    const leg = kit.box(0.09, 3.2, 0.09, easel, 1.4 + dx, 1.6, -4.9);
    leg.rotation.z = -dx * 0.12;
    g.add(leg);
  }
  const flip = kit.canvasTexture(256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3d7ea6';
    ctx.font = `800 30px ${DISPLAY_FONT}`;
    ctx.fillText('Questions', 20, 50);
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `700 22px ${FONT}`;
    ['1. Your week?', '2. New tools?', '3. Training?', '4. Who pays?'].forEach((t, i) => ctx.fillText(t, 20, 104 + i * 48));
  });
  const fp = plane(kit, flip, 1.3, 1.65);
  fp.position.set(1.4, 2.45, -4.8);
  g.add(fp);
  if (twist) stickyNote(kit, g, ["Minister's", 'office joining'], 3.6, 4.1, -0.05);
};

export const BOARDS: Record<ScenarioId, [Boards, Boards]> = {
  resort: [resortA, resortB],
  policy: [policyA, policyB],
  foundation: [foundationA, foundationB],
  workforce: [workforceA, workforceB],
};

export const boardsFor = (id: ScenarioId, task: TaskIndex) => BOARDS[id][task];
