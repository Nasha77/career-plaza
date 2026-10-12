import * as THREE from 'three';
import type { ScenarioId } from '../../types';
import { CHARACTERS, makeCharacter, type Character } from './characters';
import { DISPLAY_FONT, FONT, roundRect, type Kit } from './kit';

export interface Interior {
  group: THREE.Group;
  npc: Character;
  target: THREE.Vector3;
}

interface RoomColors {
  floor: number;
  back: number;
  left: number;
  trim: number;
}

const ROOMS: Record<ScenarioId, RoomColors> = {
  consulting: { floor: 0xd6d2ca, back: 0xeef1f4, left: 0xdbe3ec, trim: 0x2f4a73 },
  classroom: { floor: 0xc9ad8a, back: 0xf0e7d8, left: 0xe4d6c0, trim: 0x7a4b45 },
  data: { floor: 0xcfd9db, back: 0xe7f0f1, left: 0xd3e2e5, trim: 0x1f4e5a },
  research: { floor: 0xc8b89c, back: 0xefe6d2, left: 0xe2d5bb, trim: 0x5e7a52 },
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
const FLOORS: Record<ScenarioId, FloorStyle> = { consulting: 'carpet', classroom: 'planks', data: 'tiles', research: 'planks' };

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

function buildConsulting(kit: Kit, g: THREE.Group, revisit: boolean) {
  const wood = kit.lambert(0x8b6a4e);
  const seat = kit.lambert(0x2f4a73);
  table(kit, g, 4.6, 2.0, 1.4, -0.9, 0.3, wood);
  for (const [x, z, r] of [
    [-2.3, -1.2, 0],
    [0.5, -1.2, 0],
    [-2.3, 1.8, Math.PI],
    [0.5, 1.8, Math.PI],
  ] as const)
    chair(kit, g, x, z, r, seat);
  // Laptop and papers
  g.add(kit.box(0.9, 0.05, 0.6, kit.lambert(0x3a3f45), -0.2, 1.5, 0.2));
  const lid = kit.box(0.9, 0.6, 0.04, kit.lambert(0x3a3f45), -0.2, 1.8, -0.1);
  lid.rotation.x = -0.25;
  g.add(lid);
  g.add(kit.box(0.6, 0.03, 0.8, kit.lambert(0xffffff), -1.8, 1.49, 0.4));

  const chart = kit.canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d2b3a';
    ctx.font = `800 34px ${DISPLAY_FONT}`;
    ctx.fillText('Client profit', 28, 52);
    ctx.strokeStyle = '#c9d1da';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(48, 80);
    ctx.lineTo(48, 270);
    ctx.lineTo(480, 270);
    ctx.stroke();
    ctx.strokeStyle = '#d04a3a';
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(60, 110);
    for (const [x, y] of [[160, 100], [260, 128], [360, 150], [460, 232]]) ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = '#d04a3a';
    ctx.font = `800 44px ${DISPLAY_FONT}`;
    ctx.fillText('−18%', 330, 220);
    ctx.fillStyle = '#5b6672';
    ctx.font = `700 22px ${FONT}`;
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q, i) => ctx.fillText(q, 90 + i * 110, 300));
  });
  g.add(kit.box(4.3, 2.8, 0.12, kit.lambert(0x2f4a73), -0.6, 3.2, -4.1));
  const c = plane(kit, chart, 4.0, 2.5);
  c.position.set(-0.6, 3.2, -4.03);
  g.add(c);
  plant(kit, g, 4.6, -3.4);

  if (revisit) {
    const note = kit.canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#ffd86b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3a2a00';
      ctx.font = `800 40px ${DISPLAY_FONT}`;
      ctx.fillText('Competitor', 22, 80);
      ctx.fillText('cut prices', 22, 130);
      ctx.font = `700 32px ${FONT}`;
      ctx.fillText('last month', 22, 190);
    });
    const n = plane(kit, note, 1.2, 1.2);
    n.position.set(2.4, 3.5, -4.13);
    n.rotation.z = 0.06;
    g.add(n);
  }
  const npc = makeCharacter(kit, CHARACTERS.consulting);
  faceCamera(npc, 2.7, 1.2);
  g.add(npc.group);
  return npc;
}

