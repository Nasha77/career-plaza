import * as THREE from 'three';
import type { ScenarioId } from '../../types';
import { getScenario, taskManagerIndex } from '../../content';
import type { RoomSetup } from '../types';
import { CHARACTERS, COLLEAGUE_LOOKS, makeCharacter, type Character } from './characters';
import { DISPLAY_FONT, FONT, roundRect, type Kit } from './kit';

export interface Interior {
  group: THREE.Group;
  npc: Character;
  /** The building's colleagues, indexed as in the content file (a gap where one is running the task). */
  people: Character[];
  /** Invisible, generous click targets for the colleagues (userData.person = index). */
  personHits: THREE.Mesh[];
  target: THREE.Vector3;
}

/** Free floor spots for colleagues in each room, clear of the furniture and the manager. */
const PERSON_SPOTS: Record<ScenarioId, [number, number][]> = {
  resort: [[4.3, -1.6], [-4.3, 2.9], [1.6, 3.4]],
  policy: [[4.4, -1.5], [-0.9, -2.8], [1.7, 3.3]],
  foundation: [[-4.2, -2.6], [3.6, -2.0], [-3.8, 2.9]],
  workforce: [[3.8, -2.4], [-3.4, -2.8], [0.8, 3.0]],
};
const LOOK_OFFSET: Record<ScenarioId, number> = { resort: 0, policy: 3, foundation: 6, workforce: 9 };

interface RoomColors {
  floor: number;
  back: number;
  left: number;
  trim: number;
}

const ROOMS: Record<ScenarioId, RoomColors> = {
  resort: { floor: 0xd6cbb8, back: 0xf3ede2, left: 0xe8dfcf, trim: 0x2f6f6a },
  policy: { floor: 0xb9a184, back: 0xe9ecee, left: 0xdde2e6, trim: 0x34465e },
  foundation: { floor: 0xc9ad8a, back: 0xf4ece0, left: 0xe9dccb, trim: 0x8c3b4a },
  workforce: { floor: 0xcfd9db, back: 0xe7eef0, left: 0xd5e0e3, trim: 0x1f4e5a },
};

/** Faces a character toward the default interior camera direction. */
const faceCamera = (c: Character, x: number, z: number) => {
  c.group.position.set(x, 0, z);
  c.group.rotation.y = Math.atan2(7 - x, 11 - z);
};

function plane(kit: Kit, tex: THREE.Texture, w: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(kit.geo('plane', () => new THREE.PlaneGeometry(1, 1)), kit.track(new THREE.MeshBasicMaterial({ map: tex })));
  m.scale.set(w, h, 1);
  return m;
}

