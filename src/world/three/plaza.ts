import * as THREE from 'three';
import type { ScenarioId } from '../../types';
import { CHARACTERS, makeCharacter, type Character } from './characters';
import { DISPLAY_FONT, roundRect, type Kit } from './kit';

export interface BuildingHandle {
  id: ScenarioId;
  name: string;
  group: THREE.Group;
  hit: THREE.Mesh;
  /** Door position in world space. */
  door: THREE.Vector3;
  /** Unit vector from the building toward the plaza centre. */
  toCenter: THREE.Vector3;
  windowMat: THREE.MeshLambertMaterial;
  bodyMats: { m: THREE.MeshLambertMaterial; base: THREE.Color }[];
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  sparkle: THREE.Mesh;
  label: THREE.Sprite;
  height: number;
  lit: boolean;
  lift: number;
  liftTarget: number;
  pulse: number;
}

export interface Plaza {
  group: THREE.Group;
  buildings: Map<ScenarioId, BuildingHandle>;
  guide: Character;
  rings: THREE.Mesh[];
  jet: THREE.Mesh;
  water: THREE.ShaderMaterial;
  theme: (dark: boolean) => void;
}

const DIST = 20;
const PLACES: Record<ScenarioId, [number, number]> = {
  consulting: [0, -DIST],
  classroom: [DIST, 0],
  data: [0, DIST],
  research: [-DIST, 0],
};
const NAMES: Record<ScenarioId, string> = {
  consulting: 'Consulting Firm',
  classroom: 'University Classroom',
  data: 'Data Studio',
  research: 'Research Center',
};

type Face = 'front' | 'back' | 'left' | 'right';

/** Collects window transforms so each building's windows are one instanced draw call. */
class Windows {
  mats: THREE.Matrix4[] = [];
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  add(x: number, y: number, z: number, rotY: number, w = 0.6, h = 0.85) {
    this.q.setFromAxisAngle(this.up, rotY);
    this.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q.clone(), new THREE.Vector3(w, h, 0.08)));
  }

  /** Grid of windows on one face of a box of width `w` and depth `d` centred on the origin. */
  grid(face: Face, w: number, d: number, cols: number[], rows: number[], ww?: number, wh?: number) {
    for (const c of cols)
      for (const r of rows) {
        if (face === 'front') this.add(c, r, d / 2 + 0.03, 0, ww, wh);
        if (face === 'back') this.add(c, r, -d / 2 - 0.03, 0, ww, wh);
        if (face === 'left') this.add(-w / 2 - 0.03, r, c, Math.PI / 2, ww, wh);
        if (face === 'right') this.add(w / 2 + 0.03, r, c, Math.PI / 2, ww, wh);
      }
  }

  build(kit: Kit, mat: THREE.Material): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(kit.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat, this.mats.length);
    this.mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    return im;
  }
}

const span = (n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n);

export const LABEL_W = 0.2;
export const LABEL_H = LABEL_W * (140 / 640);
/** Labels hang just in front of each building, below the roofline. */
export const labelY = (height: number) => Math.min(height, 8) + 1.2;

function labelSprite(kit: Kit, text: string): THREE.Sprite {
  const tex = kit.canvasTexture(640, 140, (ctx, w, h) => {
    ctx.font = `800 58px ${DISPLAY_FONT}`;
    const tw = Math.min(w - 20, ctx.measureText(text).width + 64);
    const x = (w - tw) / 2;
    ctx.fillStyle = 'rgba(20, 48, 42, 0.92)';
    roundRect(ctx, x, 14, tw, h - 28, 40);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 3);
  });
  // Fixed on-screen size, so names stay readable at any camera distance.
  const mat = kit.track(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  const s = new THREE.Sprite(mat);
  s.scale.set(LABEL_W, LABEL_H, 1);
  s.renderOrder = 10;
  return s;
}