function buildClassroom(kit: Kit, g: THREE.Group, revisit: boolean) {
  const wood = kit.lambert(0xa47a52);
  const seat = kit.lambert(0x3d7ea6);
  const board = kit.canvasTexture(768, 352, (ctx, w, h) => {
    ctx.fillStyle = '#2f5d4e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f1e8';
    ctx.strokeStyle = '#f4f1e8';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText('Social constructivism', 40, 64);
    ctx.lineWidth = 5;
    const nodes: [number, number, string][] = [
      [150, 210, 'people'],
      [384, 210, 'talk'],
      [618, 210, 'shared ideas'],
    ];
    ctx.font = `700 28px ${FONT}`;
    ctx.textAlign = 'center';
    nodes.forEach(([x, y, t]) => {
      ctx.beginPath();
      ctx.arc(x, y, 66, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(t, x, y + 10);
    });
    for (const x of [222, 456]) {
      ctx.beginPath();
      ctx.moveTo(x, 210);
      ctx.lineTo(x + 86, 210);
      ctx.lineTo(x + 72, 198);
      ctx.moveTo(x + 86, 210);
      ctx.lineTo(x + 72, 222);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.font = `400 26px ${FONT}`;
    ctx.fillText('?', 690, 320);
  });
  g.add(kit.box(6.3, 2.9, 0.14, kit.lambert(0x6e4a32), 0, 3.2, -4.1));
  const b = plane(kit, board, 6.0, 2.6);
  b.position.set(0, 3.2, -4.02);
  g.add(b);
  g.add(kit.box(1.8, 0.12, 0.3, kit.lambert(0x6e4a32), 0, 1.85, -3.95));

  table(kit, g, 2.4, 1.0, 1.0, 3.6, -2.4, wood);
  for (const [x, z] of [
    [-2.8, -0.4],
    [-2.8, 2.2],
    [-0.2, 2.2],
  ] as const) {
    table(kit, g, 1.7, 1.0, 1.0, x, z, wood);
    chair(kit, g, x, z + 0.9, Math.PI, seat);
  }
  // Mia's desk: she sits behind it, facing out toward the camera
  table(kit, g, 1.7, 1.0, 1.0, 1.4, 0.9, wood);
  chair(kit, g, 1.4, 0.05, 0, seat);
  g.add(kit.box(0.7, 0.12, 0.5, kit.lambert(0xd04a3a), 1.1, 1.13, 1.0), kit.box(0.6, 0.1, 0.45, kit.lambert(0x3d7ea6), 1.15, 1.24, 1.0));
  g.add(kit.box(0.8, 0.04, 0.55, kit.lambert(0xffffff), 1.9, 1.09, 1.1));

  // Wall clock
  const clock = kit.canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#fbf8f1';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64, 22);
    ctx.moveTo(64, 64);
    ctx.lineTo(92, 64);
    ctx.stroke();
  });
  const cl = plane(kit, clock, 0.9, 0.9);
  cl.position.set(4.3, 4.3, -4.13);
  g.add(cl);

  if (revisit) {
    const note = kit.canvasTexture(256, 160, (ctx, w, h) => {
      ctx.fillStyle = '#ffd86b';
      roundRect(ctx, 0, 0, w, h, 18);
      ctx.fill();
      ctx.fillStyle = '#3a2a00';
      ctx.font = `800 52px ${DISPLAY_FONT}`;
      ctx.fillText('5 min', 48, 98);
    });
    const n = plane(kit, note, 1.1, 0.7);
    n.position.set(4.3, 3.4, -4.13);
    g.add(n);
  }
  const npc = makeCharacter(kit, CHARACTERS.classroom);
  npc.group.position.set(1.4, 0, 0.1);
  npc.group.rotation.y = 0.35;
  g.add(npc.group);
  return npc;
}