function table(kit: Kit, g: THREE.Group, w: number, d: number, h: number, x: number, z: number, mat: THREE.Material, rotY = 0) {
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  t.rotation.y = rotY;
  t.add(kit.box(w, 0.14, d, mat, 0, h, 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) t.add(kit.box(0.12, h, 0.12, mat, sx * (w / 2 - 0.15), h / 2, sz * (d / 2 - 0.15)));
  g.add(t);
  return t;
}

function chair(kit: Kit, g: THREE.Group, x: number, z: number, rotY: number, mat: THREE.Material) {
  const c = new THREE.Group();
  c.position.set(x, 0, z);
  c.rotation.y = rotY;
  c.add(kit.box(0.8, 0.12, 0.8, mat, 0, 0.6, 0));
  c.add(kit.box(0.8, 0.9, 0.12, mat, 0, 1.1, -0.36));
  c.add(kit.cyl(0.06, 0.06, 0.6, 5, mat, 0, 0.3, 0));
  g.add(c);
}

function plant(kit: Kit, g: THREE.Group, x: number, z: number) {
  g.add(kit.cyl(0.35, 0.28, 0.6, 8, kit.lambert(0xb5694a), x, 0.3, z));
  g.add(kit.sphere(0.6, 0, kit.lambert(0x5f9e6e), x, 1.05, z));
  g.add(kit.sphere(0.42, 0, kit.lambert(0x78b57f), x + 0.2, 1.5, z + 0.1));
}

type FloorStyle = 'carpet' | 'planks' | 'tiles';
const FLOORS: Record<ScenarioId, FloorStyle> = { resort: 'carpet', policy: 'planks', foundation: 'planks', workforce: 'tiles' };

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

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
      const pw = 64;
      for (let y = 0, row = 0; y < h; y += pw, row++) {
        for (let x = -((row * 173) % 300); x < w; x += 300) {
          ctx.fillStyle = shade(0.9 + rnd() * 0.18);
          ctx.fillRect(x + 2, y + 2, 296, pw - 4);
          ctx.strokeStyle = shade(0.8);
          ctx.lineWidth = 1.5;
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            const gy = y + 12 + k * 16 + rnd() * 6;
            ctx.moveTo(x + 10, gy);
            ctx.bezierCurveTo(x + 100, gy + 4, x + 200, gy - 4, x + 290, gy);
            ctx.stroke();
          }
        }
      }
    } else if (style === 'tiles') {
      const t = 96;
      for (let y = 0; y < h; y += t)
        for (let x = 0; x < w; x += t) {
          ctx.fillStyle = shade(0.94 + rnd() * 0.1);
          ctx.fillRect(x + 3, y + 3, t - 6, t - 6);
        }
    } else {
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = shade(0.86 + rnd() * 0.2);
        ctx.fillRect(rnd() * w, rnd() * h, 3, 3);
      }
      ctx.strokeStyle = shade(0.8);
      ctx.lineWidth = 10;
      ctx.strokeRect(70, 70, w - 140, h - 140);
    }
    // Soft light falling in through the side window
    const g = ctx.createLinearGradient(0, 0, w * 0.5, 0);
    g.addColorStop(0, 'rgba(255,240,205,0.45)');
    g.addColorStop(1, 'rgba(255,240,205,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.3);
    ctx.lineTo(w * 0.42, h * 0.42);
    ctx.lineTo(w * 0.42, h * 0.85);
    ctx.lineTo(0, h * 0.72);
    ctx.closePath();
    ctx.fill();
  });
}

/** Walls fade a little lighter toward the ceiling, like light bouncing down. */
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

function textured(kit: Kit, map: THREE.Texture) {
  return kit.track(new THREE.MeshLambertMaterial({ map }));
}

function room(kit: Kit, g: THREE.Group, c: RoomColors, style: FloorStyle) {
  g.add(kit.box(12.4, 0.9, 9.4, kit.lambert(0xbfb6a6), 0, -0.45, 0));
  g.add(kit.box(11.6, 0.12, 8.6, textured(kit, floorTexture(kit, style, c.floor)), 0, 0.06, 0));
  g.add(kit.box(11.6, 5.4, 0.3, textured(kit, wallTexture(kit, c.back)), 0, 2.7, -4.3));
  g.add(kit.box(0.3, 5.4, 8.6, textured(kit, wallTexture(kit, c.left)), -5.8, 2.7, 0));
  // Skirting and top trim give the cutaway a clean edge
  const trim = kit.lambert(c.trim);
  g.add(kit.box(11.6, 0.25, 0.34, trim, 0, 5.45, -4.3), kit.box(0.34, 0.25, 8.6, trim, -5.8, 5.45, 0));
  g.add(kit.box(12.4, 0.12, 0.12, trim, 0, 0.0, 4.7), kit.box(0.12, 0.12, 9.4, trim, 6.2, 0.0, 0));
  // Window on the side wall
  g.add(kit.box(0.08, 2.2, 3.2, kit.lambert(0xbfe3ef, { emissive: 0x9fd4e6, emissiveIntensity: 0.35 }), -5.62, 3.0, 0.4));
  g.add(kit.box(0.1, 0.12, 3.4, trim, -5.6, 1.85, 0.4), kit.box(0.1, 2.2, 0.1, trim, -5.6, 3.0, 0.4));
}

function textLines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, n: number, gap: number, color: string) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) ctx.fillRect(x, y + i * gap, w * (i === n - 1 ? 0.6 : 1), 6);
}

/** Yellow sticky note used for the "new this time" detail on a revisit. */
function stickyNote(kit: Kit, lines: string[], w = 1.3, h = 1.0) {
  const tex = kit.canvasTexture(320, 240, (ctx, cw, ch) => {
    ctx.fillStyle = '#ffd86b';
    roundRect(ctx, 0, 0, cw, ch, 14);
    ctx.fill();
    ctx.fillStyle = '#3a2a00';
    ctx.font = `800 40px ${DISPLAY_FONT}`;
    lines.forEach((t, i) => ctx.fillText(t, 22, 70 + i * 52));
  });
  return plane(kit, tex, w, h);
}

