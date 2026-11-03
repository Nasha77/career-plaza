import * as THREE from 'three';
import type { ScenarioId } from '../../types';
import { fade, reducedMotion, type BodyAction, type Marker, type Mood, type RoomSetup, type ThingId, type Who, type World } from '../types';
import { Actor } from './actor';
import { buildAtmosphere, type Atmosphere } from './atmosphere';
import { Emote } from './emotes';
import { Kit } from './kit';
import { lobbyModels, modelsFor } from './layouts';
import { castFor, extraLook, PLAYER_LOOKS } from '../cast';
import { STROLLERS, dressCampus, policyHall, shophouses, type ClassicBuilding } from './campus';
import { preload, spawn, spawnCharacter } from './models';
import { buildRoom, disposeRoom, type Room } from './room';
import { LABEL_H, LABEL_W, buildPlaza, labelY, type BuildingHandle, type Plaza } from './plaza';

interface Tween {
  start: number;
  dur: number;
  step: (k: number) => void;
  done: () => void;
}

/** Light theme is a late-afternoon golden hour; dark theme is a moonlit night. */
const SKY = {
  light: {
    top: 0x5d9fd6, horizon: 0xf6dcb6, bottom: 0x9cc48a,
    hemiSky: 0xdfeaff, hemiGround: 0x8f9a66, hemi: 1.7,
    sun: 3.4, sunColor: 0xffd7a6, glow: 0xffcf8a, glowSize: 1, interior: 0x231c15,
  },
  dark: {
    top: 0x060d1c, horizon: 0x1f3047, bottom: 0x2e4636,
    hemiSky: 0x8ea3cf, hemiGround: 0x2c3a33, hemi: 1.9,
    sun: 1.9, sunColor: 0xa9bcff, glow: 0xcfdcff, glowSize: 0.35, interior: 0x14211d,
  },
};
/** Low sun from the west-south-west, so shadows fall long across the plaza. */
const SUN_DIR = new THREE.Vector3(-0.72, 0.42, 0.55).normalize();

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp = THREE.MathUtils.clamp;
const DEG = Math.PI / 180;
/** The room camera's angle from the front; conversations are framed from the same side. */
const TALK_AZ = 0;

export class World3D implements World {
  readonly mode = '3d' as const;
  onPick: ((id: ScenarioId) => void) | null = null;
  onHover: ((id: ScenarioId | null) => void) | null = null;
  onThing: ((id: ThingId) => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);
  private kit = new Kit();
  private plaza: Plaza;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fog: THREE.Fog;
  private atmosphere: Atmosphere;
  private lowPower: boolean;
  private intro = 0;
  private parallax = new THREE.Vector2();
  private parallaxTarget = new THREE.Vector2();
  private lastLift = 0;
  private room: Room | null = null;
  private lastBuilding: BuildingHandle | null = null;

  private state: 'plaza' | 'moving' | 'interior' = 'plaza';
  private visited = new Set<ScenarioId>();
  private pointerHover: ScenarioId | null = null;
  private uiHover: ScenarioId | null = null;
  private talking: 'guide' | Who | null = null;
  private roomDown: { x: number; y: number } | null = null;
  // Inside a room
  private free = false;
  private focusId: ThingId | null = null;
  private labels: Partial<Record<ThingId, string>> = {};
  private hoverThing: ThingId | null = null;
  private labelEl: HTMLElement;
  private hoverRing: THREE.Mesh;
  private spotMarks = new Map<ThingId, Emote>();
  private keys = new Set<string>();
  private keyboardLast = false;
  private walkToken = 0;
  private shadowTick = 0;
  /** Kenney people on the plaza: the guide (first) and a few passers-by. */
  private plazaPeople: Actor[] = [];
  private playerLook = PLAYER_LOOKS[0];
  private castToken = 0;
  private strollStep: number[] = [];
  private active = true;
  private raf = 0;
  private last = 0;
  private time = 0;
  private needsRender = true;
  private tweens: Tween[] = [];
  private dark = false;

  // Camera state
  private target = new THREE.Vector3(0, 1.5, 0);
  private orbitPhase = 0;
  private az = 0; // user nudge, radians
  private pol = 0;
  private zoom = 0;

