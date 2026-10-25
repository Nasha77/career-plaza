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
  animate?: (t: number) => void;
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
  resort: [0, -DIST],
  policy: [DIST, 0],
  foundation: [0, DIST],
  workforce: [-DIST, 0],
};
const NAMES: Record<ScenarioId, string> = {
  resort: 'Harbourfront Resort',
  policy: 'Climate Policy Association',
  foundation: 'Community Foundation',
  workforce: 'Workforce Strategy Hub',
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
    let size = 58;
    ctx.font = `800 ${size}px ${DISPLAY_FONT}`;
    while (ctx.measureText(text).width > w - 84 && size > 30) {
      size -= 2;
      ctx.font = `800 ${size}px ${DISPLAY_FONT}`;
    }
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

type Own = (c: number) => THREE.MeshLambertMaterial;
interface BuildInfo {
  door: number;
  height: number;
  hit: readonly [number, number, number];
  /** Small looping motion (turbine blades, a scrolling ticker). Called every frame when motion is allowed. */
  animate?: (t: number) => void;
}

/** Low-poly palm: a leaning trunk and drooping fronds. */
function palm(kit: Kit, g: THREE.Group, x: number, z: number, h = 3.4, lean = 0.12) {
  const p = new THREE.Group();
  p.position.set(x, 0, z);
  p.rotation.z = lean;
  p.add(kit.cyl(0.13, 0.2, h, 6, kit.lambert(0x8a6a48), 0, h / 2, 0));
  const frond = kit.lambert(0x4f9a5c);
  for (let i = 0; i < 6; i++) {
    const f = kit.box(1.7, 0.06, 0.4, frond);
    const a = (i / 6) * Math.PI * 2;
    f.position.set(Math.cos(a) * 0.7, h + 0.05, Math.sin(a) * 0.7);
    f.rotation.set(0, -a, -0.45);
    p.add(f);
  }
  p.add(kit.sphere(0.22, 0, kit.lambert(0x6b4a2e), 0, h, 0));
  g.add(p);
}

function buildResort(kit: Kit, g: THREE.Group, win: Windows, own: Own): BuildInfo {
  const body = own(0xe6d2ae);
  const trim = own(0x2f6f6a);
  const white = own(0xf4f1ea);
  g.add(kit.box(6.6, 0.6, 5.6, trim, 0, 0.3, 0));
  g.add(kit.box(6, 11, 5, body, 0, 5.5, 0));
  // Balcony bands give the tower its hotel look
  for (let y = 3.2; y <= 10.4; y += 1.2) {
    g.add(kit.box(6.3, 0.12, 0.5, white, 0, y, 2.7), kit.box(6.3, 0.12, 0.5, white, 0, y, -2.7));
  }
  // Rooftop garden deck with a curved canopy
  g.add(kit.box(6.4, 0.3, 5.4, trim, 0, 11.15, 0));
  const canopy = kit.cyl(3.4, 3.4, 0.25, 16, white, 0, 13.2, 0);
  canopy.scale.set(1, 1, 0.75);
  g.add(canopy);
  for (const [x, z] of [[-2.4, -1.6], [2.4, -1.6], [-2.4, 1.6], [2.4, 1.6]]) g.add(kit.cyl(0.12, 0.12, 1.9, 6, trim, x, 12.2, z));
  g.add(kit.sphere(0.6, 0, kit.lambert(0x5f9e6e), -1.2, 11.7, 0.6), kit.sphere(0.5, 0, kit.lambert(0x78b57f), 1.3, 11.6, -0.5));
  // Entrance canopy and door
  g.add(kit.box(3.2, 0.18, 1.4, trim, 0, 2.9, 3.1));
  g.add(kit.box(1.8, 2.5, 0.1, kit.lambert(0x1f4e4a), 0, 1.25, 2.53));

  // Pool deck to one side, with loungers, a parasol and palms
  const deck = kit.lambert(0xd9cbb2);
  g.add(kit.box(4.2, 0.35, 5.2, deck, -5.3, 0.17, 0.4));
  g.add(kit.box(3.2, 0.1, 2.6, kit.lambert(0x55c2d6, { emissive: 0x2b8fa3, emissiveIntensity: 0.25 }), -5.3, 0.37, 0.0));
  for (const z of [1.9, 2.6]) g.add(kit.box(1.4, 0.18, 0.5, white, -5.6, 0.48, z));
  g.add(kit.cyl(0.04, 0.04, 1.5, 5, trim, -4.2, 1.1, 2.3));
  g.add(kit.cyl(0.0, 0.9, 0.4, 8, kit.lambert(0xe07a5f), -4.2, 1.95, 2.3));
  palm(kit, g, -6.8, -1.6, 3.6, 0.15);
  palm(kit, g, -6.6, 2.6, 3.0, -0.1);
  palm(kit, g, 4.1, 2.2, 3.2, -0.12);

  // Harbour behind the resort: water, a boardwalk edge and a small sailboat
  const water = kit.lambert(0x4fa8c4, { emissive: 0x1d6f8a, emissiveIntensity: 0.2 });
  g.add(kit.box(16, 0.08, 6, water, 0, 0.05, -7.6));
  g.add(kit.box(16, 0.3, 0.8, kit.lambert(0xa98d6b), 0, 0.15, -4.4));
  const boat = new THREE.Group();
  boat.position.set(3.5, 0.15, -8.2);
  boat.add(kit.box(2.0, 0.35, 0.7, white, 0, 0.15, 0));
  boat.add(kit.cyl(0.04, 0.04, 2.2, 5, kit.lambert(0x6b4a2e), 0.1, 1.4, 0));
  const sail = kit.prism(1.2, 1.8, 0.04, kit.lambert(0xfff8ec));
  sail.position.set(0.5, 0.45, 0);
  boat.add(sail);
  g.add(boat);

  const cols = span(4, -3, 3);
  const rows = span(7, 3.4, 10.8);
  win.grid('front', 6, 5, cols, rows);
  win.grid('back', 6, 5, cols, rows);
  win.grid('left', 6, 5, span(3, -2.5, 2.5), rows);
  win.grid('right', 6, 5, span(3, -2.5, 2.5), rows);
  return {
    door: 2.6,
    height: 14.8,
    hit: [8, 15, 7] as const,
    animate: (t) => {
      boat.position.y = 0.15 + Math.sin(t * 1.3) * 0.06;
      boat.rotation.z = Math.sin(t * 0.9) * 0.05;
    },
  };
}

function buildPolicy(kit: Kit, g: THREE.Group, win: Windows, own: Own): BuildInfo {
  const body = own(0xc7c6b6);
  const roof = own(0x4a5560);
  const stone = own(0xf1ece2);
  g.add(kit.box(9, 4.6, 6, body, 0, 2.3, 0));
  const r = kit.prism(9.8, 2.1, 6.6, roof);
  r.position.y = 4.6;
  g.add(r);
  // Solar panels on one roof slope
  const panel = kit.lambert(0x23376b, { emissive: 0x16244a, emissiveIntensity: 0.3 });
  const slope = Math.atan2(2.1, 4.9);
  for (const z of [-2.0, 0, 2.0]) {
    const p = kit.box(2.6, 0.08, 1.7, panel, 2.35, 5.72, z);
    p.rotation.z = -slope;
    g.add(p);
  }
  // Columned porch
  g.add(kit.box(6.2, 0.3, 2.2, stone, 0, 0.15, 4.0));
  for (const x of [-2.4, -0.8, 0.8, 2.4]) g.add(kit.cyl(0.22, 0.26, 3.8, 8, stone, x, 2.2, 4.6));
  g.add(kit.box(6.6, 0.35, 2.4, stone, 0, 4.25, 4.0));
  const ped = kit.prism(6.6, 1.2, 0.5, stone);
  ped.position.set(0, 4.42, 5.0);
  g.add(ped);
  g.add(kit.box(1.6, 2.6, 0.1, kit.lambert(0x5b3a2e), 0, 1.3, 3.03));
  // A leaf emblem instead of a clock
  const emblem = kit.cyl(0.5, 0.5, 0.12, 12, kit.lambert(0x5f9e6e), 0, 5.6, 3.32);
  emblem.rotation.x = Math.PI / 2;
  g.add(emblem);
  // Planters along the front
  const planter = kit.lambert(0x8f9a8b);
  const leaf = kit.lambert(0x5f9e6e);
  for (const x of [-4.0, 4.0]) {
    g.add(kit.box(1.0, 0.6, 1.6, planter, x, 0.3, 3.6));
    g.add(kit.sphere(0.55, 0, leaf, x, 0.95, 3.6));
  }
  // Flagpole with a green flag
  g.add(kit.cyl(0.05, 0.05, 6.5, 5, kit.lambert(0xdedede), -4.8, 3.25, 4.6));
  const flag = kit.box(1.2, 0.7, 0.04, kit.lambert(0x4f9a5c), -4.2, 6.1, 4.6);
  g.add(flag);

  // Small wind turbine beside the building
  const turbine = new THREE.Group();
  turbine.position.set(6.4, 0, 0.5);
  turbine.add(kit.cyl(0.12, 0.2, 7.2, 8, kit.lambert(0xf2f2ee), 0, 3.6, 0));
  turbine.add(kit.box(0.5, 0.4, 0.9, kit.lambert(0xf2f2ee), 0, 7.3, 0));
  const rotor = new THREE.Group();
  rotor.position.set(0, 7.3, 0.55);
  for (let i = 0; i < 3; i++) {
    const blade = kit.box(0.18, 2.6, 0.06, kit.lambert(0xffffff), 0, 1.3, 0);
    const arm = new THREE.Group();
    arm.rotation.z = (i / 3) * Math.PI * 2;
    arm.add(blade);
    rotor.add(arm);
  }
  rotor.add(kit.sphere(0.18, 0, kit.lambert(0xdedede)));
  turbine.add(rotor);
  g.add(turbine);

  win.grid('front', 9, 6, [-3.7, 3.7], [1.6, 3.3]);
  win.grid('back', 9, 6, span(5, -4.5, 4.5), [1.6, 3.3]);
  win.grid('left', 9, 6, span(3, -3, 3), [1.6, 3.3]);
  win.grid('right', 9, 6, span(3, -3, 3), [1.6, 3.3]);
  return {
    door: 3.1,
    height: 8.5,
    hit: [13, 9, 9] as const,
    animate: (t) => {
      rotor.rotation.z = t * 1.4;
      flag.rotation.y = Math.sin(t * 2.2) * 0.15;
    },
  };
}

function buildFoundation(kit: Kit, g: THREE.Group, win: Windows, own: Own): BuildInfo {
  // A row of three two-storey shophouses in warm pastels, joined by a covered walkway
  const bays: [number, number, number][] = [
    [-2.7, 0xf2c6a8, 0x2f6f6a],
    [0, 0xbfe0cf, 0x8c3b4a],
    [2.7, 0xf6e3a6, 0x3d7ea6],
  ];
  const cream = own(0xf7f1e6);
  const roofTile = own(0xb5694a);
  bays.forEach(([x, wall, shutter]) => {
    const w = own(wall);
    g.add(kit.box(2.7, 6.2, 6, w, x, 3.1, 0));
    // Upper-floor windows framed by coloured shutters
    for (const dx of [-0.55, 0.55]) {
      g.add(kit.box(0.22, 1.3, 0.08, kit.lambert(shutter), x + dx * 1.55, 4.6, 3.05));
    }
    g.add(kit.box(2.7, 0.3, 6.2, cream, x, 6.35, 0));
  });
  // Tiled roof with its ridge running along the row
  const roof = kit.prism(6.2, 1.2, 8.4, roofTile);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = 6.5;
  g.add(roof);

  // Covered five-foot way: slab, pillars and striped awnings
  g.add(kit.box(8.4, 0.25, 1.8, cream, 0, 2.95, 3.9));
  for (const x of [-4.05, -1.35, 1.35, 4.05]) g.add(kit.cyl(0.14, 0.16, 2.9, 8, cream, x, 1.45, 4.6));
  const stripes = kit.canvasTexture(128, 64, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#e07a5f';
      ctx.fillRect((i * w) / 8, 0, w / 8, h);
    }
  });
  const awningMat = kit.track(new THREE.MeshLambertMaterial({ map: stripes, side: THREE.DoubleSide }));
  bays.forEach(([x]) => {
    const a = new THREE.Mesh(kit.geo('plane', () => new THREE.PlaneGeometry(1, 1)), awningMat);
    a.scale.set(2.3, 0.9, 1);
    a.position.set(x, 3.75, 3.4);
    a.rotation.x = -0.9;
    g.add(a);
  });
  g.add(kit.box(1.4, 2.4, 0.1, kit.lambert(0x5b3a2e), 0, 1.2, 3.03));

  // Bunting across the front
  const flagColors = [0xe07a5f, 0xf2c14e, 0x5f9e6e, 0x3d7ea6, 0xd9a6c9];
  for (let i = 0; i < 11; i++) {
    const f = kit.cyl(0.0, 0.22, 0.42, 3, kit.lambert(flagColors[i % flagColors.length]), -4 + i * 0.8, 5.55 - Math.sin((i / 10) * Math.PI) * 0.35, 3.3);
    f.rotation.x = Math.PI;
    g.add(f);
  }

  // Community garden in front: raised beds with plants
  const bed = kit.lambert(0x8a6a48);
  for (const [x, z] of [[-5.6, 2.6], [5.6, 2.6]]) {
    g.add(kit.box(1.4, 0.5, 2.2, bed, x, 0.25, z));
    for (const dz of [-0.6, 0, 0.6]) g.add(kit.sphere(0.3, 0, kit.lambert(dz === 0 ? 0xf2c14e : 0x5f9e6e), x, 0.7, z + dz));
  }

  // Mural on the side wall: overlapping circles and a heart, painted by the community
  const mural = kit.canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fbf3e4';
    ctx.fillRect(0, 0, w, h);
    const dots: [number, number, number, string][] = [
      [70, 80, 50, '#e07a5f'],
      [170, 90, 60, '#3d7ea6'],
      [110, 170, 55, '#f2c14e'],
      [200, 190, 40, '#5f9e6e'],
    ];
    ctx.globalAlpha = 0.85;
    for (const [x, y, r, c] of dots) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#c4462a';
    ctx.beginPath();
    ctx.moveTo(128, 150);
    ctx.bezierCurveTo(90, 120, 95, 85, 128, 100);
    ctx.bezierCurveTo(161, 85, 166, 120, 128, 150);
    ctx.fill();
  });
  const m = new THREE.Mesh(kit.geo('plane', () => new THREE.PlaneGeometry(1, 1)), kit.track(new THREE.MeshLambertMaterial({ map: mural })));
  m.scale.set(4.4, 4.4, 1);
  m.position.set(4.06, 3.3, -0.4);
  m.rotation.y = Math.PI / 2;
  g.add(m);

  win.grid('front', 8.1, 6, [-2.7, 0, 2.7], [4.6], 1.0, 1.3);
  win.grid('front', 8.1, 6, [-3.5, -1.9, 1.9, 3.5], [1.3], 0.8, 1.1);
  win.grid('back', 8.1, 6, span(6, -3.9, 3.9), [1.6, 4.6], 0.8, 1.1);
  win.grid('left', 8.1, 6, span(3, -2.5, 2.5), [1.6, 4.6], 0.8, 1.1);
  return { door: 3.1, height: 7.7, hit: [12.5, 8.5, 8] as const };
}