/** Wall screen or board: a dark frame with a canvas-drawn face. */
function wallScreen(kit: Kit, g: THREE.Group, tex: THREE.Texture, w: number, h: number, x: number, y: number, frame = 0x26323a) {
  g.add(kit.box(w + 0.3, h + 0.3, 0.14, kit.lambert(frame), x, y, -4.1));
  const face = plane(kit, tex, w, h);
  face.position.set(x, y, -4.02);
  g.add(face);
}

function buildResort(kit: Kit, g: THREE.Group, revisit: boolean) {
  const wood = kit.lambert(0x9a7656);
  const seat = kit.lambert(0x2f6f6a);
  table(kit, g, 4.6, 2.0, 1.4, -0.9, 0.3, wood);
  for (const [x, z, r] of [
    [-2.3, -1.2, 0],
    [0.5, -1.2, 0],
    [-2.3, 1.8, Math.PI],
    [0.5, 1.8, Math.PI],
  ] as const)
    chair(kit, g, x, z, r, seat);
  // Laptop, newsletter drafts and a stack of volunteer T-shirts
  g.add(kit.box(0.9, 0.05, 0.6, kit.lambert(0x3a3f45), -0.2, 1.5, 0.2));
  const lid = kit.box(0.9, 0.6, 0.04, kit.lambert(0x3a3f45), -0.2, 1.8, -0.1);
  lid.rotation.x = -0.25;
  g.add(lid);
  g.add(kit.box(0.6, 0.03, 0.8, kit.lambert(0xffffff), -1.8, 1.49, 0.4));
  g.add(kit.box(0.7, 0.3, 0.5, kit.lambert(0xe07a5f), -2.6, 1.62, -0.2));

  const poster = kit.canvasTexture(640, 400, (ctx, w, h) => {
    ctx.fillStyle = '#fff8ef';
    ctx.fillRect(0, 0, w, h);
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
  wallScreen(kit, g, poster, 4.0, 2.5, -0.6, 3.2, 0x2f6f6a);

  // Sign-up sheet pinned to the side wall
  const sheet = kit.canvasTexture(256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 30px ${DISPLAY_FONT}`;
    ctx.fillText('Sign-up', 20, 44);
    textLines(ctx, 20, 80, 210, 8, 28, '#c3cbd3');
  });
  const s = plane(kit, sheet, 0.9, 1.15);
  s.position.set(-5.62, 3.1, 2.6);
  s.rotation.y = Math.PI / 2;
  g.add(s);
  plant(kit, g, 4.6, -3.4);

  if (revisit) {
    const n = stickyNote(kit, ['Guest visit:', 'local singer']);
    n.position.set(2.4, 3.6, -4.13);
    n.rotation.z = 0.05;
    g.add(n);
  }
  const npc = makeCharacter(kit, CHARACTERS.resort);
  faceCamera(npc, 2.7, 1.2);
  g.add(npc.group);
  return npc;
}

function buildPolicy(kit: Kit, g: THREE.Group, revisit: boolean) {
  const wood = kit.lambert(0x6f5440);
  const seat = kit.lambert(0x34465e);
  const docScreen = (title: string, status: string, ok: boolean) =>
    kit.canvasTexture(400, 300, (ctx, w, h) => {
      ctx.fillStyle = '#f7f9fb';
      ctx.fillRect(0, 0, w, h);
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
  wallScreen(kit, g, docScreen('Government report', 'Transfer approved', true), 2.7, 2.0, -1.7, 3.2);
  wallScreen(kit, g, docScreen('Public registry', 'No record yet', false), 2.7, 2.0, 1.6, 3.2);

  for (const [x, z] of [
    [-2.8, -0.4],
    [-2.8, 2.2],
  ] as const) {
    table(kit, g, 1.7, 1.0, 1.0, x, z, wood);
    chair(kit, g, x, z + 0.9, Math.PI, seat);
  }
  // The intern's desk, with two monitors echoing the wall screens
  table(kit, g, 2.4, 1.1, 1.0, 0.4, 0.6, wood);
  const frame = kit.lambert(0x26323a);
  const glow = kit.lambert(0xdfe8f2, { emissive: 0x9fb7cf, emissiveIntensity: 0.5 });
  for (const x of [-0.1, 0.9]) {
    g.add(kit.box(0.8, 0.55, 0.06, frame, x, 1.42, 0.3));
    g.add(kit.box(0.7, 0.45, 0.02, glow, x, 1.42, 0.34));
  }
  chair(kit, g, 0.4, 1.5, Math.PI, seat);
  // Filing cabinet and a pile of country reports
  g.add(kit.box(1.0, 1.6, 0.8, kit.lambert(0x8f9aa6), 4.6, 0.8, -3.4));
  g.add(kit.box(0.7, 0.25, 0.9, kit.lambert(0xf7f5ef), 4.6, 1.73, -3.4));
  plant(kit, g, -4.8, -3.3);

  if (revisit) {
    const n = stickyNote(kit, ['News site:', '"Transfer', 'complete"'], 1.2, 1.1);
    n.position.set(4.0, 4.4, -4.13);
    n.rotation.z = -0.05;
    g.add(n);
  }
  const npc = makeCharacter(kit, CHARACTERS.policy);
  faceCamera(npc, 2.8, 1.4);
  g.add(npc.group);
  return npc;
}

function buildFoundation(kit: Kit, g: THREE.Group, revisit: boolean) {
  const wood = kit.lambert(0xb08a62);
  const seat = kit.lambert(0x8c3b4a);
  const board = kit.canvasTexture(640, 360, (ctx, w, h) => {
    ctx.fillStyle = '#fbf7ef';
    ctx.fillRect(0, 0, w, h);
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
  wallScreen(kit, g, board, 4.6, 2.6, 0.2, 3.2, 0x6e4a32);

  // Long meeting table with the report and its sticky notes
  table(kit, g, 4.4, 1.8, 1.05, -0.4, 0.4, wood);
  for (const [x, z, r] of [
    [-1.8, -0.75, 0],
    [0.2, -0.75, 0],
    [-1.8, 1.55, Math.PI],
    [0.2, 1.55, Math.PI],
  ] as const)
    chair(kit, g, x, z, r, seat);
  g.add(kit.box(1.0, 0.08, 1.3, kit.lambert(0xffffff), -0.6, 1.16, 0.4));
  const notes = [0xffd86b, 0xf2a7a0, 0x9fd4e6, 0xb7e0a5];
  notes.forEach((c, i) => {
    const n = kit.box(0.24, 0.02, 0.24, kit.lambert(c), -0.9 + (i % 2) * 0.55, 1.21, 0.0 + Math.floor(i / 2) * 0.6);
    n.rotation.y = (i - 1.5) * 0.2;
    g.add(n);
  });
  g.add(kit.cyl(0.12, 0.1, 0.25, 8, kit.lambert(0xffffff), 0.9, 1.24, 0.7));
  plant(kit, g, 4.6, -3.3);
  plant(kit, g, 4.9, 3.2);

  if (revisit) {
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
      textLines(ctx, 22, 254, 200, 2, 24, 'rgba(255,255,255,0.7)');
    });
    const p = plane(kit, poster, 1.2, 1.5);
    p.position.set(-5.62, 3.0, 2.8);
    p.rotation.y = Math.PI / 2;
    g.add(p);
  }
  const npc = makeCharacter(kit, CHARACTERS.foundation);
  faceCamera(npc, 2.7, 1.0);
  g.add(npc.group);
  return npc;
}

function buildWorkforce(kit: Kit, g: THREE.Group, revisit: boolean) {
  const headlines = kit.canvasTexture(640, 360, (ctx, w, h) => {
    ctx.fillStyle = '#102a30';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8f6f4';
    ctx.font = `800 34px ${DISPLAY_FONT}`;
    ctx.fillText('AI and entry-level jobs', 30, 56);
    const items = ['New tools change junior tasks', 'Skills shift faster than training', 'Employers rethink hiring'];
    items.forEach((t, i) => {
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
  wallScreen(kit, g, headlines, 4.8, 2.7, 0.3, 3.2);

  // One shelf of reports on the side wall
  const shelfMat = kit.lambert(0x7a5a3e);
  const shelf = new THREE.Group();
  shelf.position.set(-5.35, 0, 1.2);
  shelf.rotation.y = Math.PI / 2;
  shelf.add(kit.box(3.2, 3.8, 0.7, shelfMat, 0, 1.9, 0));
  g.add(shelf);
  shelf.updateMatrixWorld();
  const bookColors = [0x5b7db1, 0xd04a3a, 0xe3a21a, 0x5f9e6e, 0x8c3b4a, 0x3d7ea6];
  const books = new THREE.InstancedMesh(kit.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), kit.lambert(0xffffff), 27);
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  let bi = 0;
  for (let row = 0; row < 3; row++) {
    let x = -1.35;
    for (let k = 0; k < 9; k++) {
      const w = 0.2 + ((k * 7 + row * 3) % 4) * 0.04;
      const hgt = 0.7 + ((k * 5 + row) % 3) * 0.12;
      tmp.position.set(x + w / 2, 0.45 + row * 1.15 + hgt / 2, 0.4);
      tmp.rotation.set(0, 0, k % 5 === 4 ? 0.15 : 0);
      tmp.scale.set(w, hgt, 0.5);
      tmp.updateMatrix();
      tmp.matrix.premultiply(shelf.matrix);
      books.setMatrixAt(bi, tmp.matrix);
      books.setColorAt(bi, col.set(bookColors[(bi * 5) % bookColors.length]));
      bi++;
      x += w + 0.06;
    }
  }
  g.add(books);

  // Briefing table with the deck and printed trend notes
  table(kit, g, 3.8, 1.6, 1.05, -0.2, 0.2, kit.lambert(0x4a4f57));
  const deck = (label: string, accent: string) =>
    kit.canvasTexture(320, 240, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, w, 36);
      ctx.fillStyle = '#1d2b3a';
      ctx.font = `800 40px ${DISPLAY_FONT}`;
      ctx.fillText(label, 20, 96);
      textLines(ctx, 20, 130, 280, 3, 28, '#c3cbd3');
    });
  const stacks: [string, string, number][] = [
    ['Briefing', '#2f6f6a', -1.1],
    ['Trends', '#e3a21a', 0.5],
  ];
  if (revisit) stacks.push(['Workers', '#c4462a', 1.35]);
  stacks.forEach(([label, accent, x], i) => {
    const hgt = 0.18 + (i === 0 ? 0.08 : 0);
    g.add(kit.box(0.95, hgt, 0.72, kit.lambert(0xf7f5ef), x, 1.12 + hgt / 2, 0.2));
    const top = plane(kit, deck(label, accent), 0.9, 0.67);
    top.rotation.x = -Math.PI / 2;
    top.position.set(x, 1.13 + hgt, 0.2);
    g.add(top);
  });
  for (const [x, z, r] of [
    [-1.2, -1.0, 0],
    [0.6, -1.0, 0],
    [-1.2, 1.4, Math.PI],
  ] as const)
    chair(kit, g, x, z, r, kit.lambert(0x26323a));
  plant(kit, g, 4.9, 3.2);

  const npc = makeCharacter(kit, CHARACTERS.workforce);
  faceCamera(npc, 2.7, 1.4);
  g.add(npc.group);
  return npc;
}

const BUILDERS = { resort: buildResort, policy: buildPolicy, foundation: buildFoundation, workforce: buildWorkforce };
const BUILDERS_B = { resort: buildResortB, policy: buildPolicyB, foundation: buildFoundationB, workforce: buildWorkforceB };

/** Where each room's manager stands, so task B's manager takes the same spot. */
const MANAGER_SPOTS: Record<ScenarioId, [number, number]> = { resort: [2.7, 1.2], policy: [2.8, 1.4], foundation: [2.7, 1.0], workforce: [2.7, 1.4] };

const colleagueLook = (id: ScenarioId, i: number) => COLLEAGUE_LOOKS[(LOOK_OFFSET[id] + i) % COLLEAGUE_LOOKS.length];

/** A small cutaway room on a plinth, built fresh on entry and disposed on exit. */
export function buildInterior(kit: Kit, id: ScenarioId, setup: RoomSetup): Interior {
  const group = new THREE.Group();
  room(kit, group, ROOMS[id], FLOORS[id]);
  const manager = taskManagerIndex(id, setup.task);
  let npc: Character;
  if (manager === null) {
    npc = BUILDERS[id](kit, group, setup.twist);
  } else {
    // Task B: a different corner of the building, run by one of the colleagues.
    BUILDERS_B[id](kit, group, setup.twist);
    npc = makeCharacter(kit, colleagueLook(id, manager));
    faceCamera(npc, ...MANAGER_SPOTS[id]);
    group.add(npc.group);
  }

  const people: Character[] = [];
  const personHits: THREE.Mesh[] = [];
  const hitMat = kit.basic(0xffffff);
  hitMat.visible = false;
  getScenario(id).colleagues.forEach((_, i) => {
    const spot = PERSON_SPOTS[id][i];
    if (!spot || i === manager) return;
    const person = makeCharacter(kit, colleagueLook(id, i));
    faceCamera(person, spot[0], spot[1]);
    group.add(person.group);
    people[i] = person;
    const hit = kit.box(1.3, 3.2, 1.3, hitMat, spot[0], 1.6, spot[1]);
    hit.userData.person = i;
    group.add(hit);
    personHits.push(hit);
  });

  return { group, npc, people, personHits, target: new THREE.Vector3(0.4, 2.0, 0) };
}

// ---- Task B rooms ----------------------------------------------------------------

function twistNote(kit: Kit, g: THREE.Group, lines: string[], x: number, y: number, tilt: number) {
  const n = stickyNote(kit, lines, 1.3, 1.0);
  n.position.set(x, y, -4.13);
  n.rotation.z = tilt;
  g.add(n);
}

/** Marketing office: the festive campaign board, a banner stand and a planning table. */
function buildResortB(kit: Kit, g: THREE.Group, twist: boolean) {
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
  wallScreen(kit, g, board, 4.2, 2.6, -0.8, 3.2, 0xc4462a);

  // Roll-up banner stand
  g.add(kit.box(0.9, 0.12, 0.35, kit.lambert(0x3a3f45), -4.4, 0.12, -2.6));
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
  const b = plane(kit, banner, 0.8, 2.6);
  b.position.set(-4.4, 1.5, -2.55);
  g.add(b);

  table(kit, g, 3.6, 1.6, 1.4, -0.8, 0.6, kit.lambert(0x9a7656));
  for (const [x, z, r] of [
    [-1.8, -0.5, 0],
    [0.2, -0.5, 0],
    [-1.8, 1.9, Math.PI],
  ] as const)
    chair(kit, g, x, z, r, kit.lambert(0xc4462a));
  // Laptop, the run-sheet and a box of fairy lights
  g.add(kit.box(0.9, 0.05, 0.6, kit.lambert(0x3a3f45), -0.2, 1.5, 0.5));
  const lid = kit.box(0.9, 0.6, 0.04, kit.lambert(0x3a3f45), -0.2, 1.8, 0.2);
  lid.rotation.x = -0.25;
  g.add(lid);
  g.add(kit.box(0.5, 0.03, 0.7, kit.lambert(0xffffff), -1.5, 1.49, 0.6));
  g.add(kit.box(0.7, 0.35, 0.5, kit.lambert(0x2f6f6a), -2.2, 1.65, 0.4));
  const bulb = kit.lambert(0xffd86b, { emissive: 0xffc65a, emissiveIntensity: 0.8 });
  for (let i = 0; i < 4; i++) g.add(kit.sphere(0.07, 0, bulb, -2.45 + i * 0.16, 1.86, 0.4));
  plant(kit, g, 4.6, -3.4);
  if (twist) twistNote(kit, g, ['Rain Sat 2pm!', 'Choir?'], 2.5, 3.6, 0.05);
}

/** Research corner: a map of Southeast Asia with one coastline circled. */
function buildPolicyB(kit: Kit, g: THREE.Group, twist: boolean) {
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
  wallScreen(kit, g, map, 4.4, 2.9, -0.4, 3.2, 0x34465e);

  const seat = kit.lambert(0x34465e);
  table(kit, g, 2.6, 1.2, 1.0, -0.6, 0.8, kit.lambert(0x6f5440));
  chair(kit, g, -0.6, 1.7, Math.PI, seat);
  g.add(kit.box(0.9, 0.6, 0.06, kit.lambert(0x26323a), -0.6, 1.45, 0.45));
  g.add(kit.box(0.8, 0.5, 0.02, kit.lambert(0xdfe8f2, { emissive: 0x9fb7cf, emissiveIntensity: 0.5 }), -0.6, 1.45, 0.49));
  // Reports and a globe
  g.add(kit.box(0.7, 0.3, 0.9, kit.lambert(0xf7f5ef), -1.6, 1.22, 0.8));
  g.add(kit.cyl(0.08, 0.2, 0.15, 8, kit.lambert(0x6f5440), 0.4, 1.15, 0.9));
  g.add(kit.sphere(0.3, 1, kit.lambert(0x3d7ea6), 0.4, 1.5, 0.9));
  // Bookshelf by the window
  g.add(kit.box(0.7, 3.2, 2.0, kit.lambert(0x7a5a3e), -5.3, 1.6, -2.6));
  [0x5b7db1, 0x5f9e6e, 0xe3a21a].forEach((c, r) => g.add(kit.box(0.5, 0.7, 1.7, kit.lambert(c), -5.1, 0.75 + r * 1.0, -2.6)));
  plant(kit, g, 4.6, -3.3);
  if (twist) twistNote(kit, g, ['New rules on', 'selling abroad'], 2.9, 4.2, -0.05);
}

/** A cosy corner: a pinboard of sticky notes about young givers, an armchair and a reading pile. */
function buildFoundationB(kit: Kit, g: THREE.Group, twist: boolean) {
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
  wallScreen(kit, g, board, 4.6, 2.8, -0.2, 3.2, 0x6e4a32);

  // Armchair, a low table with tea and a reading pile
  const fabric = kit.lambert(0x8c3b4a);
  g.add(kit.box(1.4, 0.6, 1.3, fabric, -2.6, 0.5, 0.6), kit.box(1.4, 1.1, 0.3, fabric, -2.6, 1.2, 0.05));
  g.add(kit.box(0.3, 0.9, 1.3, fabric, -3.3, 0.85, 0.6), kit.box(0.3, 0.9, 1.3, fabric, -1.9, 0.85, 0.6));
  table(kit, g, 1.6, 1.1, 0.7, -0.4, 1.0, kit.lambert(0xb08a62));
  g.add(kit.cyl(0.12, 0.1, 0.25, 8, kit.lambert(0xffffff), -0.1, 0.9, 1.1));
  [0x5b7db1, 0xe3a21a, 0x5f9e6e].forEach((c, i) => g.add(kit.box(0.7, 0.1, 0.5, kit.lambert(c), -0.7, 0.82 + i * 0.1, 0.9)));
  chair(kit, g, 0.9, 1.4, -Math.PI / 2, fabric);
  // Floor lamp
  g.add(kit.cyl(0.05, 0.05, 2.2, 6, kit.lambert(0x3a3f45), -4.4, 1.1, -0.8));
  g.add(kit.cyl(0.25, 0.4, 0.4, 10, kit.lambert(0xfbe9c4, { emissive: 0xffd9a0, emissiveIntensity: 0.6 }), -4.4, 2.3, -0.8));
  plant(kit, g, 4.6, -3.3);
  plant(kit, g, 4.9, 3.2);
  if (twist) twistNote(kit, g, ['Co-host:', 'family fdn?'], 3.4, 4.0, 0.05);
}

/** Focus-group room: chairs in a circle, a flipchart and the sign-up sheet. */
function buildWorkforceB(kit: Kit, g: THREE.Group, twist: boolean) {
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
  wallScreen(kit, g, sheet, 2.8, 2.1, -1.6, 3.3, 0x1f4e5a);

  // Flipchart on an easel
  const easel = kit.lambert(0x7a5a3e);
  for (const dx of [-0.5, 0.5]) {
    const leg = kit.box(0.08, 3.0, 0.08, easel, 1.8 + dx, 1.5, -3.3);
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
  const fp = plane(kit, flip, 1.2, 1.5);
  fp.position.set(1.8, 2.3, -3.2);
  g.add(fp);

  // Chairs in a circle around a low table
  const seat = kit.lambert(0x26323a);
  const [cx, cz] = [-1.0, 0.9];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    chair(kit, g, cx + Math.sin(a) * 1.8, cz + Math.cos(a) * 1.5, a + Math.PI, seat);
  }
  const top = kit.lambert(0x4a4f57);
  g.add(kit.cyl(0.6, 0.6, 0.08, 16, top, cx, 0.7, cz), kit.cyl(0.08, 0.08, 0.7, 6, top, cx, 0.35, cz));
  g.add(kit.box(0.5, 0.06, 0.4, kit.lambert(0xf7f5ef), cx, 0.77, cz));
  plant(kit, g, 4.9, 3.2);
  if (twist) twistNote(kit, g, ["Minister's", 'office joining'], 3.9, 4.3, -0.05);
}