  // Pointer state
  private pointers = new Map<number, { x: number; y: number }>();
  private dragFrom = { x: 0, y: 0, az: 0, pol: 0 };
  private moved = false;
  private pinch = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pickables: THREE.Object3D[] = [];

  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private veil: HTMLElement) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.5, powerPreference: 'high-performance' });
    if (!this.renderer.getContext()) throw new Error('No WebGL context');
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // One soft shadow map, rendered only when something changes (not every frame).
    this.lowPower = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    // Gradient sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        glow: { value: new THREE.Color() },
        glowSize: { value: 1 },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 glow;
        uniform float glowSize; uniform vec3 sunDir; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, bottom, min(1.0, -h * 4.0));
          float s = max(dot(d, sunDir), 0.0);
          // Wide warm haze, a tighter halo and the disc itself.
          c += glow * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6) * glowSize;
          c = mix(c, vec3(1.0, 0.98, 0.92), smoothstep(0.9993 - 0.0004 * glowSize, 0.9996, s));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), this.skyMat);
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8aa37a, 2);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(70);
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.mapSize.setScalar(this.lowPower ? 1024 : 2048);
    shadow.camera.left = shadow.camera.bottom = -42;
    shadow.camera.right = shadow.camera.top = 42;
    shadow.camera.near = 10;
    shadow.camera.far = 160;
    shadow.bias = -0.0006;
    shadow.normalBias = 0.04;
    shadow.radius = 4;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.fog = new THREE.Fog(0xe6f0ea, 120, 320);
    this.scene.fog = this.fog;

    this.plaza = buildPlaza(this.kit);
    prepareForLighting(this.plaza.group);
    this.atmosphere = buildAtmosphere(this.kit, this.lowPower);
    this.plaza.group.add(this.atmosphere.group);
    this.scene.add(this.plaza.group);
    // Open with a slow sweep down onto the plaza.
    this.intro = reducedMotion() ? 0 : 1;
    this.plaza.buildings.forEach((b) => {
      b.hit.userData.buildingId = b.id;
      b.label.userData.buildingId = b.id;
      this.pickables.push(b.hit, b.label);
    });
    this.applyLit();

    // The plaza is always in daytime, whatever the device's light or dark setting.
    // (The HTML panels still follow the device theme.)
    this.applyTheme(false);

    // Size
    const onResize = () => this.resize();
    this.listen(window, 'resize', onResize);
    this.listen(window, 'orientationchange', onResize);
    this.resize();

    // Input
    this.listen(canvas, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    this.listen(canvas, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    this.listen(canvas, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    this.listen(canvas, 'pointercancel', (e) => this.pointers.delete((e as PointerEvent).pointerId));
    this.listen(canvas, 'pointerleave', () => this.setPointerHover(null));
    this.listen(canvas, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });

    // Pause when the tab is hidden
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.stop();
      else if (this.active) this.start();
    });

    // Redraw text on signs once the web fonts are ready
    document.fonts?.ready.then(() => {
      this.kit.refreshCanvases();
      this.needsRender = true;
    });

    // Hover label and ring for things in a room
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'room-label';
    this.labelEl.hidden = true;
    this.labelEl.setAttribute('aria-hidden', 'true');
    canvas.parentElement?.append(this.labelEl);
    this.hoverRing = new THREE.Mesh(
      this.kit.geo('hoverRing', () => new THREE.RingGeometry(0.95, 1.2, 40).rotateX(-Math.PI / 2)),
      this.kit.basic(0xffffff, { opacity: 0.85 }),
    );
    this.hoverRing.visible = false;
    this.hoverRing.renderOrder = 2;
    this.scene.add(this.hoverRing);
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.keys.clear());

    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
    this.start();
    if (import.meta.env.DEV) (window as unknown as { __world: World3D }).__world = this;
    void this.dressPlaza();
  }

  /**
   * Swap the plaza's code-built guide for a Kenney character, add a few people strolling by the
   * fountain, and plant Kenney trees. If the models don't load, the code-built ones simply stay.
   */
  private async dressPlaza() {
    try {
      await Promise.all([
        this.setPlayerLook(this.playerLook),
        this.plantKenney(),
        this.skinBuildings(),
        dressCampus(this.kit, this.plaza.group).then(() => {
          prepareForLighting(this.plaza.group);
          this.renderer.shadowMap.needsUpdate = true;
          this.needsRender = true;
        }),
      ]);
    } catch (err) {
      console.warn('Some campus models did not load', err);
    }
  }

  /**
   * Who the player is. The guide (a main character) is cast so nobody else looks like the player;
   * the people strolling around are background extras in their own colours.
   */
  async setPlayerLook(look: string): Promise<void> {
    this.playerLook = look;
    const token = ++this.castToken;
    const guideLook = castFor(look).plaza[0];
    const looks = [guideLook, ...STROLLERS.map((_, i) => extraLook(200 + i, look))];
    const models = await Promise.all(looks.map((l) => spawnCharacter(l, 0.9)));
    if (token !== this.castToken) return;
    this.plazaPeople.forEach((a) => {
      a.group.removeFromParent();
      a.dispose();
    });
    const guidePos = this.plaza.guide.group.position;
    this.plazaPeople = models.map((sp, i) => {
      const a = new Actor(sp);
      if (i === 0) a.place(guidePos.x, guidePos.z, this.plaza.guide.group.rotation.y);
      else {
        const st = STROLLERS[i - 1];
        a.place(st.at[0], st.at[1], st.r);
      }
      a.group.position.y = 0.3;
      this.plaza.group.add(a.group);
      return a;
    });
    this.strollStep = STROLLERS.map(() => 0);
    this.plaza.guide.group.visible = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  /** Strollers walk their loops along the paths (and stand still with reduced motion). */
  private updateStrollers(dt: number, motion: boolean) {
    STROLLERS.forEach((st, i) => {
      const a = this.plazaPeople[i + 1];
      if (!a) return;
      if (motion && st.route.length && !a.walking) {
        const k = (this.strollStep[i] = (this.strollStep[i] + 1) % st.route.length);
        void a.walk([st.route[k]]);
      }
      a.update(dt, motion);
      a.group.position.y = 0.3;
    });
    this.plazaPeople[0]?.update(dt, motion);
  }

  /**
   * Kenney buildings in place of the code-built bodies. The towers are modern (Foxbury); the
   * policy hall with its clock tower and the shophouse row are classic (Britechester), built from
   * Fantasy Town and Castle Kit pieces. Each keeps the details that say what it is.
   */
  private async skinBuildings() {
    type Part = { m: string; x: number; z: number; w: number; d: number; h: number };
    const TOWERS: Partial<Record<ScenarioId, Part[]>> = {
      resort: [{ m: 'city/building-j', x: 0, z: 0, w: 7, d: 5.6, h: 13 }],
      workforce: [{ m: 'city/building-skyscraper-a', x: 0, z: 0, w: 7, d: 7, h: 13.5 }],
    };
    const swap = (b: BuildingHandle, height: number) => {
      b.group.getObjectByName('core')!.visible = false;
      b.group.getObjectByName('windows')!.visible = false;
      b.height = height;
    };
    const towers = Object.entries(TOWERS) as [ScenarioId, Part[]][];
    const loaded = await Promise.all(towers.map(([, parts]) => Promise.all(parts.map((p) => spawn(p.m)))));
    towers.forEach(([id, parts], bi) => {
      const b = this.plaza.buildings.get(id);
      if (!b) return;
      let top = 0;
      parts.forEach((p, i) => {
        const sp = loaded[bi][i];
        // Fit the footprint and height exactly (the blocky Kenney buildings stretch well).
        sp.object.scale.set(p.w / sp.size.x, p.h / sp.size.y, p.d / sp.size.z);
        sp.object.position.set(p.x, 0, p.z);
        top = Math.max(top, p.h);
        // Own materials per building, so it can be dimmed until visited
        sp.object.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const m = (mesh.material as THREE.MeshStandardMaterial).clone();
          b.bodyMats.push({ m, base: m.color.clone() });
          mesh.material = m;
        });
        b.group.add(sp.object);
      });
      swap(b, top + 1);
    });
    const classic: [ScenarioId, Promise<ClassicBuilding>][] = [
      ['policy', policyHall(this.kit)],
      ['foundation', shophouses(this.kit)],
    ];
    for (const [id, build] of classic) {
      const b = this.plaza.buildings.get(id);
      const c = await build;
      if (!b) continue;
      c.mats.forEach((m) => {
        const mm = m as THREE.MeshLambertMaterial;
        if (mm.color) b.bodyMats.push({ m: mm, base: mm.color.clone() });
      });
      b.group.add(c.group);
      swap(b, c.height);
    }
    prepareForLighting(this.plaza.group);
    this.applyLit();
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  /** Kenney trees in place of the code-built ones (same spots, same blob shadows). */
  private async plantKenney() {
    const kinds = ['nature/tree', 'nature/tree-tall', 'nature/tree', 'nature/tree-autumn'];
    const trees = await Promise.all(this.plaza.treeSpots.map((_, i) => spawn(kinds[i % kinds.length], 1.25)));
    this.plaza.treeSpots.forEach(([x, z, s], i) => {
      const o = trees[i].object;
      o.position.set(x, 0, z);
      o.rotation.y = i * 1.7;
      o.scale.setScalar(s);
      this.plaza.group.add(o);
    });
    this.plaza.stand.forEach((o) => (o.visible = false));
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opts);
    this.cleanup.push(() => t.removeEventListener(type, fn, opts));
  }

  // ---- Public API -----------------------------------------------------------

  setVisited(ids: ScenarioId[]): void {
    this.visited = new Set(ids);
    this.applyLit();
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  setHover(id: ScenarioId | null): void {
    this.uiHover = id;
    this.needsRender = true;
  }

  setTalking(who: 'guide' | Who | null): void {
    this.talking = who;
    if (this.room) {
      this.room.player.talking = who === 'player';
      this.room.actors.forEach((a, id) => (a.talking = who === id));
    }
    this.needsRender = true;
  }

  // ---- Inside a room ----

  private actorFor(who: Who): Actor | undefined {
    if (!this.room) return undefined;
    return who === 'player' ? this.room.player : this.room.actors.get(who as ThingId);
  }

  setFree(free: boolean): void {
    this.free = free;
    if (!free) {
      this.keys.clear();
      this.setHoverThing(null);
    }
  }

  async goTo(id: ThingId): Promise<void> {
    const r = this.room;
    const pos = r?.things.get(id);
    if (!r || !pos) return;
    const token = ++this.walkToken;
    const p = r.player.group.position;
    // Stand beside a person (left or right as the camera sees it), so a conversation is side by side.
    let goal: [number, number] = [pos.x, pos.z];
    if (r.actors.has(id)) {
      const rx = Math.cos(TALK_AZ);
      const rz = -Math.sin(TALK_AZ);
      const sides: [number, number][] = [1, -1]
        .map((k) => [pos.x + rx * 2.2 * k, pos.z + rz * 2.2 * k] as [number, number])
        .filter(([x, z]) => r.grid.free(x, z))
        .sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(b[0] - p.x, b[1] - p.z));
      if (sides[0]) goal = sides[0];
    }
    const path = r.grid.path([p.x, p.z], goal);
    if (path?.length) {
      const walk = r.player.walk(path);
      if (reducedMotion()) r.player.finishWalk();
      await walk;
    }
    if (token !== this.walkToken) return;
    r.player.face(pos.x, pos.z);
  }

  /** Click on something: walk over, then tell the game (unless another click came first). */
  private async approach(id: ThingId) {
    const token = this.walkToken + 1;
    await this.goTo(id);
    if (token === this.walkToken && this.free) this.onThing?.(id);
  }

  private walkToPoint(x: number, z: number) {
    const r = this.room;
    if (!r) return;
    ++this.walkToken;
    const p = r.player.group.position;
    const path = r.grid.path([p.x, p.z], [x, z]);
    if (path?.length) {
      void r.player.walk(path);
      if (reducedMotion()) r.player.finishWalk();
    }
  }

  focus(id: ThingId | null): void {
    this.focusId = id;
    const r = this.room;
    if (!r) return;
    const a = id ? r.actors.get(id) : undefined;
    const pos = id ? r.things.get(id) : undefined;
    // Face each other, turned partly toward the camera so both faces show, as in Animal Crossing.
    if (pos) r.player.face(pos.x, pos.z, TALK_AZ, a ? 0.5 : 0);
    if (a) a.face(r.player.group.position.x, r.player.group.position.z, TALK_AZ, 0.5);
    if (reducedMotion()) this.snapCamera();
  }

  emote(who: Who, mood: Mood): void {
    this.actorFor(who)?.emote(mood, !reducedMotion());
    this.needsRender = true;
  }

  act(who: Who, action: BodyAction): void {
    if (reducedMotion()) return;
    this.actorFor(who)?.act(action);
  }

  mark(marks: Partial<Record<ThingId, Marker>>): void {
    const r = this.room;
    if (!r) return;
    r.actors.forEach((a, id) => {
      const m = marks[id];
      a.setMarker(m === '!' ? 'mark' : (m ?? null));
    });
    for (const [id, m] of this.spotMarks) {
      if (marks[id]) continue;
      m.sprite.removeFromParent();
      m.dispose();
      this.spotMarks.delete(id);
    }
    for (const [id, kind] of Object.entries(marks) as [ThingId, Marker][]) {
      const anchor = r.spotAnchors.get(id);
      if (!anchor || this.spotMarks.has(id)) continue;
      const e = new Emote(kind === '!' ? 'mark' : kind, Infinity);
      anchor.add(e.sprite);
      this.spotMarks.set(id, e);
    }
    this.needsRender = true;
  }

  setLabels(labels: Partial<Record<ThingId, string>>): void {
    this.labels = labels;
  }

  celebrate(id: ScenarioId): void {
    const b = this.plaza.buildings.get(id);
    if (b) b.pulse = 1;
    this.needsRender = true;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.needsRender = true;
      this.start();
    } else {
      this.stop();
    }
  }

  npcAnchor(): { x: number; y: number } | null {
    if (!this.room) return null;
    const who = (this.talking && this.talking !== 'guide' ? this.talking : this.focusId) ?? 'manager';
    const npc = this.actorFor(who as Who);
    if (!npc) return null;
    const v = new THREE.Vector3(0, npc.topY + 0.4, 0);
    npc.group.localToWorld(v);
    v.project(this.camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { x: clamp(((v.x + 1) / 2) * w, 90, w - 90), y: clamp(((1 - v.y) / 2) * h, 110, h * 0.6) };
  }

  async enter(id: ScenarioId, room: RoomSetup, midway?: () => void): Promise<void> {
    const b = this.plaza.buildings.get(id);
    if (!b || this.state !== 'plaza') {
      midway?.();
      return;
    }
    this.state = 'moving';
    this.lastBuilding = b;
    this.pointerHover = null;
    this.uiHover = null;
    const reduced = reducedMotion();
    // Load the room's models while the camera flies to the door.
    preload(room.lobby ? lobbyModels(room.look, id) : modelsFor(id, room.task, room.look));
    const building = buildRoom(id, room);

    if (!reduced) {
      const fromPos = this.camera.position.clone();
      const fromTarget = this.target.clone();
      const { pos, target } = this.doorShot(b);
      await this.tween(1050, (k) => {
        this.camera.position.lerpVectors(fromPos, pos, k);
        // Lift the path a little so the camera arcs over the plaza rather than through it.
        this.camera.position.y += Math.sin(k * Math.PI) * 2;
        this.target.lerpVectors(fromTarget, target, k);
        this.camera.lookAt(this.target);
      });
    }
    await fade(this.veil, true, reduced ? 160 : 260);

    // Swap to the interior diorama
    this.plaza.group.visible = false;
    this.sky.visible = false;
    this.scene.fog = null;
    this.scene.background = new THREE.Color(this.dark ? SKY.dark.interior : SKY.light.interior);
    let data: Room;
    try {
      data = await building;
    } catch (err) {
      // A model failed to load: go back to the plaza instead of leaving the screen covered.
      this.plaza.group.visible = true;
      this.sky.visible = true;
      this.scene.fog = this.fog;
      this.scene.background = null;
      this.state = 'plaza';
      this.placeCamera();
      await fade(this.veil, false, 200);
      throw err;
    }
    prepareForLighting(data.group);
    this.scene.add(data.group);
    this.renderer.shadowMap.needsUpdate = true;
    this.room = data;
    this.free = false;
    this.focusId = null;
    this.applyLights();
    this.state = 'interior';
    this.applyViewOffset();
    this.snapCamera();
    midway?.();
    this.renderNow();
    await fade(this.veil, false, reduced ? 200 : 380);
  }

  async changeRoom(id: ScenarioId, room: RoomSetup, midway?: () => void): Promise<void> {
    if (this.state !== 'interior' || !this.room) return this.enter(id, room, midway);
    this.state = 'moving';
    const reduced = reducedMotion();
    preload(room.lobby ? lobbyModels(room.look, id) : modelsFor(id, room.task, room.look));
    const building = buildRoom(id, room);
    await fade(this.veil, true, reduced ? 160 : 240);
    let data: Room;
    try {
      data = await building;
    } catch (err) {
      this.state = 'interior';
      await fade(this.veil, false, 200);
      throw err;
    }
    this.scene.remove(this.room.group);
    this.spotMarks.forEach((m) => m.dispose());
    this.spotMarks.clear();
    disposeRoom(this.room);
    this.setHoverThing(null);
    prepareForLighting(data.group);
    this.scene.add(data.group);
    this.renderer.shadowMap.needsUpdate = true;
    this.room = data;
    this.free = false;
    this.focusId = null;
    this.state = 'interior';
    this.snapCamera();
    midway?.();
    this.renderNow();
    await fade(this.veil, false, reduced ? 200 : 340);
  }

  async exit(midway?: () => void): Promise<void> {
    if (this.state !== 'interior') {
      midway?.();
      return;
    }
    this.state = 'moving';
    const reduced = reducedMotion();
    await fade(this.veil, true, reduced ? 160 : 240);

    if (this.room) {
      this.scene.remove(this.room.group);
      this.spotMarks.forEach((m) => m.dispose());
      this.spotMarks.clear();
      disposeRoom(this.room);
      this.room = null;
    }
    this.free = false;
    this.focusId = null;
    this.setHoverThing(null);
    this.hoverRing.visible = false;
    this.labelEl.hidden = true;
    this.roomDown = null;
    this.canvas.style.cursor = '';
    this.applyLights();
    this.plaza.group.visible = true;
    this.renderer.shadowMap.needsUpdate = true;
    this.sky.visible = true;
    this.scene.fog = this.fog;
    this.scene.background = null;
    this.applyViewOffset();

    const overview = this.overviewPose();
    const b = this.lastBuilding;
    if (!reduced && b) {
      const shot = this.doorShot(b);
      this.camera.position.copy(shot.pos);
      this.target.copy(shot.target);
      this.camera.lookAt(this.target);
    } else {
      this.camera.position.copy(overview.pos);
      this.target.copy(overview.target);
      this.camera.lookAt(this.target);
    }
    midway?.();
    this.renderNow();
    await fade(this.veil, false, reduced ? 200 : 320);

    if (!reduced && b) {
      const fromPos = this.camera.position.clone();
      const fromTarget = this.target.clone();
      await this.tween(1050, (k) => {
        this.camera.position.lerpVectors(fromPos, overview.pos, k);
        this.camera.position.y += Math.sin(k * Math.PI) * 2;
        this.target.lerpVectors(fromTarget, overview.target, k);
        this.camera.lookAt(this.target);
      });
    }
    this.state = 'plaza';
    this.needsRender = true;
  }

  dispose(): void {
    this.stop();
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    if (this.room) disposeRoom(this.room);
    this.room = null;
    this.labelEl.remove();
    this.kit.dispose();
    this.skyMat.dispose();
    this.sky.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ---- Camera ---------------------------------------------------------------

  private overviewPose() {
    const aspect = this.camera.aspect;
    const tanH = Math.tan((this.camera.fov * DEG) / 2) * aspect;
    const intro = easeInOut(this.intro);
    const radius = (clamp((aspect < 1 ? 24 : 40) / tanH, aspect < 1 ? 60 : 70, 120) + this.zoom) * (1 + intro * 0.4);
    const polar = (aspect < 1 ? 46 : 52) * DEG + this.pol - intro * 18 * DEG + this.parallax.y * 4 * DEG;
    const swing = reducedMotion() ? 0 : Math.sin(this.orbitPhase) * 9 * DEG;
    // From the south, along the campus's main axis (the entrance gate towards the clock tower)
    const azimuth = 8 * DEG + swing + this.az - intro * 40 * DEG + this.parallax.x * 6 * DEG;
    const target = new THREE.Vector3(0, 1.5, 1);
    const pos = new THREE.Vector3(
      Math.sin(polar) * Math.sin(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.cos(azimuth),
    )
      .multiplyScalar(radius)
      .add(target);
    return { pos, target };
  }

  /**
   * Inside: follow the player from an angled overhead view, like Pokemon Black and White.
   * During a conversation, move in to a two-shot of the player and whoever they're talking to.
   */
  private interiorPose() {
    const aspect = this.camera.aspect;
    const tanH = Math.tan((this.camera.fov * DEG) / 2) * aspect;
    const r = this.room;
    const p = r ? r.player.group.position : new THREE.Vector3();
    const other = this.focusId && r ? r.things.get(this.focusId) : undefined;
    if (other) {
      // Frame the pair a little low, so the talk box along the bottom doesn't cover them.
      const mid = new THREE.Vector3((p.x + other.x) / 2, -0.4, (p.z + other.z) / 2);
      const gap = Math.hypot(other.x - p.x, other.z - p.z);
      const az = TALK_AZ;
      const radius = clamp((gap * 1.3 + 4.6) / Math.min(tanH, 0.9), 12, 18);
      const polar = 70 * DEG;
      const pos = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(radius).add(mid);
      return { pos, target: mid };
    }
    // Follow loosely: the camera drifts toward the player but keeps most of the room in view.
    // Like an Animal Crossing house: straight in from the front, the whole room in view,
    // drifting a little toward the player.
    const [bx0, bz0, bx1, bz1] = r ? r.bounds : [-7, -5, 7, 5];
    const cx = (bx0 + bx1) / 2;
    const cz = (bz0 + bz1) / 2;
    // On narrow (phone) screens, show about two-thirds of the room's width and follow the player across it.
    const narrow = aspect < 0.8;
    const halfW = (bx1 - bx0) / 2;
    const viewHalf = narrow ? Math.max(4.2, halfW * 0.62) : halfW + 1.6;
    const follow = narrow ? clamp(p.x, bx0 + viewHalf - 1, bx1 - viewHalf + 1) : cx + (p.x - cx) * 0.18;
    const target = new THREE.Vector3(follow, 0.6, cz + (p.z - cz) * 0.12 + 0.4);
    const tanV = Math.tan((this.camera.fov * DEG) / 2);
    const radius = clamp(Math.max(viewHalf / tanH, (bz1 - bz0) / 2 / tanV + 6), narrow ? 12 : 17, 40);
    const azimuth = 0;
    const polar = 47 * DEG;
    const pos = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
      .multiplyScalar(radius)
      .add(target);
    return { pos, target };
  }

  private snapCamera() {
    const pose = this.interiorPose();
    this.camera.position.copy(pose.pos);
    this.target.copy(pose.target);
    this.camera.lookAt(this.target);
    this.needsRender = true;
  }

  private doorShot(b: BuildingHandle) {
    const target = b.door.clone().setY(2.4);
    const pos = b.door.clone().addScaledVector(b.toCenter, 8).setY(3.8);
    return { pos, target };
  }

  private placeCamera() {
    const pose = this.state === 'interior' ? this.interiorPose() : this.overviewPose();
    this.camera.position.copy(pose.pos);
    this.target.copy(pose.target);
    this.camera.lookAt(this.target);
  }

  /** Shifts the picture up so the dialogue card at the bottom doesn't cover the action. */
  private applyViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = w / h < 1;
    // Inside, the room banner sits along the top, so the picture moves down a little.
    const share = this.state === 'interior' || this.room ? (portrait ? -0.17 : -0.13) : portrait ? 0.14 : 0.08;
    this.camera.setViewOffset(w, h, 0, h * share, w, h);
    this.camera.updateProjectionMatrix();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Widen the view on tall phone screens so the whole plaza fits across.
    this.camera.fov = aspect < 1 ? THREE.MathUtils.lerp(46, 60, clamp((1 - aspect) / 0.55, 0, 1)) : 42;
    this.applyViewOffset();
    if (this.state === 'interior') this.snapCamera();
    else if (this.state !== 'moving') this.placeCamera();
    this.needsRender = true;
  }

  // ---- Theme and lit state ----------------------------------------------------

  private applyTheme(dark: boolean) {
    this.dark = dark;
    const p = dark ? SKY.dark : SKY.light;
    (this.skyMat.uniforms.top.value as THREE.Color).set(p.top);
    (this.skyMat.uniforms.horizon.value as THREE.Color).set(p.horizon);
    (this.skyMat.uniforms.bottom.value as THREE.Color).set(p.bottom);
    (this.skyMat.uniforms.glow.value as THREE.Color).set(p.glow);
    this.skyMat.uniforms.glowSize.value = p.glowSize;
    this.fog.color.set(p.horizon);
    this.atmosphere.theme(dark);
    this.renderer.shadowMap.needsUpdate = true;
    this.applyLights();
    if (this.room) this.scene.background = new THREE.Color(p.interior);
    this.plaza.theme(dark);
    this.applyLit();
    this.needsRender = true;
  }

  /** Interiors are always lit like daytime rooms; the plaza follows the theme. */
  private applyLights() {
    const inside = !!this.room;
    const p = this.dark && !inside ? SKY.dark : SKY.light;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    // Indoors: warm and a little dim, so the lamp light and windows glow (Animal Crossing's mood)
    if (inside) {
      this.hemi.color.set(0xffe9cc);
      this.hemi.groundColor.set(0x5a4634);
    }
    this.hemi.intensity = inside ? 1.15 : p.hemi;
    this.sun.color.set(inside ? 0xffe2b8 : p.sunColor);
    this.sun.intensity = inside ? 1.8 : p.sun;
    // Indoors the light comes from high on the camera side, so walls don't shade the floor,
    // and a tighter shadow box keeps the furniture's shadows crisp.
    const cam = this.sun.shadow.camera;
    const reach = inside ? 13 : 42;
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.updateProjectionMatrix();
    if (inside) this.sun.position.set(5, 24, 16);
    else this.sun.position.copy(SUN_DIR).multiplyScalar(70);
  }

  private applyLit() {
    this.plaza.buildings.forEach((b) => {
      b.lit = this.visited.has(b.id);
      b.windowMat.emissive.set(b.lit ? 0xffc65a : this.dark ? 0x2a3440 : 0x000000);
      b.windowMat.emissiveIntensity = b.lit ? (this.dark ? 1.3 : 0.7) : 1;
      b.windowMat.color.set(b.lit ? 0xffe6a8 : 0xcfe6ee);
      const dim = b.lit ? 1 : 0.8;
      b.bodyMats.forEach(({ m, base }) => m.color.copy(base).multiplyScalar(dim));
      b.sparkle.visible = b.lit;
    });
  }

  // ---- Input ------------------------------------------------------------------

  /** Inside a room, the player can walk around and click people and things. */
  private inRoom() {
    return this.state === 'interior' && this.active && !!this.room;
  }

  private ray(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  private pickThing(x: number, y: number): ThingId | null {
    if (!this.room) return null;
    this.ray(x, y);
    const hit = this.raycaster.intersectObjects(this.room.hits, false)[0];
    return (hit?.object.userData.thing as ThingId | undefined) ?? null;
  }

  private pickFloor(x: number, y: number): THREE.Vector3 | null {
    if (!this.room) return null;
    this.ray(x, y);
    return this.raycaster.intersectObject(this.room.floor, false)[0]?.point ?? null;
  }

  private setHoverThing(id: ThingId | null) {
    if (id === this.hoverThing) return;
    this.hoverThing = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.needsRender = true;
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    const move = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k);
    if (!this.inRoom() || !this.free) {
      if (!down) this.keys.delete(k);
      return;
    }
    if (move) {
      // Arrow keys move the player only when nothing else on the page has focus.
      if (k.startsWith('arrow') && t && t !== document.body && t !== this.canvas) return;
      e.preventDefault();
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      this.keyboardLast = true;
      ++this.walkToken;
    } else if (down && k === 'e') {
      const near = this.nearestThing(3);
      if (near) {
        e.preventDefault();
        void this.approach(near);
      }
    }
  }

  /** The closest labelled thing within reach of the player. */
  private nearestThing(reach: number): ThingId | null {
    const r = this.room;
    if (!r) return null;
    const p = r.player.group.position;
    let best: ThingId | null = null;
    let bestD = reach;
    r.things.forEach((v, id) => {
      if (!this.labels[id]) return;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  }

  private interactive() {
    return this.state === 'plaza' && this.active && document.body.dataset.screen !== 'scenario';
  }

  private pick(x: number, y: number): ScenarioId | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return (hit?.object.userData.buildingId as ScenarioId | undefined) ?? null;
  }

  private setPointerHover(id: ScenarioId | null) {
    if (id === this.pointerHover) return;
    this.pointerHover = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.onHover?.(id);
    this.needsRender = true;
  }

  private onPointerDown(e: PointerEvent) {
    if (this.inRoom()) {
      this.roomDown = { x: e.clientX, y: e.clientY };
      this.keyboardLast = false;
      return;
    }
    if (!this.interactive()) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragFrom = { x: e.clientX, y: e.clientY, az: this.az, pol: this.pol };
      this.moved = false;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.moved = true;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (this.inRoom()) {
      if (e.pointerType === 'mouse' && this.free) {
        const id = this.pickThing(e.clientX, e.clientY);
        this.keyboardLast = false;
        this.setHoverThing(id && this.labels[id] ? id : null);
      }
      return;
    }
    if (!this.interactive()) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        this.setPointerHover(this.pick(e.clientX, e.clientY));
        this.parallaxTarget.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      }
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1) {
      const dx = e.clientX - this.dragFrom.x;
      const dy = e.clientY - this.dragFrom.y;
      if (Math.hypot(dx, dy) > 8) this.moved = true;
      if (this.moved) {
        this.az = clamp(this.dragFrom.az - dx * 0.005, -0.6, 0.6);
        this.pol = clamp(this.dragFrom.pol - dy * 0.003, -0.22, 0.14);
        this.needsRender = true;
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoom = clamp(this.zoom - (d - this.pinch) * 0.08, -10, 16);
      this.pinch = d;
      this.needsRender = true;
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (this.inRoom()) {
      const down = this.roomDown;
      this.roomDown = null;
      if (!down || !this.free || Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 10) return;
      const id = this.pickThing(e.clientX, e.clientY);
      if (id && this.labels[id]) {
        void this.approach(id);
        return;
      }
      const at = this.pickFloor(e.clientX, e.clientY);
      if (at) this.walkToPoint(at.x, at.z);
      return;
    }
    const had = this.pointers.delete(e.pointerId);
    if (!had || !this.interactive()) return;
    if (!this.moved && this.pointers.size === 0) {
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.onPick?.(id);
    }
  }

  private onWheel(e: WheelEvent) {
    if (!this.interactive()) return;
    e.preventDefault();
    this.zoom = clamp(this.zoom + e.deltaY * 0.02, -10, 16);
    this.needsRender = true;
  }

  // ---- Loop ---------------------------------------------------------------------

  private tween(dur: number, step: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), dur, step: (k) => step(easeInOut(k)), done: resolve });
      this.start();
    });
  }

  private start() {
    if (this.raf || !this.active || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private renderNow() {
    this.update(0);
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.active || document.hidden) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    for (const t of [...this.tweens]) {
      const k = Math.min(1, (now - t.start) / t.dur);
      t.step(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(t), 1);
        t.done();
      }
    }

    const motion = !reducedMotion();
    // A room always updates: people turn and walk even with reduced motion (they just don't animate).
    const animating = motion || this.tweens.length > 0 || !!this.room;
    if (animating || this.needsRender) {
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const motion = !reducedMotion();
    if (motion) this.time += dt;
    const t = this.time;

    if (this.state === 'plaza') {
      if (motion) this.orbitPhase += dt * ((Math.PI * 2) / 48);
      this.intro = motion ? Math.max(0, this.intro - dt / 3.6) : 0;
      if (motion) {
        this.parallax.x = THREE.MathUtils.damp(this.parallax.x, this.parallaxTarget.x, 3, dt);
        this.parallax.y = THREE.MathUtils.damp(this.parallax.y, this.parallaxTarget.y, 3, dt);
      }
      this.placeCamera();
    } else if (this.state === 'interior') {
      this.updateRoom(dt, motion);
    }

    if (this.plaza.group.visible) {
      // Fountain ripples and jet
      this.plaza.rings.forEach((r, i) => {
        const ph = motion ? (t * 0.35 + i / 3) % 1 : i / 3;
        r.scale.setScalar(1 + ph * 1.55);
        (r.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - ph);
      });
      this.plaza.jet.scale.y = motion ? 1 + Math.sin(t * 3.2) * 0.14 : 1;
      this.plaza.water.uniforms.time.value = t;
      this.atmosphere.update(t, dt, motion);

      const hoverId = this.uiHover ?? this.pointerHover;
      this.plaza.buildings.forEach((b) => {
        const hovered = hoverId === b.id && this.state === 'plaza';
        b.liftTarget = hovered ? 0.5 : 0;
        b.lift = motion ? THREE.MathUtils.damp(b.lift, b.liftTarget, 10, dt) : b.liftTarget;
        if (Math.abs(b.lift - b.liftTarget) > 0.002) this.needsRender = true;
        b.group.position.y = b.lift;
        const ls = hovered ? 1.12 : 1;
        b.label.scale.set(LABEL_W * ls, LABEL_H * ls, 1);
        b.label.position.y = labelY(b.height) + b.lift;

        if (motion) b.animate?.(t);
        b.pulse = Math.max(0, b.pulse - dt * 0.5);
        const glow = b.lit ? 0.42 + (motion ? Math.sin(t * 2 + b.height) * 0.12 : 0) : 0;
        b.ringMat.color.set(b.lit ? 0xf2b634 : 0xffffff);
        b.ringMat.opacity = Math.min(0.95, glow + b.pulse * 0.5 + (hovered && !b.lit ? 0.35 : 0));
        b.ring.visible = b.ringMat.opacity > 0.01;
        b.ring.scale.setScalar(1 + b.pulse * 0.3);
        if (b.sparkle.visible) {
          b.sparkle.rotation.y = t * 1.6;
          b.sparkle.position.y = b.height + 0.9 + (motion ? Math.sin(t * 2.2) * 0.25 : 0);
          b.sparkle.scale.setScalar(1 + b.pulse * 1.2);
        }
      });
      this.plaza.guide.update(t, this.talking === 'guide', motion, this.camera);
      if (this.plazaPeople[0]) this.plazaPeople[0].talking = this.talking === 'guide';
      this.updateStrollers(dt, motion);
      // The terrace's water jets bob
      this.plaza.ground.jets.forEach((j, i) => (j.scale.y = motion ? 1 + Math.sin(t * 4 + i) * 0.25 : 1));
      // Re-render shadows only while a building is rising or settling.
      let lift = 0;
      this.plaza.buildings.forEach((b) => (lift += b.lift));
      if (Math.abs(lift - this.lastLift) > 0.001) this.renderer.shadowMap.needsUpdate = true;
      this.lastLift = lift;
    }
  }

  private updateRoom(dt: number, motion: boolean) {
    const r = this.room;
    if (!r) return;
    const player = r.player;

    // Keyboard walking, relative to the camera
    if (this.free && this.keys.size) {
      const f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
      const s = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      const fwd = new THREE.Vector3().subVectors(this.target, this.camera.position).setY(0).normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const dir = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
      // If the player is somehow standing in a blocked spot, let them walk out of it.
      const stuck = !r.grid.free(player.group.position.x, player.group.position.z);
      player.steer(dir.x, dir.z, dt, (x, z) => stuck || r.grid.free(x, z));
    } else {
      player.steer(0, 0, dt, () => false);
    }

    // People glance at the player when close; the two in a conversation look at each other.
    const pp = player.group.position;
    const head = new THREE.Vector3(pp.x, 2, pp.z);
    // (The pair in a conversation already stand angled to each other and the camera, so their
    // heads stay put; turning them too would show the camera the backs of their big heads.)
    r.actors.forEach((a, id) => {
      const d = a.group.position.distanceTo(pp);
      a.lookAt = id !== this.focusId && d < 4.5 ? head : null;
    });
    player.lookAt = null;

    // In a conversation, anyone standing between the camera and the pair steps out of the shot.
    const mid = focusMid(r, this.focusId);
    r.actors.forEach((a, id) => {
      let show = true;
      if (mid && id !== this.focusId) {
        const cam = this.camera.position;
        const ap = a.group.position;
        const toMid = new THREE.Vector3(mid.x - cam.x, 0, mid.z - cam.z);
        const toA = new THREE.Vector3(ap.x - cam.x, 0, ap.z - cam.z);
        const along = toA.dot(toMid.clone().normalize());
        const off = Math.sqrt(Math.max(0, toA.lengthSq() - along * along));
        show = !(along > 0 && along < toMid.length() - 0.8 && off < 2.2);
      }
      a.group.visible = show;
    });

    let busy = player.update(dt, motion);
    r.actors.forEach((a) => (busy = a.update(dt, motion) || busy));
    this.spotMarks.forEach((m) => m.update(dt, motion, 0.9));
    // Moving shadows: refresh often, less often on low-power devices.
    if (++this.shadowTick % (this.lowPower ? 3 : 1) === 0) this.renderer.shadowMap.needsUpdate = true;

    // Keyboard players get a prompt for the nearest thing
    if (this.free && this.keyboardLast) this.setHoverThing(this.nearestThing(3));

    // Hover ring and label
    const hp = this.hoverThing ? r.things.get(this.hoverThing) : undefined;
    const hoverActor = this.hoverThing ? r.actors.get(this.hoverThing) : undefined;
    this.hoverRing.visible = !!hp && this.free && (!!hoverActor || hp.y <= 2.2);
    if (hp) {
      this.hoverRing.position.set(hp.x, 0.16, hp.z);
      this.hoverRing.scale.setScalar((hoverActor ? 0.8 : 1.1) * (motion ? 1 + Math.sin(this.time * 5) * 0.05 : 1));
    }
    const label = this.hoverThing && this.free ? this.labels[this.hoverThing] : undefined;
    if (label && hp) {
      const v = new THREE.Vector3(hp.x, hoverActor ? hoverActor.topY + 0.9 : hp.y + 1.2, hp.z).project(this.camera);
      this.labelEl.textContent = this.keyboardLast ? `E · ${label}` : label;
      this.labelEl.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
      this.labelEl.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
      this.labelEl.hidden = false;
    } else {
      this.labelEl.hidden = true;
    }

    // Ease the camera toward its goal
    const goal = this.interiorPose();
    if (motion) {
      const k = 1 - Math.exp(-dt * (this.focusId ? 3.2 : 4.5));
      this.camera.position.lerp(goal.pos, k);
      this.target.lerp(goal.target, k);
    } else {
      this.camera.position.copy(goal.pos);
      this.target.copy(goal.target);
    }
    this.camera.lookAt(this.target);
    if (busy) this.needsRender = true;
  }
}

