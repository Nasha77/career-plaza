import * as THREE from 'three';
import { DISPLAY_FONT, roundRect, type Kit } from './kit';
import { instanced, type Place } from './models';

/**
 * The Career Plaza campus, laid out like The Sims 4's Discover University campuses:
 * a Britechester-style quad (four lawns, crossing paths, a fountain, lanterns strung with
 * pennants) with the policy hall and its clock tower as the landmark at the end of the main
 * axis, and Foxbury-style touches on the way in (raised planters, a water feature, a sculpture,
 * glass towers, a river to the east). North is -z; the entrance is at the south (+z).
 *
 * The flat parts (paths, lawns, planters, water, river, gate) are built in code; the props are
 * Kenney models, drawn as instanced copies.
 */

export const QUAD = 12.2;
const PATH_W = 4.4;
const RIVER_X = (z: number) => 41 + Math.sin(z / 13) * 4;

/** Building spots: the landmark hall at the north end of the axis, towers east and west, the
 * shophouse row south-west, and (for balance) the café south-east. */
export const CAMPUS_PLACES = {
  policy: [0, -27] as [number, number],
  resort: [26, 0] as [number, number],
  workforce: [-26, 0] as [number, number],
  foundation: [-19, 20] as [number, number],
  cafe: [19, 20] as [number, number],
};

/** Where trees may go: outside the paths, lawns, buildings and river. */
export function campusClear(x: number, z: number): boolean {
  if (Math.abs(x) < QUAD + 3 && Math.abs(z) < QUAD + 3) return false; // the quad
  if (Math.abs(x) < 15 && z > 12 && z < 46) return false; // promenade and terrace
  if (Math.abs(z) < 4 && Math.abs(x) < 24) return false; // east-west path
  if (Math.abs(x) < 4 && z < 0 && z > -24) return false; // path to the hall
  for (const [bx, bz] of Object.values(CAMPUS_PLACES)) if (Math.hypot(x - bx, z - bz) < 11) return false;
  if (Math.abs(x - RIVER_X(z)) < 7) return false;
  return true;
}

// ---- Code-built ground: paths, lawns, terrace, water, river, gate --------------------------

function stoneTexture(kit: Kit, base: string) {
  return kit.canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const s = 32;
    for (let y = 0, row = 0; y < h; y += s, row++)
      for (let x = -(row % 2) * (s / 2); x < w; x += s) {
        const t = 228 + Math.floor(rnd() * 22);
        ctx.fillStyle = `rgb(${t},${t - 5},${t - 14})`;
        ctx.fillRect(x + 1.5, y + 1.5, s - 3, s - 3);
      }
  });
}

function tiled(kit: Kit, tex: THREE.Texture, w: number, d: number) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 4, d / 4);
  t.needsUpdate = true;
  kit.track(t);
  return kit.track(new THREE.MeshLambertMaterial({ map: t }));
}

export interface CampusGround {
  group: THREE.Group;
  /** Water surfaces to animate (pools and the river). */
  waters: THREE.Mesh[];
  jets: THREE.Mesh[];
  pathMats: THREE.MeshLambertMaterial[];
}