function buildData(kit: Kit, g: THREE.Group, revisit: boolean) {
  const desk = kit.lambert(0xf0f0ea);
  const seat = kit.lambert(0x26323a);
  const dash = kit.canvasTexture(640, 340, (ctx, w, h) => {
    ctx.fillStyle = '#102a30';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8f6f4';
    ctx.font = `800 34px ${DISPLAY_FONT}`;
    ctx.fillText('User retention', 30, 54);
    ctx.fillStyle = '#8fb8b4';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText('Last 3 weeks', 32, 86);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(40, 120 + i * 55);
      ctx.lineTo(600, 120 + i * 55);
      ctx.stroke();
    }
    ctx.strokeStyle = '#7ee0d2';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(60, 140);
    for (const [x, y] of [[180, 150], [300, 190], [420, 228], [560, 272]]) ctx.lineTo(x, y);
    ctx.stroke();
    ctx.font = `800 40px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#e8f6f4';
    ctx.fillText('42%', 52, 128);
    ctx.fillStyle = '#ff9a80';
    ctx.fillText('35%', 520, 248);
    ctx.fillStyle = '#8fb8b4';
    ctx.font = `700 20px ${FONT}`;
    ['Wk 1', 'Wk 2', 'Wk 3'].forEach((t, i) => ctx.fillText(t, 100 + i * 190, 325));
  });
  g.add(kit.box(5.9, 3.3, 0.16, kit.lambert(0x26323a), 0.3, 3.2, -4.08));
  const d = plane(kit, dash, 5.6, 3.0);
  d.position.set(0.3, 3.2, -3.99);
  g.add(d);

  const screenMat = kit.lambert(0x9fe3da, { emissive: 0x4fbfb2, emissiveIntensity: 0.6 });
  const frame = kit.lambert(0x26323a);
  for (const z of [-0.6, 2.0]) {
    table(kit, g, 3.6, 1.2, 1.05, -2.6, z, desk);
    for (const x of [-3.5, -1.7]) {
      g.add(kit.box(1.0, 0.66, 0.08, frame, x, 1.6, z - 0.3));
      g.add(kit.box(0.88, 0.54, 0.02, screenMat, x, 1.6, z - 0.25));
      g.add(kit.box(0.1, 0.3, 0.1, frame, x, 1.2, z - 0.35));
      chair(kit, g, x, z + 0.95, Math.PI, seat);
    }
  }
  // Bean bag and plant for the studio feel
  const bean = kit.sphere(0.9, 1, kit.lambert(0xe0763c), 4.2, 0.45, -2.6);
  bean.scale.set(1, 0.55, 1);
  g.add(bean);
  plant(kit, g, 4.8, 3.2);

  if (revisit) {
    const poster = kit.canvasTexture(256, 320, (ctx, w, h) => {
      ctx.fillStyle = '#e0763c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 40px ${DISPLAY_FONT}`;
      ctx.fillText('Campus', 24, 80);
      ctx.fillText('event', 24, 126);
      ctx.font = `700 28px ${FONT}`;
      ctx.fillText('new sign-ups', 24, 190);
      textLines(ctx, 24, 230, 200, 3, 24, 'rgba(255,255,255,0.7)');
    });
    const p = plane(kit, poster, 1.2, 1.5);
    p.position.set(-5.62, 3.0, 3.0);
    p.rotation.y = Math.PI / 2;
    g.add(p);
  }
  const npc = makeCharacter(kit, CHARACTERS.data);
  faceCamera(npc, 2.6, 0.8);
  g.add(npc.group);
  return npc;
}