function buildConsulting(kit: Kit, g: THREE.Group, win: Windows, own: (c: number) => THREE.MeshLambertMaterial) {
  const body = own(0x5b7db1);
  const dark = own(0x2f4a73);
  g.add(kit.box(6.6, 0.6, 5.6, dark, 0, 0.3, 0));
  g.add(kit.box(6, 11, 5, body, 0, 5.5, 0));
  g.add(kit.box(4.2, 1.6, 3.6, dark, 0, 11.8, 0));
  g.add(kit.cyl(0.07, 0.07, 2.2, 5, dark, 1.2, 13.7, 0));
  g.add(kit.box(3.2, 0.18, 1.4, dark, 0, 2.9, 3.1));
  g.add(kit.box(1.8, 2.5, 0.1, kit.lambert(0x24364f), 0, 1.25, 2.53));
  const cols = span(4, -3, 3);
  const rows = span(7, 3.4, 10.8);
  win.grid('front', 6, 5, cols, rows);
  win.grid('back', 6, 5, cols, rows);
  win.grid('left', 6, 5, span(3, -2.5, 2.5), rows);
  win.grid('right', 6, 5, span(3, -2.5, 2.5), rows);
  return { door: 2.6, height: 14.8, hit: [7.5, 15, 6.5] as const };
}

function buildClassroom(kit: Kit, g: THREE.Group, win: Windows, own: (c: number) => THREE.MeshLambertMaterial) {
  const body = own(0xd98c7a);
  const roof = own(0x7a4b45);
  const stone = own(0xf1ece2);
  g.add(kit.box(9, 4.6, 6, body, 0, 2.3, 0));
  const r = kit.prism(9.8, 2.1, 6.6, roof);
  r.position.y = 4.6;
  g.add(r);
  g.add(kit.box(6.2, 0.3, 2.2, stone, 0, 0.15, 4.0));
  for (const x of [-2.4, -0.8, 0.8, 2.4]) g.add(kit.cyl(0.22, 0.26, 3.8, 8, stone, x, 2.2, 4.6));
  g.add(kit.box(6.6, 0.35, 2.4, stone, 0, 4.25, 4.0));
  const ped = kit.prism(6.6, 1.2, 0.5, stone);
  ped.position.set(0, 4.42, 5.0);
  g.add(ped);
  g.add(kit.box(1.6, 2.6, 0.1, kit.lambert(0x5b3a2e), 0, 1.3, 3.03));
  const clock = kit.cyl(0.5, 0.5, 0.12, 12, kit.lambert(0xf7f3ea), 0, 5.6, 3.32);
  clock.rotation.x = Math.PI / 2;
  g.add(clock);
  win.grid('front', 9, 6, [-3.7, 3.7], [1.6, 3.3]);
  win.grid('back', 9, 6, span(5, -4.5, 4.5), [1.6, 3.3]);
  win.grid('left', 9, 6, span(3, -3, 3), [1.6, 3.3]);
  win.grid('right', 9, 6, span(3, -3, 3), [1.6, 3.3]);
  return { door: 3.1, height: 7.2, hit: [10.5, 8, 9] as const };
}