export function buildCampusGround(kit: Kit): CampusGround {
  const g = new THREE.Group();
  const stone = stoneTexture(kit, '#d9cfbe');
  const pathMats: THREE.MeshLambertMaterial[] = [];
  const slab = (w: number, d: number, x: number, z: number, h = 0.26, rot = 0) => {
    const m = tiled(kit, stone, w, d);
    pathMats.push(m);
    const b = kit.box(w, h, d, m, x, h / 2, z);
    b.rotation.y = rot;
    g.add(b);
    return b;
  };
  // Main axis, from the gate to the hall, and the cross path between the towers
  slab(PATH_W, 68, 0, 9);
  slab(48, PATH_W, 0, 0);
  // The quad's perimeter walk
  for (const s of [-1, 1]) {
    slab(QUAD * 2 + 2.4, 2.4, 0, s * QUAD);
    slab(2.4, QUAD * 2 + 2.4, s * QUAD, 0);
  }
  // Round paving around the fountain
  g.add(kit.cyl(5.6, 5.8, 0.3, 40, tiled(kit, stone, 11, 11), 0, 0.15, 0));
  // Diagonal paths to the shophouses and the café
  const diag = Math.hypot(7.5, 6.8);
  slab(3, diag + 1, -15.6, 15.8, 0.24, Math.atan2(-7.5, 6.8));
  slab(3, diag + 1, 15.6, 15.8, 0.24, Math.atan2(7.5, 6.8));

  // Four lawns, a little raised, edged with low clipped hedges (Britechester)
  const lawn = kit.lambert(0x8fc46f);
  const hedge = kit.lambert(0x4f8f4a);
  const inner = PATH_W / 2 + 0.3;
  const outer = QUAD - 1.5;
  const size = outer - inner;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * (inner + size / 2);
      const cz = sz * (inner + size / 2);
      g.add(kit.box(size, 0.3, size, lawn, cx, 0.15, cz));
      for (const [w, d, ox, oz] of [
        [size, 0.5, 0, (size / 2) * -sz],
        [size, 0.5, 0, (size / 2) * sz],
        [0.5, size, (size / 2) * -sx, 0],
        [0.5, size, (size / 2) * sx, 0],
      ] as const) {
        // Leave a gap in the middle of each hedge facing the paths, so the lawns can be reached
        const gap = 1.8;
        const long = w > d ? w : d;
        for (const half of [-1, 1]) {
          const len = (long - gap) / 2;
          const off = half * (gap / 2 + len / 2);
          const hx = w > d ? off : 0;
          const hz = w > d ? 0 : off;
          g.add(kit.box(w > d ? len : 0.5, 0.75, w > d ? 0.5 : len, hedge, cx + ox + hx, 0.5, cz + oz + hz));
        }
      }
    }

  // Foxbury terrace between the gate and the quad: wide paving, raised planters, a water feature
  slab(15, 14, 0, 24, 0.28);
  const planterStone = kit.lambert(0xb9b2a5);
  const planterTop = kit.lambert(0x7fb862);
  for (const sx of [-1, 1]) {
    for (const [z, d, h] of [
      [20, 5, 1.1],
      [28, 5, 1.6],
    ] as const) {
      g.add(kit.box(4, h, d, planterStone, sx * 9.6, h / 2, z));
      g.add(kit.box(3.6, 0.12, d - 0.4, planterTop, sx * 9.6, h + 0.06, z));
    }
  }
  const waterMat = kit.lambert(0x57b7cf, { emissive: 0x2d8fa8, emissiveIntensity: 0.25 });
  const waters: THREE.Mesh[] = [];
  const jets: THREE.Mesh[] = [];
  g.add(kit.box(5.2, 0.6, 7.6, planterStone, 0, 0.3, 24));
  const pool = kit.box(4.6, 0.1, 7.0, waterMat, 0, 0.62, 24);
  g.add(pool);
  waters.push(pool);
  const jetMat = kit.lambert(0xbde9f2, { emissive: 0x6cc6dc, emissiveIntensity: 0.4, transparent: true, opacity: 0.85 });
  for (const z of [21.5, 24, 26.5])
    for (const x of [-1.2, 1.2]) {
      const j = kit.cyl(0.05, 0.12, 1.4, 6, jetMat, x, 1.3, z);
      g.add(j);
      jets.push(j);
    }

  // A sculpture on the axis: a tilted orange ring on a dark plinth (screenshot 2's bronze ring)
  g.add(kit.box(1.6, 1.0, 1.6, kit.lambert(0x3a3d42), 0, 0.5, 15.6));
  const ring = new THREE.Mesh(kit.geo('sculpture', () => new THREE.TorusGeometry(1.5, 0.32, 10, 28)), kit.lambert(0xd9822b));
  ring.position.set(0, 2.6, 15.6);
  ring.rotation.set(0.25, 0.6, 0);
  g.add(ring);

  // The river along the east side, with sandy banks
  const riverGeo = new THREE.PlaneGeometry(1, 1, 1, 60);
  const pos = riverGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) + 0.5; // 0..1 along the river
    const z = -90 + t * 180;
    pos.setXYZ(i, RIVER_X(z) + pos.getX(i) * 9, 0.08, z);
  }
  riverGeo.computeVertexNormals();
  const bankGeo = riverGeo.clone();
  const bpos = bankGeo.attributes.position;
  for (let i = 0; i < bpos.count; i++) {
    const z = bpos.getZ(i);
    const x = bpos.getX(i);
    bpos.setXYZ(i, RIVER_X(z) + (x - RIVER_X(z)) * 1.35, 0.05, z);
  }
  const bank = new THREE.Mesh(bankGeo, kit.lambert(0xe2d3a6, { side: THREE.DoubleSide }));
  const river = new THREE.Mesh(riverGeo, kit.lambert(0x4fa8c4, { emissive: 0x1d6f8a, emissiveIntensity: 0.22, side: THREE.DoubleSide }));
  g.add(bank, river);
  // A path from the café to a footbridge over the river
  slab(RIVER_X(20) - 23, 2.6, (23 + RIVER_X(20)) / 2 - 1.5, 20, 0.22);

  // The entrance gate at the south end of the axis: a lintel between two towers, with a sign
  const sign = kit.canvasTexture(640, 140, (ctx, w, h) => {
    ctx.fillStyle = '#e0cfa6';
    roundRect(ctx, 6, 14, w - 12, h - 20, 30);
    ctx.fill();
    ctx.fillStyle = '#fffaea';
    roundRect(ctx, 6, 6, w - 12, h - 22, 30);
    ctx.fill();
    ctx.fillStyle = '#5a4632';
    ctx.font = `900 62px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Career Plaza', w / 2, h / 2 - 4);
  });
  g.add(kit.box(10.4, 0.9, 1.0, kit.lambert(0x8a6240), 0, 6.4, 42));
  for (const dz of [0.52, -0.52]) {
    const s = new THREE.Mesh(kit.geo('plane', () => new THREE.PlaneGeometry(1, 1)), kit.track(new THREE.MeshBasicMaterial({ map: sign, toneMapped: false })));
    s.scale.set(7, 1.55, 1);
    s.position.set(0, 6.4, 42 + dz);
    if (dz < 0) s.rotation.y = Math.PI;
    g.add(s);
  }

  // Pennant bunting strung across the paths between the lanterns (Britechester's quad)
  const pennants = [0x2f7d4f, 0xe3a21a, 0xfaf3e0];
  const flagGeo = kit.geo('pennant', () => new THREE.ConeGeometry(0.28, 0.6, 3).rotateX(Math.PI));
  const strings: [number, number, number, number][] = [];
  for (const z of [-9, -4.5, 4.5, 9]) strings.push([-2.9, z, 2.9, z]);
  for (const x of [-9, -4.5, 4.5, 9]) strings.push([x, -2.9, x, 2.9]);
  for (const z of [33, 37.5]) strings.push([-2.9, z, 2.9, z]);
  const count = strings.length * 9;
  const flags = new THREE.InstancedMesh(flagGeo, kit.lambert(0xffffff), count);
  const cord = kit.lambert(0x5a4632);
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  let k = 0;
  strings.forEach(([x0, z0, x1, z1]) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const c = kit.box(len, 0.04, 0.04, cord, (x0 + x1) / 2, 3.65, (z0 + z1) / 2);
    c.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    g.add(c);
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9;
      tmp.position.set(x0 + (x1 - x0) * t, 3.55 - Math.sin(t * Math.PI) * 0.45, z0 + (z1 - z0) * t);
      tmp.rotation.set(0, -Math.atan2(z1 - z0, x1 - x0), 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      flags.setMatrixAt(k, tmp.matrix);
      flags.setColorAt(k, col.set(pennants[k % 3]));
      k++;
    }
  });
  g.add(flags);
  return { group: g, waters, jets, pathMats };
}

// ---- Kenney props -----------------------------------------------------------------------------

interface Prop {
  path: string;
  scale: number;
  places: Place[];
}

/** Every repeated Kenney prop on the campus. */
function props(): Prop[] {
  const lanterns: Place[] = [];
  for (const z of [-9, -4.5, 4.5, 9]) for (const x of [-2.9, 2.9]) lanterns.push({ x, z });
  for (const x of [-9, -4.5, 4.5, 9]) for (const z of [-2.9, 2.9]) lanterns.push({ x, z });
  for (const z of [33, 37.5]) for (const x of [-2.9, 2.9]) lanterns.push({ x, z });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lanterns.push({ x: sx * (QUAD + 1.6), z: sz * (QUAD + 1.6) });

  // Benches on the lawns' edges, facing the main paths
  const benches: Place[] = [];
  for (const s of [-1, 1]) {
    benches.push({ x: s * 3.4, z: -7, r: s > 0 ? -Math.PI / 2 : Math.PI / 2 }, { x: s * 3.4, z: 7, r: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
    benches.push({ x: -7, z: s * 3.4, r: s > 0 ? Math.PI : 0 }, { x: 7, z: s * 3.4, r: s > 0 ? Math.PI : 0 });
  }

  // Tree avenues along the promenade and around the quad
  const avenue: Place[] = [];
  for (let z = 32; z <= 42; z += 5) for (const x of [-12.5, 12.5]) avenue.push({ x, z, r: z });
  // Around the quad, leaving the views to the buildings' doors open
  for (const s of [-1, 1]) for (const t of [-8, 8]) {
    avenue.push({ x: s * (QUAD + 3.6), z: t - 4, r: t });
    avenue.push({ x: t, z: -(QUAD + 3.6), r: t + s });
  }

  // Flowers and grass in the lawns' corners and on the planters
  const flowers: Place[] = [];
  const tall: Place[] = [];
  const grass: Place[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * 6.6;
      const cz = sz * 6.6;
      flowers.push({ x: cx + sx * 2.6, z: cz + sz * 2.6, r: sx }, { x: cx - sx * 2.6, z: cz + sz * 2.6, r: sz });
      tall.push({ x: cx + sx * 2.4, z: cz - sz * 2.6 }, { x: cx, z: cz, s: 1.3 });
      grass.push({ x: cx - sx * 1.6, z: cz - sz * 1.4 }, { x: cx + sx * 1.2, z: cz + sz * 0.6 });
    }
  for (const sx of [-1, 1])
    for (const [z, h] of [
      [20, 1.1],
      [28, 1.6],
    ] as const)
      for (const dz of [-1.4, 0, 1.4]) {
        (dz === 0 ? tall : flowers).push({ x: sx * 9.6, y: h + 0.12, z: z + dz, r: dz });
      }

  return [
    { path: 'town/lantern', scale: 2.6, places: lanterns },
    { path: 'town/stall-bench', scale: 2.6, places: benches },
    { path: 'town/tree-high-round', scale: 2.4, places: avenue },
    { path: 'garden/flowers', scale: 2.4, places: flowers },
    { path: 'garden/flowers-tall', scale: 2.6, places: tall },
    { path: 'garden/grass', scale: 2.4, places: grass },
    // The kiosk on the quad's north-east corner, with a cart beside it
    { path: 'town/stall-green', scale: 2.8, places: [{ x: QUAD + 3.4, z: -(QUAD + 3.4), r: -Math.PI / 4 }] },
    { path: 'town/cart', scale: 2.6, places: [{ x: QUAD + 0.6, z: -(QUAD + 4.6), r: 1.2 }] },
    // The gate's two towers, with long banners
    { path: 'castle/tower-square-base', scale: 2.8, places: [{ x: -5.6, z: 42 }, { x: 5.6, z: 42 }] },
    { path: 'castle/tower-square-top', scale: 2.8, places: [{ x: -5.6, y: 2.8, z: 42 }, { x: 5.6, y: 2.8, z: 42 }] },
    { path: 'castle/flag-banner-long', scale: 1.5, places: [{ x: -5.6, y: 5.6, z: 42 }, { x: 5.6, y: 5.6, z: 42 }] },
    // The footbridge over the river, on the café's path
    { path: 'castle/bridge-straight', scale: 4.4, places: [{ x: RIVER_X(20), y: -0.5, z: 20, r: Math.PI / 2 }] },
    // Rocks along the river bank
    { path: 'town/rock-large', scale: 2.2, places: [{ x: RIVER_X(-30) - 6, z: -30 }, { x: RIVER_X(46) - 6, z: 46, r: 2 }, { x: RIVER_X(-6) + 6, z: -6, r: 1 }] },
  ];
}

/** The café pavilion south-east of the quad: a terrace with stalls, parasols and tables. */
function cafe(): Prop[] {
  const [cx, cz] = CAMPUS_PLACES.cafe;
  return [
    { path: 'town/stall-red', scale: 2.8, places: [{ x: cx + 2.6, z: cz + 1.8, r: -2.4 }] },
    { path: 'town/stall-green', scale: 2.8, places: [{ x: cx - 1.2, z: cz + 3.4, r: -2.9 }] },
    { path: 'city/detail-parasol-a', scale: 4.2, places: [{ x: cx - 2.4, z: cz - 1.6 }, { x: cx + 1.8, z: cz - 2.4 }] },
    { path: 'town/stall-stool', scale: 2.4, places: [{ x: cx - 3.4, z: cz - 1.0 }, { x: cx - 1.4, z: cz - 2.2 }, { x: cx + 0.8, z: cz - 3.0 }, { x: cx + 2.8, z: cz - 1.6 }] },
  ];
}

/** Load and place all the campus props. */
export async function dressCampus(kit: Kit, group: THREE.Group): Promise<void> {
  const [cx, cz] = CAMPUS_PLACES.cafe;
  // The café's terrace
  group.add(kit.box(9, 0.3, 8, kit.lambert(0xcbbfa8), cx, 0.15, cz));
  const all = [...props(), ...cafe()];
  const parts = await Promise.all(all.map((p) => instanced(p.path, p.places, p.scale)));
  parts.forEach((g) => group.add(g));
}

// ---- Classic buildings from modular pieces ------------------------------------------------

type Side = 'front' | 'back' | 'left' | 'right';
const SIDE_ROT: Record<Side, number> = { right: 0, front: -Math.PI / 2, back: Math.PI / 2, left: Math.PI };

/**
 * Walls for a box of cells (Kenney Fantasy Town pieces), storey by storey. `pick` chooses the
 * piece for each wall cell. Returns placements grouped by model, in the building's local space.
 */
function modularWalls(cx: number, cz: number, storeys: number, M: number, ox: number, pick: (side: Side, i: number, n: number, storey: number) => string) {
  const out = new Map<string, Place[]>();
  const add = (path: string, p: Place) => {
    if (!out.has(path)) out.set(path, []);
    out.get(path)!.push(p);
  };
  const x0 = -((cx - 1) / 2) * M + ox;
  const z0 = -((cz - 1) / 2) * M;
  for (let s = 0; s < storeys; s++) {
    for (let i = 0; i < cx; i++) {
      add(pick('front', i, cx, s), { x: x0 + i * M, y: s * M, z: z0 + (cz - 1) * M, r: SIDE_ROT.front });
      add(pick('back', i, cx, s), { x: x0 + i * M, y: s * M, z: z0, r: SIDE_ROT.back });
    }
    for (let j = 0; j < cz; j++) {
      add(pick('right', j, cz, s), { x: x0 + (cx - 1) * M, y: s * M, z: z0 + j * M, r: SIDE_ROT.right });
      add(pick('left', j, cz, s), { x: x0, y: s * M, z: z0 + j * M, r: SIDE_ROT.left });
    }
  }
  return out;
}

export interface ClassicBuilding {
  group: THREE.Group;
  /** Materials to dim until the building is visited. */
  mats: THREE.Material[];
  height: number;
}

async function placeAll(map: Map<string, Place[]>, scale: number, group: THREE.Group, mats: THREE.Material[]) {
  const parts = await Promise.all([...map].map(([path, places]) => instanced(path, places, scale, true)));
  parts.forEach((g) => {
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) mats.push(m);
    });
    group.add(g);
  });
}

/** The Climate Policy Association: a two-storey stone hall with a clock tower (Britechester). */
export async function policyHall(kit: Kit): Promise<ClassicBuilding> {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const M = 2.4;
  const walls = modularWalls(5, 3, 2, M, 0, (side, i, n, s) => {
    if (side === 'front' && s === 0 && i === Math.floor(n / 2)) return 'town/wall-doorway-round';
    if (s === 0) return side === 'front' || i % 2 === 0 ? 'town/wall-window-round' : 'town/wall';
    return side === 'front' || side === 'back' ? 'town/wall-window-glass' : 'town/wall-window-round';
  });
  await placeAll(walls, M, group, mats);
  // Stone corner pillars, a cornice and a slate roof
  const stone = kit.lambert(0xd8d2c4, { unique: true });
  const slate = kit.lambert(0x5d6773, { unique: true });
  mats.push(stone, slate);
  for (const x of [-6, 6]) for (const z of [-3.6, 3.6]) group.add(kit.box(0.6, 2 * M + 0.2, 0.6, stone, x, M, z));
  group.add(kit.box(12.6, 0.3, 7.8, stone, 0, 2 * M + 0.15, 0));
  const roof = kit.prism(7.8, 2.6, 12.6, slate);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = 2 * M + 0.3;
  group.add(roof);
  // Clock tower rising from the middle of the roof (Castle Kit pieces)
  const T = 3.4;
  const tower: [string, number][] = [
    ['castle/tower-square-base', 0],
    ['castle/tower-square-mid-windows', 1],
    ['castle/tower-square-mid-windows', 2],
    ['castle/tower-square-top-roof-high', 3],
  ];
  const tp = new Map<string, Place[]>();
  tower.forEach(([p, k]) => {
    if (!tp.has(p)) tp.set(p, []);
    tp.get(p)!.push({ x: 0, y: k * T, z: -0.6 });
  });
  await placeAll(tp, T, group, mats);
  const face = kit.canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#fffaea';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4632';
    ctx.lineWidth = 6;
    ctx.stroke();
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      ctx.fillStyle = '#5a4632';
      ctx.fillRect(64 + Math.sin(a) * 48 - 3, 64 - Math.cos(a) * 48 - 3, 6, 6);
    }
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64, 26);
    ctx.moveTo(64, 64);
    ctx.lineTo(90, 72);
    ctx.stroke();
  });
  const clock = new THREE.Mesh(kit.geo('plane', () => new THREE.PlaneGeometry(1, 1)), kit.track(new THREE.MeshBasicMaterial({ map: face, transparent: true, toneMapped: false })));
  clock.scale.setScalar(2.2);
  clock.position.set(0, T * 2.55, -0.6 + T / 2 + 0.05);
  group.add(clock);
  // Solar panels on the roof's front slope, either side of the tower
  const panel = kit.lambert(0x23376b, { emissive: 0x16244a, emissiveIntensity: 0.3 });
  const slope = Math.atan2(2.6, 3.9);
  for (const x of [-4.2, -2.4, 2.4, 4.2]) {
    const p = kit.box(1.6, 0.08, 2.2, panel, x, 2 * M + 1.62, 2.0);
    p.rotation.x = slope;
    group.add(p);
  }
  return { group, mats, height: T * 4.35 };
}

/** The Community Foundation: a row of three timber-and-stone shophouses with gable roofs. */
export async function shophouses(kit: Kit): Promise<ClassicBuilding> {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const M = 2.1;
  const roofs = [0xb5694a, 0x5f8f86, 0xc9963b];
  for (const [h, ox] of [-4.2, 0, 4.2].entries()) {
    const walls = modularWalls(2, 3, 2, M, ox, (side, i, _n, s) => {
      if (s === 0) {
        if (side === 'front') return i === 0 ? 'town/wall-doorway-round' : 'town/wall-window-glass';
        return i === 1 ? 'town/wall-window-round' : 'town/wall';
      }
      if (side === 'front') return 'town/wall-wood-window-shutters';
      return i === 1 ? 'town/wall-wood-window-glass' : 'town/wall-wood';
    });
    await placeAll(walls, M, group, mats);
    const roofMat = kit.lambert(roofs[h], { unique: true });
    mats.push(roofMat);
    const roof = kit.prism(7.6, 2.4, 4.3, roofMat);
    roof.rotation.y = Math.PI / 2;
    roof.position.set(ox, 2 * M, 0);
    group.add(roof);
  }
  return { group, mats, height: 2 * M + 2.4 };
}

// ---- People on the plaza ---------------------------------------------------------------------

export interface Stroller {
  /** Floor points walked in a loop. Empty for someone standing still. */
  route: [number, number][];
  /** Where they start (or stand), and which way they face when standing. */
  at: [number, number];
  r: number;
}

/** Background people on the campus: some walking the paths, some chatting, one at the kiosk. */
export const STROLLERS: Stroller[] = [
  // Around the quad's perimeter walk
  { route: [[-QUAD, -QUAD], [QUAD, -QUAD], [QUAD, QUAD], [-QUAD, QUAD]], at: [-QUAD, -QUAD], r: 0 },
  { route: [[QUAD, QUAD], [-QUAD, QUAD], [-QUAD, -QUAD], [QUAD, -QUAD]], at: [QUAD, QUAD], r: 0 },
  // Up and down the promenade
  { route: [[0.9, 40], [0.9, 30.8], [6.2, 28], [6.2, 18.5], [0.9, 15.8], [0.9, 6.5], [-0.9, 6.5], [-0.9, 15.8], [-6.2, 18.5], [-6.2, 28], [-0.9, 30.8], [-0.9, 40]], at: [0.9, 40], r: 0 },
  // Along the cross path
  { route: [[-20, 0.9], [20, 0.9], [20, -0.9], [-20, -0.9]], at: [-20, 0.9], r: 0 },
  // A pair chatting by the fountain, and someone at the kiosk
  { route: [], at: [-4.2, 7.2], r: 0.9 },
  { route: [], at: [-2.8, 8.6], r: -2.3 },
  { route: [], at: [QUAD + 1.8, -(QUAD + 1.4)], r: -2.4 },
  // At the café
  { route: [], at: [CAMPUS_PLACES.cafe[0] - 3.2, CAMPUS_PLACES.cafe[1] - 2.6], r: 0.6 },
];