function buildWorkforce(kit: Kit, g: THREE.Group, win: Windows, own: Own): BuildInfo {
  const glass = own(0x8fb9cf);
  const band = own(0xf2f4f5);
  const dark = own(0x2a3a44);
  g.add(kit.cyl(4.3, 4.5, 0.5, 20, dark, 0, 0.25, 0));
  g.add(kit.cyl(3.6, 3.8, 11, 20, glass, 0, 5.75, 0));
  for (let y = 2.0; y <= 10.5; y += 1.7) g.add(kit.cyl(3.7, 3.7, 0.18, 20, band, 0, y, 0));
  // Scrolling news ticker band
  const ticker = kit.canvasTexture(1024, 64, (ctx, w, h) => {
    ctx.fillStyle = '#0f2a30';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7ee0d2';
    ctx.font = `800 40px ${DISPLAY_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('FUTURE OF WORK  •  SKILLS  •  AI  •  PEOPLE  •  TRAINING  •  ', 10, h / 2 + 2);
  });
  ticker.wrapS = THREE.RepeatWrapping;
  ticker.repeat.set(2, 1);
  const tickerMesh = new THREE.Mesh(
    kit.geo('ticker', () => new THREE.CylinderGeometry(3.72, 3.72, 0.8, 32, 1, true)),
    kit.track(new THREE.MeshBasicMaterial({ map: ticker })),
  );
  tickerMesh.position.y = 8.6;
  g.add(tickerMesh);
  // Crown: halo ring and antenna
  g.add(kit.cyl(2.8, 3.6, 0.6, 20, dark, 0, 11.55, 0));
  const halo = new THREE.Mesh(kit.geo('halo', () => new THREE.TorusGeometry(2.4, 0.12, 6, 32)), kit.lambert(0x7ee0d2, { emissive: 0x3aa69a, emissiveIntensity: 0.6 }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 12.4;
  g.add(halo);
  g.add(kit.cyl(0.06, 0.06, 2.4, 5, band, 0, 13.0, 0));
  // Glass entrance pavilion
  g.add(kit.box(3.6, 3.0, 2.4, glass, 0, 1.5, 4.2));
  g.add(kit.box(4.2, 0.2, 3.0, band, 0, 3.1, 4.3));
  g.add(kit.box(1.6, 2.3, 0.1, kit.lambert(0x1d2b33), 0, 1.15, 5.42));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    if (Math.abs(Math.sin(a / 2)) < 0.28) continue; // keep the entrance clear
    for (const y of [2.9, 4.6, 6.3, 10.0]) win.add(Math.sin(a) * 3.72, y, Math.cos(a) * 3.72, a, 0.8, 1.0);
  }
  return {
    door: 5.5,
    height: 13.5,
    hit: [9, 14, 11] as const,
    animate: (t) => {
      ticker.offset.x = -(t * 0.04) % 1;
      halo.rotation.z = t * 0.3;
    },
  };
}

const BUILDERS = { resort: buildResort, policy: buildPolicy, foundation: buildFoundation, workforce: buildWorkforce };

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
    animate: info.animate,
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