function buildData(kit: Kit, g: THREE.Group, win: Windows, own: (c: number) => THREE.MeshLambertMaterial) {
  const body = own(0x4fa3a5);
  const upper = own(0x3e8789);
  const dark = own(0x1f4e5a);
  g.add(kit.box(7, 4, 6, body, 0, 2, 0));
  g.add(kit.box(7.1, 0.3, 6.1, dark, 0, 4.0, 0));
  const top = kit.box(5.2, 3.2, 4.6, upper, 0.9, 5.7, -0.4);
  top.rotation.y = 0.18;
  g.add(top);
  // Rooftop screen
  g.add(kit.box(0.15, 1.2, 0.15, dark, -2.4, 4.6, 2.1), kit.box(0.15, 1.2, 0.15, dark, -0.8, 4.6, 2.1));
  g.add(kit.box(2.6, 1.5, 0.15, dark, -1.6, 5.6, 2.1));
  const screen = kit.canvasTexture(256, 150, (ctx, w, h) => {
    ctx.fillStyle = '#0f2e36';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#7ee0d2';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(14, 40);
    for (const [px, py] of [[70, 55], [120, 75], [170, 95], [240, 110]]) ctx.lineTo(px, py);
    ctx.stroke();
  });
  const sp = new THREE.Mesh(kit.geo('plane', () => new THREE.PlaneGeometry(1, 1)), kit.track(new THREE.MeshBasicMaterial({ map: screen })));
  sp.scale.set(2.4, 1.3, 1);
  sp.position.set(-1.6, 5.6, 2.19);
  g.add(sp);
  // Dish
  const dish = new THREE.Mesh(
    kit.geo('dish', () => new THREE.SphereGeometry(0.8, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)),
    kit.lambert(0xe9eef0, { side: THREE.DoubleSide }),
  );
  dish.position.set(2.3, 7.7, -1);
  dish.rotation.x = Math.PI * 0.75;
  g.add(dish, kit.cyl(0.08, 0.08, 0.6, 5, dark, 2.3, 7.4, -1));
  g.add(kit.box(2.2, 2.6, 0.1, kit.lambert(0x17363f), 0, 1.3, 3.03));
  win.grid('front', 7, 6, [-2.7, -1.7, 1.7, 2.7], [1.5, 2.9], 0.7, 0.9);
  win.grid('back', 7, 6, span(5, -3.5, 3.5), [1.5, 2.9], 0.7, 0.9);
  win.grid('left', 7, 6, span(4, -3, 3), [1.5, 2.9], 0.7, 0.9);
  win.grid('right', 7, 6, span(4, -3, 3), [1.5, 2.9], 0.7, 0.9);
  return { door: 3.1, height: 8.4, hit: [8.5, 9, 7.5] as const };
}