/** The point halfway between the player and whoever they're talking to. */
function focusMid(r: Room, focus: ThingId | null): THREE.Vector3 | null {
  const other = focus ? r.things.get(focus) : undefined;
  if (!other || !r.actors.has(focus!)) return null;
  const p = r.player.group.position;
  return new THREE.Vector3((p.x + other.x) / 2, 0, (p.z + other.z) / 2);
}

/**
 * Lit meshes cast and receive the sun's shadow; flat decals and unlit text don't.
 * Canvas-drawn signs and charts skip tone mapping so their colours stay true.
 */
function prepareForLighting(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Sprite).isSprite) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const unlit = m.type === 'MeshBasicMaterial' || m.type === 'SpriteMaterial';
      if (unlit && (m as THREE.MeshBasicMaterial).map) m.toneMapped = false;
    }
    const lit = mats.some((m) => (m as THREE.Material).type === 'MeshLambertMaterial' || (m as THREE.Material).type === 'MeshStandardMaterial');
    const flat = mesh.geometry?.type === 'RingGeometry' || mesh.geometry?.type === 'CircleGeometry' || mesh.geometry?.type === 'PlaneGeometry';
    mesh.receiveShadow = lit;
    mesh.castShadow = lit && !flat && !mats.some((m) => m.transparent);
  });
}