function buildResearch(kit: Kit, g: THREE.Group, revisit: boolean) {
  const shelfMat = kit.lambert(0x7a5a3e);
  const bookColors = [0x5b7db1, 0xd04a3a, 0xe3a21a, 0x5f9e6e, 0x8c3b4a, 0x3d7ea6, 0xd98c7a, 0x2f4a73];
  const shelves: [number, number, number][] = [
    [-3.2, -3.85, 0],
    [3.4, -3.85, 0],
    [-5.35, 1.2, Math.PI / 2],
  ];
  const bookCount = shelves.length * 3 * 9;
  const books = new THREE.InstancedMesh(kit.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), kit.lambert(0xffffff), bookCount);
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  let bi = 0;
  shelves.forEach(([sx, sz, rot]) => {
    const s = new THREE.Group();
    s.position.set(sx, 0, sz);
    s.rotation.y = rot;
    s.add(kit.box(3.2, 3.8, 0.7, shelfMat, 0, 1.9, 0));
    g.add(s);
    s.updateMatrixWorld();
    for (let row = 0; row < 3; row++) {
      let x = -1.35;
      for (let k = 0; k < 9; k++) {
        const w = 0.2 + ((k * 7 + row * 3) % 4) * 0.04;
        const hgt = 0.7 + ((k * 5 + row) % 3) * 0.12;
        tmp.position.set(x + w / 2, 0.45 + row * 1.15 + hgt / 2, 0.4);
        tmp.rotation.set(0, 0, k % 5 === 4 ? 0.15 : 0);
        tmp.scale.set(w, hgt, 0.5);
        tmp.updateMatrix();
        tmp.matrix.premultiply(s.matrix);
        books.setMatrixAt(bi, tmp.matrix);
        books.setColorAt(bi, col.set(bookColors[(bi * 3) % bookColors.length]));
        bi++;
        x += w + 0.06;
      }
    }
  });
  g.add(books);

  table(kit, g, 3.8, 1.6, 1.05, -0.2, -0.2, kit.lambert(0x8b6a4e));
  const report = (label: string) =>
    kit.canvasTexture(256, 320, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d2b3a';
      ctx.font = `800 54px ${DISPLAY_FONT}`;
      ctx.fillText('Report', 26, 76);
      ctx.fillStyle = '#5e7a52';
      ctx.font = `800 110px ${DISPLAY_FONT}`;
      ctx.fillText(label, 26, 196);
      textLines(ctx, 26, 228, 200, 3, 26, '#c3cbd3');
    });
  const stacks: [string, number][] = [
    ['A', -1.2],
    ['B', 0.6],
  ];
  if (revisit) stacks.push(['C', 1.35]);
  stacks.forEach(([label, x], i) => {
    const hgt = 0.32 - i * 0.06;
    g.add(kit.box(0.82, hgt, 1.0, kit.lambert(0xf7f5ef), x, 1.12 + hgt / 2, -0.2));
    const top = plane(kit, report(label), 0.78, 0.96);
    top.rotation.x = -Math.PI / 2;
    top.position.set(x, 1.13 + hgt, -0.2);
    g.add(top);
  });
  // Desk lamp
  g.add(kit.cyl(0.25, 0.3, 0.08, 8, kit.lambert(0x2b2b2b), -1.75, 1.16, -0.75));
  g.add(kit.cyl(0.04, 0.04, 0.8, 5, kit.lambert(0x2b2b2b), -1.75, 1.55, -0.75));
  g.add(kit.cyl(0.12, 0.35, 0.35, 8, kit.lambert(0xe3a21a, { emissive: 0xe3a21a, emissiveIntensity: 0.3 }), -1.75, 1.95, -0.75));
  plant(kit, g, 4.9, 3.2);

  const npc = makeCharacter(kit, CHARACTERS.research);
  faceCamera(npc, 2.6, 1.2);
  g.add(npc.group);
  return npc;
}

const BUILDERS = { consulting: buildConsulting, classroom: buildClassroom, data: buildData, research: buildResearch };

/** A small cutaway room on a plinth, built fresh on entry and disposed on exit. */
export function buildInterior(kit: Kit, id: ScenarioId, revisit: boolean): Interior {
  const group = new THREE.Group();
  room(kit, group, ROOMS[id], FLOORS[id]);
  const npc = BUILDERS[id](kit, group, revisit);
  return { group, npc, target: new THREE.Vector3(0.4, 2.0, 0) };
}