function buildResearch(kit: Kit, g: THREE.Group, win: Windows, own: (c: number) => THREE.MeshLambertMaterial) {
  const body = own(0x9db58a);
  const band = own(0x5e7a52);
  const dome = own(0xe9dfc0);
  g.add(kit.cyl(4, 4.2, 5, 12, body, 0, 2.5, 0));
  g.add(kit.cyl(4.15, 4.15, 0.4, 12, band, 0, 5.1, 0));
  const d = new THREE.Mesh(
    kit.geo('dome', () => new THREE.SphereGeometry(3.9, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
    dome,
  );
  d.position.y = 5.25;
  g.add(d);
  const slit = kit.box(0.8, 3.2, 0.3, band, 0, 7.6, 2.0);
  slit.rotation.x = -0.75;
  g.add(slit);
  g.add(kit.box(3.4, 3.2, 2.2, body, 0, 1.6, 4.2));
  const ped = kit.prism(3.8, 0.9, 2.4, band);
  ped.position.set(0, 3.2, 4.2);
  g.add(ped);
  g.add(kit.box(1.6, 2.4, 0.1, kit.lambert(0x3a4a33), 0, 1.2, 5.32));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    if (Math.abs(Math.sin(a / 2)) < 0.3) continue; // leave the entrance clear
    for (const y of [2, 3.7]) win.add(Math.sin(a) * 4.05, y, Math.cos(a) * 4.05, a, 0.7, 0.9);
  }
  return { door: 5.4, height: 9.4, hit: [9.5, 10, 11] as const };
}

const BUILDERS = { consulting: buildConsulting, classroom: buildClassroom, data: buildData, research: buildResearch };

function makeBuilding(kit: Kit, id: ScenarioId, parent: THREE.Group): BuildingHandle {
  const group = new THREE.Group();
  const [x, z] = PLACES[id];
  group.position.set(x, 0, z);
  group.rotation.y = Math.atan2(-x, -z); // face the plaza centre
  parent.add(group);

  const bodyMats: BuildingHandle['bodyMats'] = [];
  const own = (c: number) => {
    const m = kit.lambert(c, { unique: true });
    bodyMats.push({ m, base: new THREE.Color(c) });
    return m;
  };
  const win = new Windows();
  const info = BUILDERS[id](kit, group, win, own);
  const windowMat = kit.lambert(0xcfe6ee, { unique: true, emissive: 0x000000 });
  group.add(win.build(kit, windowMat));

  const hit = kit.box(info.hit[0], info.hit[1], info.hit[2], kit.basic(0xffffff), 0, info.hit[1] / 2, 0.5);
  (hit.material as THREE.Material).visible = false;
  hit.userData.buildingId = id;
  group.add(hit);

  const ringMat = kit.basic(0xf2b634, { unique: true, opacity: 0.0, transparent: true });
  const ring = kit.ring(6.4, 7.3, 40, ringMat);
  ring.position.set(x, 0.06, z);
  parent.add(ring);

  const sparkle = new THREE.Mesh(kit.geo('spark', () => new THREE.OctahedronGeometry(0.5, 0)), kit.basic(0xffc94a));
  sparkle.position.y = info.height + 0.9;
  sparkle.visible = false;
  group.add(sparkle);

  const label = labelSprite(kit, NAMES[id]);
  label.position.set(x, labelY(info.height), z).addScaledVector(new THREE.Vector3(-x, 0, -z).normalize(), 3.5);
  parent.add(label);

  const toCenter = new THREE.Vector3(-x, 0, -z).normalize();
  const door = new THREE.Vector3(x, 0, z).addScaledVector(toCenter, info.door);
  return {
    id,
    name: NAMES[id],
    group,
    hit,
    door,
    toCenter,
    windowMat,
    bodyMats,
    ring,
    ringMat,
    sparkle,
    label,
    height: info.height,
    lit: false,
    lift: 0,
    liftTarget: 0,
    pulse: 0,
  };
}

/** Cheap smooth noise from layered sines: enough for colour variation, no texture needed. */
const field = (x: number, z: number) =>
  Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * 0.5 +
  Math.sin(z * 0.13 + x * 0.05) * 0.35 +
  Math.sin((x + z) * 0.31) * 0.15;

function lawnGeometry() {
  const g = new THREE.PlaneGeometry(260, 260, 64, 64).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const light = new THREE.Color(0xb7d69a);
  const deep = new THREE.Color(0x7fb07a);
  const warm = new THREE.Color(0xc9d58a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = field(x, z);
    c.copy(deep)
      .lerp(light, 0.5 + n * 0.5)
      .lerp(warm, Math.max(0, Math.sin(x * 0.05 - z * 0.04)) * 0.35);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Concentric stone paving drawn on a canvas, mapped onto the plaza's round top. */
function pavingTexture(kit: Kit) {
  return kit.canvasTexture(1024, 1024, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#d6cfc1';
    ctx.fillRect(0, 0, w, w);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let r0 = 40, ring = 0; r0 < c; r0 += 34, ring++) {
      const r1 = r0 + 34;
      const count = Math.max(6, Math.round((Math.PI * 2 * r0) / 70));
      const offset = ring % 2 ? 0.5 : 0;
      for (let k = 0; k < count; k++) {
        const a0 = ((k + offset) / count) * Math.PI * 2;
        const a1 = ((k + offset + 1) / count) * Math.PI * 2;
        const tone = 226 + Math.floor(rnd() * 28);
        ctx.fillStyle = `rgb(${tone},${tone - 4},${tone - 12})`;
        ctx.beginPath();
        ctx.arc(c, c, r1 - 2, a0 + 0.012, a1 - 0.012);
        ctx.arc(c, c, r0 + 2, a1 - 0.012, a0 + 0.012, true);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
}

/** Stylised water: drifting ripple bands, sparkles and a brighter rim, all in the shader. */
function waterMaterial(kit: Kit) {
  return kit.track(
    new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, night: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float time; uniform float night; varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float d = length(p) * 2.0;
          float ripple = sin(d * 26.0 - time * 3.2) * 0.5 + 0.5;
          float swirl = sin(p.x * 18.0 + time * 1.3) * sin(p.y * 16.0 - time * 1.1);
          vec3 deep = mix(vec3(0.16, 0.55, 0.66), vec3(0.06, 0.2, 0.32), night);
          vec3 shallow = mix(vec3(0.55, 0.86, 0.9), vec3(0.25, 0.5, 0.62), night);
          vec3 col = mix(deep, shallow, smoothstep(0.1, 1.0, d) * 0.6 + ripple * 0.25);
          float sparkle = smoothstep(0.82, 1.0, swirl * 0.5 + 0.5) * (1.0 - d * 0.5);
          col += vec3(1.0, 0.97, 0.88) * sparkle * mix(0.55, 0.35, night);
          col += vec3(0.9, 1.0, 1.0) * smoothstep(0.86, 1.0, d) * 0.25;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
}

/** Grass tufts and small flowers: two instanced draw calls for the whole lawn. */
function scatterPlants(kit: Kit, group: THREE.Group) {
  const spots: { x: number; z: number }[] = [];
  const blocked = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    if (r < 13.8) return true; // paving
    if ((Math.abs(x) < 2.6 || Math.abs(z) < 2.6) && r < 19) return true; // walkways
    for (const [bx, bz] of Object.values(PLACES)) if (Math.hypot(x - bx, z - bz) < 7.5) return true;
    return false;
  };
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (spots.length < 420) {
    const a = rnd() * Math.PI * 2;
    const r = 14 + Math.pow(rnd(), 1.6) * 50;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (!blocked(x, z)) spots.push({ x, z });
  }
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();
  const tufts = new THREE.InstancedMesh(kit.geo('tuft', () => new THREE.ConeGeometry(0.22, 0.75, 4)), kit.lambert(0xffffff), 300);
  const flowers = new THREE.InstancedMesh(kit.geo('flower', () => new THREE.IcosahedronGeometry(0.17, 0)), kit.lambert(0xffffff), 120);
  const petals = [0xffffff, 0xf2c14e, 0xe07a5f, 0xd9a6c9, 0xfff1b8];
  spots.forEach(({ x, z }, i) => {
    if (i < 300) {
      const s = 0.7 + rnd() * 0.7;
      tmp.position.set(x, 0.3 * s, z);
      tmp.rotation.set((rnd() - 0.5) * 0.4, rnd() * 3, (rnd() - 0.5) * 0.4);
      tmp.scale.set(s, s, s);
      tmp.updateMatrix();
      tufts.setMatrixAt(i, tmp.matrix);
      tufts.setColorAt(i, color.setHSL(0.26 + rnd() * 0.06, 0.38, 0.38 + rnd() * 0.12));
    } else {
      const k = i - 300;
      tmp.position.set(x, 0.22, z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(0.8 + rnd() * 0.6);
      tmp.updateMatrix();
      flowers.setMatrixAt(k, tmp.matrix);
      flowers.setColorAt(k, color.set(petals[k % petals.length]));
    }
  });
  group.add(tufts, flowers);
}

/** Ground, fountain, walkways, trees, benches, lamps, the four buildings and the guide. */
export function buildPlaza(kit: Kit): Plaza {
  const group = new THREE.Group();

  const grass = kit.lambert(0xffffff, { unique: true });
  grass.vertexColors = true;
  const paving = kit.lambert(0xffffff, { unique: true });
  paving.map = pavingTexture(kit);
  const pavingDark = kit.lambert(0xcfc6b6, { unique: true });
  const path = kit.lambert(0xd8cdbb, { unique: true });

  // Lawn: a gently undulating colour field so the grass doesn't read as one flat fill.
  const ground = new THREE.Mesh(kit.geo('ground', () => lawnGeometry()), grass);
  group.add(ground);
  group.add(kit.cyl(13, 13.4, 0.3, 48, paving, 0, 0.15, 0));
  const inner = kit.ring(6.8, 7.6, 40, pavingDark);
  inner.position.y = 0.31;
  group.add(inner);
  // Walkways from the plaza to each door
  group.add(kit.box(3.4, 0.28, 7, path, 0, 0.14, -15.5), kit.box(3.4, 0.28, 7, path, 0, 0.14, 15.5));
  group.add(kit.box(7, 0.28, 3.4, path, 15.5, 0.14, 0), kit.box(7, 0.28, 3.4, path, -15.5, 0.14, 0));
  scatterPlants(kit, group);

  // Fountain
  const stone = kit.lambert(0xbfb6a6);
  const water = waterMaterial(kit);
  group.add(kit.cyl(3.2, 3.4, 0.9, 20, stone, 0, 0.6, 0));
  const pool = new THREE.Mesh(kit.geo('pool', () => new THREE.CircleGeometry(2.9, 32).rotateX(-Math.PI / 2)), water);
  pool.position.y = 1.03;
  group.add(pool);
  group.add(kit.cyl(0.35, 0.45, 2.2, 8, stone, 0, 2.0, 0));
  group.add(kit.cyl(1.2, 0.5, 0.5, 14, stone, 0, 3.2, 0));
  const bowl = new THREE.Mesh(kit.geo('bowlwater', () => new THREE.CircleGeometry(1.08, 24).rotateX(-Math.PI / 2)), water);
  bowl.position.y = 3.46;
  group.add(bowl);
  const jet = kit.cyl(0.05, 0.28, 1.0, 8, kit.lambert(0xa9e3ee, { emissive: 0x3aa6bd, emissiveIntensity: 0.3 }), 0, 3.95, 0);
  group.add(jet);
  const rings = [0, 1, 2].map(() => {
    const m = kit.ring(0.92, 1.05, 24, kit.basic(0xffffff, { unique: true, opacity: 0.5, transparent: true }));
    m.position.y = 1.07;
    group.add(m);
    return m;
  });

  // Benches (two instanced parts) at the diagonals, facing the fountain
  const benchWood = kit.lambert(0xa0704a);
  const unitBox = kit.geo('box', () => new THREE.BoxGeometry(1, 1, 1));
  const seats = new THREE.InstancedMesh(unitBox, benchWood, 8);
  const backs = new THREE.InstancedMesh(unitBox, benchWood, 8);
  const tmp = new THREE.Object3D();
  [45, 135, 225, 315].forEach((deg, i) => {
    for (let k = 0; k < 2; k++) {
      const a = THREE.MathUtils.degToRad(deg + (k ? 12 : -12));
      const r = 10.2;
      tmp.position.set(Math.sin(a) * r, 0.75, Math.cos(a) * r);
      tmp.rotation.set(0, a, 0);
      tmp.scale.set(2.2, 0.18, 0.8);
      tmp.updateMatrix();
      seats.setMatrixAt(i * 2 + k, tmp.matrix);
      tmp.position.set(Math.sin(a) * (r + 0.4), 1.2, Math.cos(a) * (r + 0.4));
      tmp.scale.set(2.2, 0.7, 0.14);
      tmp.updateMatrix();
      backs.setMatrixAt(i * 2 + k, tmp.matrix);
    }
  });
  group.add(seats, backs);

  // Lamp posts
  const lampAngles = [25, 65, 115, 155, 205, 245, 295, 335];
  const poles = new THREE.InstancedMesh(kit.geo('pole', () => new THREE.CylinderGeometry(0.09, 0.12, 3.6, 6)), kit.lambert(0x2f3b38), lampAngles.length);
  const lampMat = kit.lambert(0xfff1c4, { unique: true, emissive: 0xffd36b, emissiveIntensity: 0.2 });
  const heads = new THREE.InstancedMesh(kit.geo('lamp', () => new THREE.IcosahedronGeometry(0.3, 0)), lampMat, lampAngles.length);
  lampAngles.forEach((deg, i) => {
    const a = THREE.MathUtils.degToRad(deg);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(1, 1, 1);
    tmp.position.set(Math.sin(a) * 12.4, 2.1, Math.cos(a) * 12.4);
    tmp.updateMatrix();
    poles.setMatrixAt(i, tmp.matrix);
    tmp.position.y = 4.05;
    tmp.updateMatrix();
    heads.setMatrixAt(i, tmp.matrix);
  });
  group.add(poles, heads);

  // Trees: trunks + two foliage tiers, all instanced
  const treeSpots: [number, number, number][] = [];
  const addTree = (deg: number, r: number, s: number) => {
    const a = THREE.MathUtils.degToRad(deg);
    treeSpots.push([Math.sin(a) * r, Math.cos(a) * r, s]);
  };
  for (const deg of [45, 135, 225, 315]) {
    addTree(deg - 10, 17, 1.1);
    addTree(deg + 12, 19, 0.9);
    addTree(deg, 24, 1.3);
    addTree(deg - 20, 30, 1.2);
    addTree(deg + 22, 33, 1.4);
  }
  for (let i = 0; i < 16; i++) addTree(i * 22.5 + 8, 42 + (i % 3) * 5, 1.5);
  const trunks = new THREE.InstancedMesh(kit.geo('trunk', () => new THREE.CylinderGeometry(0.2, 0.28, 1.6, 5)), kit.lambert(0x7a5a3e), treeSpots.length);
  const leafGeo = kit.geo('leaf', () => new THREE.ConeGeometry(1.5, 2.6, 7));
  const leaves1 = new THREE.InstancedMesh(leafGeo, kit.lambert(0x5f9e6e), treeSpots.length);
  const leaves2 = new THREE.InstancedMesh(leafGeo, kit.lambert(0x78b57f), treeSpots.length);
  treeSpots.forEach(([x, z, s], i) => {
    tmp.rotation.set(0, i, 0);
    tmp.scale.setScalar(s);
    tmp.position.set(x, 0.8 * s, z);
    tmp.updateMatrix();
    trunks.setMatrixAt(i, tmp.matrix);
    tmp.position.set(x, 2.6 * s, z);
    tmp.updateMatrix();
    leaves1.setMatrixAt(i, tmp.matrix);
    tmp.scale.setScalar(s * 0.72);
    tmp.position.set(x, 3.9 * s, z);
    tmp.updateMatrix();
    leaves2.setMatrixAt(i, tmp.matrix);
  });
  group.add(trunks, leaves1, leaves2);
  // Blob shadows under trees
  const blob = new THREE.InstancedMesh(kit.geo('treeblob', () => new THREE.CircleGeometry(1.6, 10).rotateX(-Math.PI / 2)), kit.basic(0x0b1a15, { opacity: 0.16 }), treeSpots.length);
  treeSpots.forEach(([x, z, s], i) => {
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(s);
    tmp.position.set(x, 0.03, z);
    tmp.updateMatrix();
    blob.setMatrixAt(i, tmp.matrix);
  });
  group.add(blob);

  const buildings = new Map<ScenarioId, BuildingHandle>();
  (Object.keys(PLACES) as ScenarioId[]).forEach((id) => buildings.set(id, makeBuilding(kit, id, group)));

  const guide = makeCharacter(kit, CHARACTERS.guide);
  guide.group.position.set(3.4, 0.3, 4.6);
  guide.group.rotation.y = Math.PI / 4;
  group.add(guide.group);

  const theme = (dark: boolean) => {
    grass.color.set(dark ? 0x56756a : 0xffffff);
    paving.color.set(dark ? 0x6d716b : 0xf1ebe0);
    water.uniforms.night.value = dark ? 1 : 0;
    pavingDark.color.set(dark ? 0x5a5e58 : 0xcfc6b6);
    path.color.set(dark ? 0x64675f : 0xd8cdbb);
    lampMat.emissiveIntensity = dark ? 1.4 : 0.2;
  };

  return { group, buildings, guide, rings, jet, water, theme };
}
